/* POST /api/booking/mock-confirm — demo-only booking confirmation (specs/10e-booking-mock.md).
 *
 * The mock deep link hands the user to the in-app /booking-demo checkout page. When they click
 * "Confirm booking", that page POSTs here. We then SELF-EMIT a real RouteStack `BOOKING_SUCCESS`
 * webhook event to our OWN /api/webhooks/routestack — exactly the payload a live RouteStack delivery
 * would carry (10d) — so the REAL webhook code path runs: verify secret → redact + persist
 * webhook_events → correlate the pending booking_orders row by billing_email → flip it CONFIRMED.
 *
 * Why self-emit rather than write the DB directly: the demo then proves the production correlation +
 * lifecycle plumbing (the part 10d added), not just a cosmetic status. The only faked thing is the
 * upstream RouteStack transport.
 *
 * Gated on the server-only ROUTESTACK_MOCK=1 flag (same flag the booking routes use). Off → 403, so a
 * production deploy without demo mode can never be confirmed through here. Behind the auth gate — only
 * a signed-in user (whose email becomes the event's billing_email) can confirm.
 *
 * Server-side; never a client module. */
import { cookies } from 'next/headers';
import { createSupabaseServerClient } from '@/lib/db/ssr';
import { routeStackMockEnabled } from '@/lib/booking/mock-transport';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface MockConfirmBody {
  /** The mock session id (correlationId) the deep link carried — becomes part of the order id. */
  session?: string;
  hotel?: string;
  checkIn?: string;
  checkOut?: string;
}

export async function POST(req: Request): Promise<Response> {
  // Demo-only: refuse unless mock mode is on. A live deploy (flag unset) 403s here.
  if (!routeStackMockEnabled()) {
    return Response.json({ ok: false, error: 'mock_disabled' }, { status: 403 });
  }

  let body: MockConfirmBody;
  try {
    body = (await req.json()) as MockConfirmBody;
  } catch {
    body = {};
  }

  // Auth gate: the signed-in user's email is the billing_email the webhook correlates by.
  const cookieStore = await cookies();
  const supabase = createSupabaseServerClient({ getAll: () => cookieStore.getAll(), setAll: () => {} });
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 });

  // Build the RouteStack BOOKING_SUCCESS event (10d shape). orderid derives from the mock session so
  // redelivery is idempotent; billing_email = the signed-in user → the pending row matches.
  const orderId = `MOCK-${(body.session ?? 'session').replace(/[^a-z0-9-]/gi, '').slice(0, 32)}`;
  const event = {
    event: 'BOOKING_SUCCESS',
    orderid: orderId,
    orderstatus: 'CONFIRMED',
    paymentstatus: 'COMPLETED',
    module: 'HOTEL',
    billing_email: user.email ?? null,
    billing_name: user.user_metadata?.full_name ?? null,
    createdat: new Date().toISOString(),
    message: 'Hotel booked (demo)',
  };

  // POST it to our OWN webhook route so the real verification + correlation runs end-to-end. We sign
  // it with ROUTESTACK_WEBHOOK_SECRET (when set) so the route's shared-secret check passes; when unset
  // (dev) the route already skips verification + warns.
  const origin = new URL(req.url).origin;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const secret = process.env.ROUTESTACK_WEBHOOK_SECRET;
  if (secret) headers['x-webhook-key'] = secret;

  try {
    const res = await fetch(`${origin}/api/webhooks/routestack`, {
      method: 'POST',
      headers,
      body: JSON.stringify(event),
      cache: 'no-store',
    });
    const result = (await res.json().catch(() => ({}))) as { matched?: boolean };
    return Response.json({ ok: true, orderId, matched: !!result.matched }, { status: 200 });
  } catch {
    // The booking is still "confirmed" from the user's perspective — the demo page shows success; we
    // just couldn't drive the webhook leg (e.g. self-fetch blocked). Never dead-end the demo.
    return Response.json({ ok: true, orderId, matched: false, webhook: 'unreachable' }, { status: 200 });
  }
}
