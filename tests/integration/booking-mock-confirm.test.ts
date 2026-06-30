/* Mock-confirm route (specs/10e-booking-mock.md) — the demo "Confirm booking" handler.
 *
 * Proves the prod-safety gating (403 when ROUTESTACK_MOCK is off), the auth gate (401 when anonymous),
 * and that — when enabled + signed-in — it SELF-EMITS a real BOOKING_SUCCESS event carrying the user's
 * email (the billing_email the webhook correlates by) to /api/webhooks/routestack, signed with the
 * webhook secret. `fetch` + the Supabase SSR client are mocked; no DB/network needed.
 *
 * Node project: uses Request/Response (absent in jsdom). */

// Mock the SSR Supabase client → control auth.getUser().
let mockUser: { id: string; email: string | null; user_metadata?: Record<string, unknown> } | null = null;
jest.mock('@/lib/db/ssr', () => ({
  createSupabaseServerClient: () => ({
    auth: { getUser: async () => ({ data: { user: mockUser } }) },
  }),
}));
jest.mock('next/headers', () => ({
  cookies: async () => ({ getAll: () => [] }),
}));

import { POST } from '@/app/api/booking/mock-confirm/route';

const savedEnv = { ...process.env };
let fetchMock: jest.Mock;
beforeEach(() => {
  mockUser = null;
  process.env = { ...savedEnv };
  fetchMock = jest.fn(async () => new Response(JSON.stringify({ ok: true, matched: true }), { status: 200 }));
  global.fetch = fetchMock as unknown as typeof fetch;
});
afterEach(() => {
  process.env = { ...savedEnv };
});

function post(body: unknown) {
  return POST(
    new Request('http://localhost/api/booking/mock-confirm', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
}

describe('POST /api/booking/mock-confirm', () => {
  it('403s when ROUTESTACK_MOCK is off (prod-safe by default)', async () => {
    delete process.env.ROUTESTACK_MOCK;
    mockUser = { id: 'u1', email: 'raj@example.com' };
    const res = await post({ session: 's1', hotel: 'The Beach Resort' });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('mock_disabled');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('401s an anonymous caller even when mock is on', async () => {
    process.env.ROUTESTACK_MOCK = '1';
    mockUser = null;
    const res = await post({ session: 's1' });
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('self-emits a BOOKING_SUCCESS webhook with the user email + secret header', async () => {
    process.env.ROUTESTACK_MOCK = '1';
    process.env.ROUTESTACK_WEBHOOK_SECRET = 'shh-secret';
    mockUser = { id: 'u1', email: 'raj@example.com', user_metadata: { full_name: 'Raj Mehta' } };

    const res = await post({ session: 'corr-123', hotel: 'The Beach Resort', checkIn: '2026-08-01', checkOut: '2026-08-04' });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.matched).toBe(true);
    expect(json.orderId).toMatch(/^MOCK-/);

    // It POSTed to our own webhook route, signed, with a correlatable BOOKING_SUCCESS payload.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('http://localhost/api/webhooks/routestack');
    expect((init.headers as Record<string, string>)['x-webhook-key']).toBe('shh-secret');
    const sent = JSON.parse(init.body as string);
    expect(sent.event).toBe('BOOKING_SUCCESS');
    expect(sent.module).toBe('HOTEL');
    expect(sent.billing_email).toBe('raj@example.com'); // the correlation handle
    expect(sent.orderstatus).toBe('CONFIRMED');
    expect(sent.paymentstatus).toBe('COMPLETED');
  });

  it('omits the secret header when ROUTESTACK_WEBHOOK_SECRET is unset (dev path)', async () => {
    process.env.ROUTESTACK_MOCK = '1';
    delete process.env.ROUTESTACK_WEBHOOK_SECRET;
    mockUser = { id: 'u1', email: 'raj@example.com' };
    await post({ session: 's1' });
    const [, init] = fetchMock.mock.calls[0];
    expect((init.headers as Record<string, string>)['x-webhook-key']).toBeUndefined();
  });

  it('never dead-ends the demo if the self-fetch throws', async () => {
    process.env.ROUTESTACK_MOCK = '1';
    mockUser = { id: 'u1', email: 'raj@example.com' };
    fetchMock.mockRejectedValueOnce(new Error('self-fetch blocked'));
    const res = await post({ session: 's1' });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.webhook).toBe('unreachable');
  });
});
