/* RouteStack booking webhooks (lib/booking/webhook · specs/10d) — event parsing, shared-secret
 * verification, correlation logic (existing-order update / email-match / no-match), pending-order
 * write, and that the audit redacts billing PII. Fake Supabase client; no network. */
jest.mock('server-only', () => ({}));

import {
  parseWebhookEvent,
  verifyWebhookSecret,
  webhookSecretConfigured,
  correlateOrder,
  recordWebhookEvent,
  recordPendingOrder,
} from '@/lib/booking/webhook';
import type { SupabaseClient } from '@supabase/supabase-js';

const BOOKING_SUCCESS = {
  event: 'BOOKING_SUCCESS',
  orderid: 'RSA-1234567890',
  orderstatus: 'CONFIRMED',
  message: 'Booked hotel successfully',
  account_code: 'ACME-1234',
  billing_email: 'raj@example.com',
  billing_name: 'Raj Mehta',
  price: 100,
  currency: 'USD',
  module: 'HOTEL',
  event_timestamp: '2026-06-24T12:00:05Z',
  paymentstatus: 'COMPLETED',
};

describe('parseWebhookEvent', () => {
  it('accepts a valid event (and unknown extra keys pass through)', () => {
    const e = parseWebhookEvent({ ...BOOKING_SUCCESS, brand_new_field: 'x' });
    expect(e?.event).toBe('BOOKING_SUCCESS');
    expect((e as any).brand_new_field).toBe('x');
  });
  it('accepts orderid: null (early CREATION_FAILED)', () => {
    expect(parseWebhookEvent({ event: 'ORDER_CREATION_FAILED', orderid: null })?.orderid).toBeNull();
  });
  it('rejects a body with no event', () => {
    expect(parseWebhookEvent({ orderid: 'x' })).toBeNull();
    expect(parseWebhookEvent('garbage')).toBeNull();
    expect(parseWebhookEvent(null)).toBeNull();
  });
});

describe('verifyWebhookSecret', () => {
  const ORIG = process.env.ROUTESTACK_WEBHOOK_SECRET;
  afterEach(() => {
    if (ORIG === undefined) delete process.env.ROUTESTACK_WEBHOOK_SECRET;
    else process.env.ROUTESTACK_WEBHOOK_SECRET = ORIG;
  });
  const reqWith = (headers: Record<string, string>, url = 'https://h/api/webhooks/routestack') => ({
    headers: { get: (n: string) => headers[n.toLowerCase()] ?? null },
    url,
  });

  it('unset secret → skips verification (returns true)', () => {
    delete process.env.ROUTESTACK_WEBHOOK_SECRET;
    expect(verifyWebhookSecret(reqWith({}))).toBe(true);
    expect(webhookSecretConfigured()).toBe(false);
  });
  it('matches via x-webhook-key header', () => {
    process.env.ROUTESTACK_WEBHOOK_SECRET = 's3cr3t';
    expect(verifyWebhookSecret(reqWith({ 'x-webhook-key': 's3cr3t' }))).toBe(true);
    expect(webhookSecretConfigured()).toBe(true);
  });
  it('matches via Authorization: Bearer', () => {
    process.env.ROUTESTACK_WEBHOOK_SECRET = 's3cr3t';
    expect(verifyWebhookSecret(reqWith({ authorization: 'Bearer s3cr3t' }))).toBe(true);
  });
  it('matches via query param', () => {
    process.env.ROUTESTACK_WEBHOOK_SECRET = 's3cr3t';
    expect(verifyWebhookSecret(reqWith({}, 'https://h/api/webhooks/routestack?key=s3cr3t'))).toBe(true);
  });
  it('mismatch / missing → false when configured', () => {
    process.env.ROUTESTACK_WEBHOOK_SECRET = 's3cr3t';
    expect(verifyWebhookSecret(reqWith({ 'x-webhook-key': 'wrong' }))).toBe(false);
    expect(verifyWebhookSecret(reqWith({}))).toBe(false);
  });
});

/* ---- fake supabase client for correlation/persistence ------------------- */

interface FakeState {
  /** booking_orders rows. */
  orders: Array<Record<string, any>>;
  inserts: { booking_orders: any[]; webhook_events: any[] };
  updates: Array<{ id: string; patch: Record<string, any> }>;
}

function fakeClient(state: FakeState): SupabaseClient {
  const builder = (table: string) => {
    if (table === 'booking_orders') {
      // a tiny query builder supporting the two read shapes used by correlateOrder
      const ctx: any = { filters: {} as Record<string, any>, _linkedFalse: false };
      const chain: any = {
        select: () => chain,
        eq: (col: string, val: any) => { ctx.filters[col] = val; if (col === 'linked' && val === false) ctx._linkedFalse = true; return chain; },
        ilike: (col: string, val: any) => { ctx.ilike = { col, val }; return chain; },
        gte: () => chain,
        order: () => chain,
        limit: () => chain,
        maybeSingle: async () => {
          if (ctx.filters.rs_order_id !== undefined) {
            const row = state.orders.find((o) => o.rs_order_id === ctx.filters.rs_order_id);
            return { data: row ?? null };
          }
          if (ctx.ilike) {
            const row = [...state.orders]
              .filter((o) => o.linked === false && String(o.user_email).toLowerCase() === String(ctx.ilike.val).toLowerCase())
              .sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))[0];
            return { data: row ?? null };
          }
          return { data: null };
        },
        update: (patch: Record<string, any>) => ({
          eq: async (_c: string, id: string) => {
            state.updates.push({ id, patch });
            const row = state.orders.find((o) => o.id === id);
            if (row) Object.assign(row, patch);
            return { error: null };
          },
        }),
        insert: async (row: any) => { state.inserts.booking_orders.push(row); return { error: null }; },
      };
      return chain;
    }
    if (table === 'webhook_events') {
      return { insert: async (row: any) => { state.inserts.webhook_events.push(row); return { error: null }; } };
    }
    throw new Error(`unexpected table ${table}`);
  };
  return { from: builder } as unknown as SupabaseClient;
}

