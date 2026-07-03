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

  it('unset secret → skips verification OUTSIDE production only (dev/sandbox allowance)', () => {
    delete process.env.ROUTESTACK_WEBHOOK_SECRET;
    expect(verifyWebhookSecret(reqWith({}))).toBe(true); // jest runs with NODE_ENV=test
    expect(webhookSecretConfigured()).toBe(false);
  });
  it('unset secret in PRODUCTION → fails closed (rejects every delivery)', () => {
    delete process.env.ROUTESTACK_WEBHOOK_SECRET;
    const prevNodeEnv = process.env.NODE_ENV;
    (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
    try {
      expect(verifyWebhookSecret(reqWith({}))).toBe(false);
      expect(verifyWebhookSecret(reqWith({ 'x-webhook-key': 'anything' }))).toBe(false);
    } finally {
      (process.env as Record<string, string | undefined>).NODE_ENV = prevNodeEnv;
    }
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
  it('REJECTS query-param carriers (a secret in the URL is persisted by request logs)', () => {
    process.env.ROUTESTACK_WEBHOOK_SECRET = 's3cr3t';
    expect(verifyWebhookSecret(reqWith({}, 'https://h/api/webhooks/routestack?key=s3cr3t'))).toBe(false);
    expect(verifyWebhookSecret(reqWith({}, 'https://h/api/webhooks/routestack?access_key=s3cr3t'))).toBe(false);
  });
  it('mismatch / missing → false when configured', () => {
    process.env.ROUTESTACK_WEBHOOK_SECRET = 's3cr3t';
    expect(verifyWebhookSecret(reqWith({ 'x-webhook-key': 'wrong' }))).toBe(false);
    expect(verifyWebhookSecret(reqWith({}))).toBe(false);
  });
});

/* ---- fake supabase client for correlation/persistence ------------------- */

/** Interpret an ILIKE pattern the way Postgres does (case-insensitive; % = any run, _ = any one
 * char; backslash escapes a metachar) — so these tests actually prove billing_email is matched as
 * a LITERAL (escaped), not as a pattern. */
function ilikeToRegex(pattern: string): RegExp {
  const escapeRe = (c: string) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let out = '';
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === '\\' && i + 1 < pattern.length) {
      out += escapeRe(pattern[++i]);
    } else if (ch === '%') {
      out += '.*';
    } else if (ch === '_') {
      out += '.';
    } else {
      out += escapeRe(ch);
    }
  }
  return new RegExp(`^${out}$`, 'i');
}

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
            const re = ilikeToRegex(String(ctx.ilike.val));
            const row = [...state.orders]
              .filter((o) => o.linked === false && re.test(String(o.user_email)))
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

  it('matches an email containing `_` LITERALLY — `_` is not a one-char wildcard (H6)', async () => {
    // Unescaped, ilike would let 'raj_mehta@…' match 'rajxmehta@…' (`_` = any char) → wrong user.
    const state = freshState([
      { id: 'wrong', rs_order_id: null, linked: false, user_email: 'rajxmehta@example.com', created_at: '2026-06-24T11:30:00Z' },
      { id: 'right', rs_order_id: null, linked: false, user_email: 'raj_mehta@example.com', created_at: '2026-06-24T11:00:00Z' },
    ]);
    const res = await correlateOrder(fakeClient(state), { ...BOOKING_SUCCESS, billing_email: 'raj_mehta@example.com' } as any);
    expect(res).toEqual({ bookingOrderId: 'right', matched: true });
  });

  it("a crafted '%' billing_email matches NOTHING (no wildcard linking of arbitrary orders)", async () => {
    const state = freshState([
      { id: 'p1', rs_order_id: null, linked: false, user_email: 'raj@example.com', created_at: '2026-06-24T11:00:00Z' },
    ]);
    const res = await correlateOrder(fakeClient(state), { ...BOOKING_SUCCESS, billing_email: '%' } as any);
    expect(res).toEqual({ bookingOrderId: null, matched: false });
    expect(state.updates).toHaveLength(0); // the pending row was not consumed
  });

  it('a null-orderid failure event does NOT consume the pending row; the successful retry links (M30)', async () => {
    // ORDER_CREATION_FAILED (10d table) carries orderid:null. If it linked the row (linked=true,
    // rs_order_id=null), the user's successful retry could never correlate — step 1 finds no
    // rs_order_id row, step 2 finds no linked=false row → confirmed booking untracked forever.
    const state = freshState([
      { id: 'p1', rs_order_id: null, linked: false, user_email: 'raj@example.com', created_at: '2026-06-24T11:00:00Z' },
    ]);
    const failed = { event: 'ORDER_CREATION_FAILED', orderid: null, orderstatus: 'INCOMPLETE', billing_email: 'raj@example.com', module: 'HOTEL' };
    const res1 = await correlateOrder(fakeClient(state), failed as any);
    expect(res1).toEqual({ bookingOrderId: null, matched: false }); // recorded by the caller, row untouched
    expect(state.updates).toHaveLength(0);
    expect(state.orders[0].linked).toBe(false);

    // The retry succeeds with a real orderid → the pending row links normally.
    const res2 = await correlateOrder(fakeClient(state), BOOKING_SUCCESS as any);
    expect(res2).toEqual({ bookingOrderId: 'p1', matched: true });
    expect(state.orders[0].linked).toBe(true);
    expect(state.orders[0].rs_order_id).toBe('RSA-1234567890');
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
