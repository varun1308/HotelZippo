/* Phase 7 · the two-phase session orchestrator end-to-end against mock fixtures (key-free).
 * routestack.ts imports 'server-only' → alias to a no-op for the jsdom project. */
jest.mock('server-only', () => ({}));

import { searchAndRates, selectAndPaymentUrl, type SearchAndRatesInput } from '@/lib/booking/routestack';
import { _clearTokenCache } from '@/lib/booking/auth';
import type { RoomSelection } from '@/lib/booking/types';
import {
  makeMockFetch,
  FIXED_NOW,
  FIXED_NONCE,
  NO_AVAILABILITY_RESPONSE,
  OFFER_EXPIRED_RESPONSE,
  PAYMENT_URL_RESPONSE,
} from '@/tests/fixtures/routestack';

const ENV = { ROUTESTACK_API_KEY: 'rs_test_key', ROUTESTACK_API_SECRET: 'shhh', ROUTESTACK_API_URL: 'https://evolvemcp.routestack.ai' };

const INPUT: SearchAndRatesInput = {
  hotelId: 'local-uuid',
  hotelName: 'The Family Beach Resort',
  destination: 'Phuket',
  party: { adults: 2, childAges: [2, 7], rooms: 2 },
  dates: { checkIn: '2026-07-01', checkOut: '2026-07-05' },
};

const saved = { ...process.env };
beforeEach(() => {
  Object.assign(process.env, ENV);
  _clearTokenCache();
});
afterEach(() => {
  process.env = { ...saved };
  _clearTokenCache();
});

describe('searchAndRates (phase 1)', () => {
  it('runs the full chain and returns options + session handles', async () => {
    const { fetchImpl, calls } = makeMockFetch();
    const res = await searchAndRates(INPUT, { fetchImpl, now: FIXED_NOW, nonce: FIXED_NONCE });

    // Visited every step in order.
    const paths = calls.map((c) => c.path);
    expect(paths).toEqual([
      '/mcp/auth/partner-token',
      '/mcp/hotel/search-destinations',
      '/mcp/hotel/search-hotels',
      '/mcp/hotel/get-hotel-details-and-rates',
    ]);

    // Matched the hotel by name → real RouteStack id, not the local uuid.
    expect(res.hotelId).toBe('H-1001');
    expect(res.correlationId).toBe('corr-fixture-123');
    expect(res.token).toBe('listing-token-abc');
    expect(res.options).toHaveLength(2);
    expect(res.options[0]).toMatchObject({ recommendationId: 'reco-A', roomId: 'room-A', board: 'Breakfast included' });
  });

  it('threads correlationId + token + bearer into downstream calls', async () => {
    const { fetchImpl, calls } = makeMockFetch();
    await searchAndRates(INPUT, { fetchImpl, now: FIXED_NOW, nonce: FIXED_NONCE });

    const ratesCall = calls.find((c) => c.path === '/mcp/hotel/get-hotel-details-and-rates')!;
    expect(ratesCall.body).toMatchObject({ correlationId: 'corr-fixture-123', token: 'listing-token-abc', hotelId: 'H-1001' });
    expect(ratesCall.headers).toMatchObject({ Authorization: 'Bearer jwt-fixture-token' });
  });

  it('sends the confirmed party as rooms[] (children with ages in the first room)', async () => {
    const { fetchImpl, calls } = makeMockFetch();
    await searchAndRates(INPUT, { fetchImpl, now: FIXED_NOW, nonce: FIXED_NONCE });
    const search = calls.find((c) => c.path === '/mcp/hotel/search-hotels')!;
    const body = search.body as { rooms: Array<{ adults: number; children: number; childAges: number[] }>; currency: string };
    expect(body.currency).toBe('USD');
    expect(body.rooms[0]).toEqual({ adults: 1, children: 2, childAges: [2, 7] });
  });

  it('maps a 204 search envelope to a no-availability BookingError', async () => {
    const { fetchImpl } = makeMockFetch({ '/mcp/hotel/search-hotels': NO_AVAILABILITY_RESPONSE });
    await expect(searchAndRates(INPUT, { fetchImpl, now: FIXED_NOW, nonce: FIXED_NONCE })).rejects.toMatchObject({
      kind: 'no-availability',
      code: 204,
    });
  });

  it('raises not-found when the chosen hotel is not in the results', async () => {
    const { fetchImpl } = makeMockFetch();
    await expect(
      searchAndRates({ ...INPUT, hotelName: 'Some Other Hotel' }, { fetchImpl, now: FIXED_NOW, nonce: FIXED_NONCE }),
    ).rejects.toMatchObject({ kind: 'not-found' });
  });

  it('raises no-availability when details return no mappable rooms', async () => {
    const { fetchImpl } = makeMockFetch({ '/mcp/hotel/get-hotel-details-and-rates': { success: true, result: { rooms: [] } } });
    await expect(searchAndRates(INPUT, { fetchImpl, now: FIXED_NOW, nonce: FIXED_NONCE })).rejects.toMatchObject({
      kind: 'no-availability',
    });
  });

  it('throws a config error (no transport call) when env is missing', async () => {
    delete process.env.ROUTESTACK_API_SECRET;
    const { fetchImpl, calls } = makeMockFetch();
    await expect(searchAndRates(INPUT, { fetchImpl, now: FIXED_NOW, nonce: FIXED_NONCE })).rejects.toMatchObject({
      kind: 'config',
    });
    expect(calls).toHaveLength(0);
  });

  it('attaches a trace id to the error for Dash0 cross-reference', async () => {
    const { fetchImpl } = makeMockFetch({ '/mcp/hotel/search-hotels': NO_AVAILABILITY_RESPONSE });
    try {
      await searchAndRates(INPUT, { fetchImpl, now: FIXED_NOW, nonce: FIXED_NONCE });
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as { traceId?: string }).traceId).toBeDefined();
    }
  });
});

describe('selectAndPaymentUrl (phase 2)', () => {
  const SEL: RoomSelection = {
    hotelId: 'H-1001',
    hotelName: 'The Family Beach Resort',
    correlationId: 'corr-fixture-123',
    token: 'listing-token-abc',
    recommendationId: 'reco-A',
    roomId: 'room-A',
    dates: { checkIn: '2026-07-01', checkOut: '2026-07-05' },
  };

  it('revalidates then returns the deep-link booking_url', async () => {
    const { fetchImpl, calls } = makeMockFetch();
    const res = await selectAndPaymentUrl(SEL, { fetchImpl, now: FIXED_NOW, nonce: FIXED_NONCE });
    expect(res.bookingUrl).toBe(PAYMENT_URL_RESPONSE.url);

    const order = calls.map((c) => c.path);
    expect(order).toEqual(['/mcp/auth/partner-token', '/mcp/hotel/revalidate', '/mcp/hotel/get-payment-url']);
    const payment = calls.find((c) => c.path === '/mcp/hotel/get-payment-url')!;
    expect(payment.body).toMatchObject({ recommendationId: 'reco-A', roomId: 'room-A', correlationId: 'corr-fixture-123' });
  });

  it('maps a 5148 revalidate envelope to offer-expired', async () => {
    const { fetchImpl } = makeMockFetch({ '/mcp/hotel/revalidate': OFFER_EXPIRED_RESPONSE });
    await expect(selectAndPaymentUrl(SEL, { fetchImpl, now: FIXED_NOW, nonce: FIXED_NONCE })).rejects.toMatchObject({
      kind: 'offer-expired',
      code: 5148,
    });
  });
});
