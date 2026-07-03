/* POST /api/webhooks/routestack — RouteStack order-lifecycle webhook (specs/10d-booking-webhooks.md).
 *
 * RouteStack pushes order events (creation → payment → booking → cancel/refund) here after the user
 * completes the deep-link checkout. PUBLIC (RouteStack is the caller — NO Supabase auth gate); the
 * shared-secret access key is what authenticates the caller (carrier header confirmed live 2026-07-03:
 * `x-webhook-access-key`, see lib/booking/webhook.ts). We verify the secret → parse → redact +
 * persist the raw event → correlate it to a HotelZippo user via the pending booking_orders row
 * (billing_email match) → update the order status. Always 200 on an authentic, well-formed event
 * (even unmatched) so RouteStack doesn't retry endlessly; only auth/parse failures are non-200.
 *
 * Server-side (service client + webhook secret never reach the client). */
import { SpanStatusCode } from '@opentelemetry/api';
import { createServiceClient } from '@/lib/db/server';
import { withSpan, HZ } from '@/lib/otel/trace';
import { makeSupabasePayloadLog, payloadLoggingEnabled, type PayloadLog } from '@/lib/booking/payload-log';
import {
  parseWebhookEvent,
  verifyWebhookSecret,
  webhookSecretConfigured,
  correlateOrder,
  recordWebhookEvent,
} from '@/lib/booking/webhook';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function POST(req: Request): Promise<Response> {
  // webhook.routestack span (specs/14): the order-lifecycle ingestion path was previously
  // untraced — now the correlate + persist DB writes hang under one named, filterable parent.
  return withSpan('webhook.routestack', {}, (span) => handleWebhook(req, span));
}

async function handleWebhook(req: Request, span: import('@opentelemetry/api').Span): Promise<Response> {
  // TEMP DEBUG (remove after live webhook verification): print every header + the raw body so a
  // real delivery is inspectable in the terminal immediately — a second, independent capture
  // path alongside raw_routestack_payloads (never rely on the DB write alone: it's fire-and-
  // forget, so a query racing ahead of the insert, or the flag being off, would show nothing).
  if (process.env.ROUTESTACK_WEBHOOK_DEBUG === '1') {
    const headersDump: Record<string, string> = {};
    req.headers.forEach((v, k) => { headersDump[k] = k.toLowerCase().includes('key') || k.toLowerCase().includes('secret') || k.toLowerCase() === 'authorization' ? `${v.slice(0, 6)}…(${v.length} chars)` : v; });
    let bodyText = '';
    try { bodyText = await req.clone().text(); } catch { /* ignore */ }
    // eslint-disable-next-line no-console
    console.log('\n[webhook-debug] ===== incoming delivery =====');
    // eslint-disable-next-line no-console
    console.log('[webhook-debug] headers:', JSON.stringify(headersDump, null, 2));
    // eslint-disable-next-line no-console
    console.log('[webhook-debug] body:', bodyText);
  }

  // Flag-gated RouteStack payload capture (ROUTESTACK_DEBUG_PAYLOADS=1) — same debug seam the
  // outbound booking routes use (10c), extended here to INBOUND webhook deliveries so a real
  // delivery's body is inspectable/replayable in raw_routestack_payloads, not just in Dash0
  // span attributes. Best-effort: a failed/absent log never affects the webhook ack.
  let debugLog: PayloadLog | undefined;
  try {
    if (payloadLoggingEnabled()) debugLog = makeSupabasePayloadLog(createServiceClient());
  } catch {
    debugLog = undefined;
  }
  const start = Date.now();
  const logDelivery = (rec: { success: boolean; code: number; error: string | null; response: unknown }) => {
    if (!debugLog) return;
    const p = debugLog.record({
      step: 'webhook',
      path: '/api/webhooks/routestack',
      request: null, // inbound delivery — there is no outbound request to log
      response: rec.response,
      success: rec.success,
      code: rec.code,
      durationMs: Date.now() - start,
      error: rec.error,
      hotelId: null, // webhook events carry no HotelZippo hotel id (10d)
      traceId: span.spanContext()?.traceId ?? null,
    });
    if (p && typeof p.catch === 'function') p.catch(() => {});
  };

  // 1. authenticate the caller via the shared secret (when configured).
  if (!verifyWebhookSecret(req)) {
    logDelivery({ success: false, code: 401, error: 'unauthorized', response: null });
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  if (!webhookSecretConfigured()) {
    // Dev/sandbox: verification skipped. Surface it so it's never silently off in prod.
    console.warn('[routestack-webhook] ROUTESTACK_WEBHOOK_SECRET unset — accepting unverified delivery (dev/sandbox only).');
  }

  // 2. parse + validate.
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    logDelivery({ success: false, code: 400, error: 'invalid_json', response: null });
    return Response.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }
  const event = parseWebhookEvent(raw);
  if (!event) {
    logDelivery({ success: false, code: 400, error: 'invalid_event', response: raw });
    return Response.json({ ok: false, error: 'invalid_event' }, { status: 400 });
  }
  span.setAttribute(HZ.webhookEvent, event.event);
  if (event.module) span.setAttribute(HZ.webhookModule, event.module);
  if (event.orderstatus) span.setAttribute(HZ.webhookOrderStatus, event.orderstatus);

  // Non-HOTEL modules are acked + skipped (v1 tracks hotels only).
  if (event.module && event.module.toUpperCase() !== 'HOTEL') {
    span.setAttribute(HZ.outcome, 'skipped_non_hotel');
    logDelivery({ success: true, code: 200, error: null, response: event });
    return Response.json({ ok: true, skipped: 'non_hotel_module' }, { status: 200 });
  }

  // 3+4. correlate + persist (best-effort; a webhook must always 200 on an authentic event).
  try {
    const client = createServiceClient();
    const link = await correlateOrder(client, event);
    await recordWebhookEvent(client, event, link);
    span.setAttribute(HZ.webhookMatched, link.matched);
    span.setAttribute(HZ.outcome, link.matched ? 'matched' : 'unmatched');
    logDelivery({ success: true, code: 200, error: null, response: event });
    return Response.json({ ok: true, matched: link.matched }, { status: 200 });
  } catch (e) {
    // A dropped confirmed-booking record must be VISIBLE in Dash0 (spec 14 "never lose data
    // silently"): record the exception + mark the span ERROR — withSpan honours a call-site
    // status, so the normal return below no longer clobbers it with OK.
    span.recordException(e as Error);
    span.setStatus({ code: SpanStatusCode.ERROR, message: 'persist_failed' });
    span.setAttribute(HZ.outcome, 'persist_failed');
    logDelivery({ success: false, code: 200, error: e instanceof Error ? e.message : String(e), response: event });
    // Service client couldn't be built / unexpected error: still 200 so RouteStack doesn't retry
    // forever, but signal we didn't persist. (Authentic event; our side failed, not theirs.)
    return Response.json({ ok: true, persisted: false }, { status: 200 });
  }
}
