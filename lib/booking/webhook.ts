/* RouteStack booking webhooks (Phase 7 follow-up · specs/10d-booking-webhooks.md).
 *
 * RouteStack pushes the order lifecycle (creation → payment → booking → cancel/refund) to a URL we
 * configure, each event carrying an `orderid` + `billing_email`. This module is the pure core the
 * webhook route uses: the event Zod schema, shared-secret verification, and the correlation logic
 * that ties an event to a HotelZippo user via the pending `booking_orders` row (email match).
 *
 * No payload field is a HotelZippo id (get-payment-url accepts no partner reference) — `billing_email`
 * is the only user-correlation handle (what the user typed on RouteStack's checkout). Unmatched events
 * are still PERSISTED, never dropped.
 *
 * NOT `'use client'`: server-side (service client + the webhook secret); reached only from the webhook
 * API route. */
import crypto from 'node:crypto';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { redact } from './payload-log';

/* ---- event schema ------------------------------------------------------- */

/** The RouteStack webhook payload (consistent across events; some fields event-specific). Tolerant:
 * unknown extra keys are allowed (passthrough) so a new field never rejects a real delivery. */
export const RouteStackWebhookSchema = z
  .object({
    event: z.string().min(1),
    orderid: z.string().nullable().optional(),
    orderstatus: z.string().optional(),
    message: z.string().optional(),
    createdat: z.string().optional(),
    account_code: z.string().optional(),
    billing_email: z.string().optional(),
    billing_name: z.string().optional(),
    price: z.number().optional(),
    currency: z.string().optional(),
    module: z.string().optional(),
    event_timestamp: z.string().optional(),
    paymentstatus: z.string().optional(),
  })
  .passthrough();

export type RouteStackWebhookEvent = z.infer<typeof RouteStackWebhookSchema>;

/** Parse + validate an unknown body. Returns the event or null (caller → 400). */
export function parseWebhookEvent(body: unknown): RouteStackWebhookEvent | null {
  const r = RouteStackWebhookSchema.safeParse(body);
  return r.success ? r.data : null;
}

/* ---- secret verification ------------------------------------------------ */

/** Whether a webhook secret is configured (when set, every delivery MUST present it). */
export function webhookSecretConfigured(): boolean {
  return !!process.env.ROUTESTACK_WEBHOOK_SECRET;
}

