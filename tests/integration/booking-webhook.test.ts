/* 10d webhook route + correlation against LOCAL Supabase. Drives the real POST handler with example
 * RouteStack payloads → asserts the raw event lands in webhook_events (PII redacted) and the pending
 * booking_orders row links by billing_email + reflects the latest status; idempotent redelivery; an
 * unmatched event is still recorded. Cleans its own rows. */
import { POST } from '@/app/api/webhooks/routestack/route';
import { serviceClient } from './helpers';

jest.setTimeout(30_000);
const admin = serviceClient();
const EMAIL = `webhook-test+${Date.now()}@example.com`;
const ORDER_ID = `RSA-TEST-${Date.now()}`;

function post(body: unknown) {
  return POST(
    new Request('http://localhost/api/webhooks/routestack', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
}

const evt = (over: Record<string, unknown>) => ({
  event: 'BOOKING_SUCCESS',
  orderid: ORDER_ID,
  orderstatus: 'CONFIRMED',
  account_code: 'ACME-1234',
  billing_email: EMAIL,
  billing_name: 'Raj Mehta',
  price: 100,
  currency: 'USD',
  module: 'HOTEL',
  paymentstatus: 'COMPLETED',
  ...over,
});

async function cleanup() {
  await admin.from('webhook_events').delete().eq('rs_order_id', ORDER_ID);
  await admin.from('booking_orders').delete().eq('user_email', EMAIL);
}
beforeEach(cleanup);
afterAll(cleanup);

describe('POST /api/webhooks/routestack', () => {
  // no ROUTESTACK_WEBHOOK_SECRET in test env → verification skipped (dev/sandbox path)

  it('records the raw event with billing PII redacted', async () => {
    const res = await post(evt({}));
    expect(res.status).toBe(200);
    const { data } = await admin.from('webhook_events').select('event, payload, matched').eq('rs_order_id', ORDER_ID).single();
    expect(data?.event).toBe('BOOKING_SUCCESS');
    expect((data?.payload as any).billing_email).toBe('[redacted]');
    expect((data?.payload as any).billing_name).toBe('[redacted]');
    expect((data?.payload as any).orderid).toBe(ORDER_ID); // non-PII kept
  });

  it('links a pending booking_orders row by billing_email + applies status', async () => {
    // seed a pending (unlinked) order for this email
    await admin.from('booking_orders').insert({
      user_email: EMAIL, hotel_name: 'Wynn Las Vegas', check_in: '2026-07-10', check_out: '2026-07-12',
      correlation_id: 'corr-1', currency: 'USD', linked: false,
    });

    const res = await post(evt({}));
    const body = await res.json();
    expect(body.matched).toBe(true);

    const { data } = await admin.from('booking_orders').select('rs_order_id, order_status, payment_status, linked, last_event').eq('user_email', EMAIL).single();
    expect(data?.rs_order_id).toBe(ORDER_ID);
    expect(data?.order_status).toBe('CONFIRMED');
    expect(data?.payment_status).toBe('COMPLETED');
    expect(data?.linked).toBe(true);
    expect(data?.last_event).toBe('BOOKING_SUCCESS');
  });

  it('idempotent redelivery: a later event for the same orderid updates the same row', async () => {
    await admin.from('booking_orders').insert({
      user_email: EMAIL, hotel_name: 'Wynn', check_in: '2026-07-10', check_out: '2026-07-12', linked: false,
    });
    // first: payment authorized (INCOMPLETE)
    await post(evt({ event: 'ORDER_PAYMENT_AUTHORIZED', orderstatus: 'INCOMPLETE', paymentstatus: 'AUTHORIZED' }));
    // then: booking success (CONFIRMED) — same orderid
    await post(evt({}));

    const { data: orders } = await admin.from('booking_orders').select('order_status, payment_status').eq('user_email', EMAIL);
    expect(orders).toHaveLength(1); // not duplicated
    expect(orders![0].order_status).toBe('CONFIRMED');
    expect(orders![0].payment_status).toBe('COMPLETED');

    const { data: events } = await admin.from('webhook_events').select('event').eq('rs_order_id', ORDER_ID).order('received_at');
    expect(events!.map((e) => e.event)).toEqual(['ORDER_PAYMENT_AUTHORIZED', 'BOOKING_SUCCESS']); // full ordered history
  });

  it('unmatched event (no pending row for that email) is still recorded, matched=false', async () => {
    const res = await post(evt({ billing_email: `nobody+${Date.now()}@example.com` }));
    expect(res.status).toBe(200);
    expect((await res.json()).matched).toBe(false);
    const { data } = await admin.from('webhook_events').select('matched, booking_order_id').eq('rs_order_id', ORDER_ID).single();
    expect(data?.matched).toBe(false);
    expect(data?.booking_order_id).toBeNull();
  });

  it('non-HOTEL module is acked + skipped (200, not recorded)', async () => {
    const res = await post(evt({ module: 'FLIGHT' }));
    expect(res.status).toBe(200);
    expect((await res.json()).skipped).toBe('non_hotel_module');
    const { data } = await admin.from('webhook_events').select('id').eq('rs_order_id', ORDER_ID);
    expect(data).toHaveLength(0);
  });

  it('garbage body → 400, nothing recorded', async () => {
    const res = await POST(new Request('http://localhost/api/webhooks/routestack', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{ not json',
    }));
    expect(res.status).toBe(400);
  });
});