function freshState(orders: Array<Record<string, any>> = []): FakeState {
  return { orders, inserts: { booking_orders: [], webhook_events: [] }, updates: [] };
}

describe('correlateOrder', () => {
  it('existing order by rs_order_id → updates status (idempotent redelivery)', async () => {
    const state = freshState([{ id: 'o1', rs_order_id: 'RSA-1234567890', linked: true }]);
    const res = await correlateOrder(fakeClient(state), BOOKING_SUCCESS as any);
    expect(res).toEqual({ bookingOrderId: 'o1', matched: true });
    expect(state.updates[0].patch.order_status).toBe('CONFIRMED');
    expect(state.updates[0].patch.payment_status).toBe('COMPLETED');
    expect(state.updates[0].patch.last_event).toBe('BOOKING_SUCCESS');
  });

  it('no rs_order_id match → matches a pending row by billing_email + links it', async () => {
    const state = freshState([
      { id: 'p1', rs_order_id: null, linked: false, user_email: 'raj@example.com', created_at: '2026-06-24T11:00:00Z' },
    ]);
    const res = await correlateOrder(fakeClient(state), BOOKING_SUCCESS as any);
    expect(res).toEqual({ bookingOrderId: 'p1', matched: true });
    const patch = state.updates[0].patch;
    expect(patch.rs_order_id).toBe('RSA-1234567890');
    expect(patch.linked).toBe(true);
    expect(patch.order_status).toBe('CONFIRMED');
  });

  it('email match is case-insensitive', async () => {
    const state = freshState([
      { id: 'p1', rs_order_id: null, linked: false, user_email: 'RAJ@Example.com', created_at: '2026-06-24T11:00:00Z' },
    ]);
    const res = await correlateOrder(fakeClient(state), BOOKING_SUCCESS as any);
    expect(res.matched).toBe(true);
  });

  it('no matching pending row → matched:false (event still recorded by caller)', async () => {
    const state = freshState([
      { id: 'p1', rs_order_id: null, linked: false, user_email: 'someone-else@example.com', created_at: '2026-06-24T11:00:00Z' },
    ]);
    const res = await correlateOrder(fakeClient(state), BOOKING_SUCCESS as any);
    expect(res).toEqual({ bookingOrderId: null, matched: false });
  });

  it('does NOT relink an already-linked pending row by email', async () => {
    const state = freshState([
      { id: 'p1', rs_order_id: 'RSA-OTHER', linked: true, user_email: 'raj@example.com', created_at: '2026-06-24T11:00:00Z' },
    ]);
    // event orderid RSA-1234567890 doesn't match p1's rs_order_id, and p1 is linked → no email match
    const res = await correlateOrder(fakeClient(state), BOOKING_SUCCESS as any);
    expect(res.matched).toBe(false);
  });
});

describe('recordWebhookEvent — redaction', () => {
  it('persists the event with billing_email/name REDACTED', async () => {
    const state = freshState();
    await recordWebhookEvent(fakeClient(state), BOOKING_SUCCESS as any, { bookingOrderId: 'o1', matched: true });
    const row = state.inserts.webhook_events[0];
    expect(row.event).toBe('BOOKING_SUCCESS');
    expect(row.rs_order_id).toBe('RSA-1234567890');
    expect(row.matched).toBe(true);
    expect(row.booking_order_id).toBe('o1');
    expect(row.payload.billing_email).toBe('[redacted]');
    expect(row.payload.billing_name).toBe('[redacted]');
    expect(row.payload.orderid).toBe('RSA-1234567890'); // non-PID kept
  });
});

describe('recordPendingOrder', () => {
  it('inserts a linked=false pending row from the handoff', async () => {
    const state = freshState();
    await recordPendingOrder(fakeClient(state), {
      userId: 'u1', userEmail: 'raj@example.com', hotelId: 'H-1', hotelName: 'Wynn',
      checkIn: '2026-07-10', checkOut: '2026-07-12', correlationId: 'corr-1', currency: 'USD',
    });
    const row = state.inserts.booking_orders[0];
    expect(row.user_id).toBe('u1');
    expect(row.user_email).toBe('raj@example.com');
    expect(row.hotel_name).toBe('Wynn');
    expect(row.correlation_id).toBe('corr-1');
    expect(row.linked).toBe(false);
  });
});