/** Timing-safe compare of two strings (length-independent — hash both so length isn't leaked). */
function safeEqual(a: string, b: string): boolean {
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

/** Verify the inbound request carries the configured shared secret. RouteStack's exact delivery
 * mechanism (header name vs query) must be confirmed against a live ping — we accept the secret from
 * any of the likely carriers and compare timing-safe. When NO secret is configured (local/dev), this
 * returns true (verification skipped) so sandbox pings work; the route logs a warn in that case. */
export function verifyWebhookSecret(req: {
  headers: { get(name: string): string | null };
  url: string;
}): boolean {
  const expected = process.env.ROUTESTACK_WEBHOOK_SECRET;
  if (!expected) return true; // not configured → skip (dev/sandbox); route warns

  const presented =
    req.headers.get('x-webhook-key') ??
    req.headers.get('x-webhook-secret') ??
    req.headers.get('x-routestack-webhook-key') ??
    stripBearer(req.headers.get('authorization')) ??
    new URL(req.url).searchParams.get('key') ??
    new URL(req.url).searchParams.get('access_key');

  return !!presented && safeEqual(presented, expected);
}

function stripBearer(v: string | null): string | null {
  if (!v) return null;
  return v.toLowerCase().startsWith('bearer ') ? v.slice(7) : v;
}

/* ---- correlation -------------------------------------------------------- */

export interface CorrelationResult {
  /** The booking_orders row id we updated/linked, or null when no order matched. */
  bookingOrderId: string | null;
  matched: boolean;
}

/** Row shape we read from booking_orders for matching. */
interface OrderRow {
  id: string;
  rs_order_id: string | null;
}

/** Correlate an event to a booking_orders row + update its status. Pure over an injected client.
 *
 * Order of resolution:
 *  1. If the event has an `orderid` and a row already carries that `rs_order_id` → UPDATE it (idempotent
 *     redelivery / later lifecycle event).
 *  2. Else match the most-recent `linked=false` row whose `user_email` == `billing_email` (24h window)
 *     → set its rs_order_id + statuses + linked=true.
 *  3. No match → return { matched:false } (the event is still recorded by the caller).
 *
 * Best-effort: any DB error resolves to a no-match rather than throwing — a webhook must always 200. */
export async function correlateOrder(
  client: SupabaseClient,
  event: RouteStackWebhookEvent,
  now: () => number = Date.now,
): Promise<CorrelationResult> {
  try {
    const statusPatch = {
      order_status: event.orderstatus ?? null,
      payment_status: event.paymentstatus ?? null,
      last_event: event.event,
      billing_email: event.billing_email ?? null,
      price: typeof event.price === 'number' ? event.price : null,
      updated_at: new Date(now()).toISOString(),
    };

    // 1. existing order by rs_order_id
    if (event.orderid) {
      const { data: existing } = await client
        .from('booking_orders')
        .select('id, rs_order_id')
        .eq('rs_order_id', event.orderid)
        .maybeSingle();
      if (existing) {
        const row = existing as OrderRow;
        await client.from('booking_orders').update(statusPatch).eq('id', row.id);
        return { bookingOrderId: row.id, matched: true };
      }
    }

    // 2. match a pending row by billing_email (most-recent unlinked, within 24h)
    if (event.billing_email) {
      const since = new Date(now() - 24 * 60 * 60 * 1000).toISOString();
      const { data: pending } = await client
        .from('booking_orders')
        .select('id, rs_order_id')
        .eq('linked', false)
        .ilike('user_email', event.billing_email)
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (pending) {
        const row = pending as OrderRow;
        await client
          .from('booking_orders')
          .update({ ...statusPatch, rs_order_id: event.orderid ?? null, linked: true })
          .eq('id', row.id);
        return { bookingOrderId: row.id, matched: true };
      }
    }

    return { bookingOrderId: null, matched: false };
  } catch {
    return { bookingOrderId: null, matched: false };
  }
}

/* ---- pending order (written at payment-url handoff) --------------------- */

export interface PendingOrderInput {
  userId: string;
  userEmail: string | null;
  hotelId: string;
  hotelName: string;
  destination?: string | null;
  checkIn: string;
  checkOut: string;
  correlationId: string;
  currency?: string | null;
}

/** Best-effort insert of the "pending" booking_orders row at payment-url handoff — the bridge a later
 * webhook matches by billing_email. A failure NEVER blocks the handoff (caller swallows). `linked`
 * starts false; the webhook flips it true once an order event matches this user_email. */
export async function recordPendingOrder(
  client: SupabaseClient,
  input: PendingOrderInput,
): Promise<void> {
  try {
    await client.from('booking_orders').insert({
      user_id: input.userId,
      user_email: input.userEmail,
      hotel_id: input.hotelId,
      hotel_name: input.hotelName,
      destination: input.destination ?? null,
      check_in: input.checkIn,
      check_out: input.checkOut,
      correlation_id: input.correlationId,
      currency: input.currency ?? null,
      linked: false,
    });
  } catch {
    /* best-effort — a booking must still hand off even if we can't record the pending order */
  }
}

/* ---- persistence (raw event audit) -------------------------------------- */

/** Append the raw event to webhook_events (always — matched or not), with PII (billing_name/email)
 * REDACTED in the stored payload. Best-effort. Returns nothing. */
export async function recordWebhookEvent(
  client: SupabaseClient,
  event: RouteStackWebhookEvent,
  link: CorrelationResult,
): Promise<void> {
  try {
    await client.from('webhook_events').insert({
      source: 'routestack',
      event: event.event,
      rs_order_id: event.orderid ?? null,
      booking_order_id: link.bookingOrderId,
      matched: link.matched,
      payload: redact(event),
    });
  } catch {
    /* best-effort audit — never fail the webhook */
  }
}
