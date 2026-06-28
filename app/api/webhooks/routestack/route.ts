/* POST /api/webhooks/routestack — RouteStack order-lifecycle webhook (specs/10d-booking-webhooks.md).
 *
 * RouteStack pushes order events (creation → payment → booking → cancel/refund) here after the user
 * completes the deep-link checkout. PUBLIC (RouteStack is the caller — NO Supabase auth gate); the
 * shared-secret access key is what authenticates the caller. We verify the secret → parse → redact +
 * persist the raw event → correlate it to a HotelZippo user via the pending booking_orders row
 * (billing_email match) → update the order status. Always 200 on an authentic, well-formed event
 * (even unmatched) so RouteStack doesn't retry endlessly; only auth/parse failures are non-200.
 *
 * Server-side (service client + webhook secret never reach the client). */
import { createServiceClient } from '@/lib/db/server';
import {
  parseWebhookEvent,
  verifyWebhookSecret,
  webhookSecretConfigured,
  correlateOrder,
  recordWebhookEvent,
} from '@/lib/booking/webhook';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request): Promise<Response> {
  // 1. authenticate the caller via the shared secret (when configured).
  if (!verifyWebhookSecret(req)) {
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
    return Response.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }
  const event = parseWebhookEvent(raw);
  if (!event) {
    return Response.json({ ok: false, error: 'invalid_event' }, { status: 400 });
  }

  // Non-HOTEL modules are acked + skipped (v1 tracks hotels only).
  if (event.module && event.module.toUpperCase() !== 'HOTEL') {
    return Response.json({ ok: true, skipped: 'non_hotel_module' }, { status: 200 });
  }

  // 3+4. correlate + persist (best-effort; a webhook must always 200 on an authentic event).
  try {
    const client = createServiceClient();
    const link = await correlateOrder(client, event);
    await recordWebhookEvent(client, event, link);
    return Response.json({ ok: true, matched: link.matched }, { status: 200 });
  } catch {
    // Service client couldn't be built / unexpected error: still 200 so RouteStack doesn't retry
    // forever, but signal we didn't persist. (Authentic event; our side failed, not theirs.)
    return Response.json({ ok: true, persisted: false }, { status: 200 });
  }
}
