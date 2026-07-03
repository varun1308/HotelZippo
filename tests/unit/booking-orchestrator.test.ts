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
  REVALIDATE_RESPONSE,
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

  it('extracts hotel display metadata (address/image/geo/rating) from the details content node (10c)', async () => {
    const { fetchImpl } = makeMockFetch();
    const res = await searchAndRates(INPUT, { fetchImpl, now: FIXED_NOW, nonce: FIXED_NONCE });
    expect(res.display).toEqual({
      hotelImage: 'https://cdn.example.test/beach-resort.jpg',
      hotelAddress: '99 Beach Rd, Patong, Phuket, Thailand',
      hotelLatitude: 7.8804,
      hotelLongitude: 98.3923,
      hotelStarRating: 5,
      hotelRating: 5,
    });
  });

  it('returns an empty display object (never throws) when details carry no content node', async () => {
    const { fetchImpl } = makeMockFetch({
      '/mcp/hotel/get-hotel-details-and-rates': { success: true, result: { hotelId: 'H-1001', rooms: [{ rates: [{ recommendationId: 'reco-A', roomId: 'room-A' }] }] } },
    });
    const res = await searchAndRates(INPUT, { fetchImpl, now: FIXED_NOW, nonce: FIXED_NONCE });
    expect(res.display).toEqual({});
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

  it('clears the cached JWT when RouteStack rejects the session, so the retry re-authenticates (L28)', async () => {
    const expired = { success: false, message: 'Your session has expired', code: 401, result: null };
    const bad = makeMockFetch({ '/mcp/hotel/search-hotels': expired });
    await expect(searchAndRates(INPUT, { fetchImpl: bad.fetchImpl, now: FIXED_NOW, nonce: FIXED_NONCE })).rejects.toMatchObject({
      kind: 'session-expired',
    });
    // The 'session-expired' guidance is "search again" — the retry must MINT A FRESH TOKEN, not
    // re-present the (server-side-invalidated) cached one for the rest of the 1h TTL.
    const good = makeMockFetch();
    await searchAndRates(INPUT, { fetchImpl: good.fetchImpl, now: FIXED_NOW, nonce: FIXED_NONCE });
    expect(good.calls.filter((c) => c.path === '/mcp/auth/partner-token')).toHaveLength(1);
  });

  it('follows nextResultsKey pagination when the hotel is beyond page 1 (M32)', async () => {
    const session = { correlationId: 'corr-fixture-123', token: 'listing-token-abc' };
    const page1 = { success: true, result: { ...session, count: 250, nextResultsKey: 'page-2', result: [{ id: 'H-9', name: 'Some Other Hotel' }] } };
    const page2 = { success: true, result: { ...session, count: 250, result: [{ id: 'H-1001', name: 'The Family Beach Resort' }] } };
    const base = makeMockFetch();
    let searchCalls = 0;
    const keysSent: Array<unknown> = [];
    const fetchImpl: typeof base.fetchImpl = async (path, body, headers) => {
      if (path === '/mcp/hotel/search-hotels') {
        searchCalls++;
        const key = (body as Record<string, unknown>).nextResultsKey;
        keysSent.push(key);
        return key === 'page-2' ? page2 : page1;
      }
      return base.fetchImpl(path, body, headers);
    };
    const res = await searchAndRates(INPUT, { fetchImpl, now: FIXED_NOW, nonce: FIXED_NONCE });
    expect(res.hotelId).toBe('H-1001');
    expect(res.correlationId).toBe('corr-fixture-123');
    expect(searchCalls).toBe(2);
    expect(keysSent).toEqual([undefined, 'page-2']);
  });

  it('bounds pagination: an endless nextResultsKey chain stops at 5 pages → not-found (M32)', async () => {
    const base = makeMockFetch();
    let searchCalls = 0;
    const fetchImpl: typeof base.fetchImpl = async (path, body, headers) => {
      if (path === '/mcp/hotel/search-hotels') {
        searchCalls++;
        return {
          success: true,
          result: {
            correlationId: 'corr-fixture-123',
            token: 'listing-token-abc',
            nextResultsKey: `page-${searchCalls + 1}`, // always another page, never the target
            result: [{ id: `H-${searchCalls}`, name: `Filler Hotel ${searchCalls}` }],
          },
        };
      }
      return base.fetchImpl(path, body, headers);
    };
    await expect(searchAndRates(INPUT, { fetchImpl, now: FIXED_NOW, nonce: FIXED_NONCE })).rejects.toMatchObject({
      kind: 'not-found',
    });
    expect(searchCalls).toBe(5); // page 1 + 4 bounded follow-ups
  });

  it('stall guard: a REPEATED nextResultsKey (server ignored the request key) stops after one follow-up', async () => {
    const base = makeMockFetch();
    let searchCalls = 0;
    const fetchImpl: typeof base.fetchImpl = async (path, body, headers) => {
      if (path === '/mcp/hotel/search-hotels') {
        searchCalls++;
        return {
          success: true,
          result: {
            correlationId: 'corr-fixture-123',
            token: 'listing-token-abc',
            nextResultsKey: 'page-2', // SAME key every time — the unconfirmed request field was ignored
            result: [{ id: `H-${searchCalls}`, name: `Filler Hotel ${searchCalls}` }],
          },
        };
      }
      return base.fetchImpl(path, body, headers);
    };
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(searchAndRates(INPUT, { fetchImpl, now: FIXED_NOW, nonce: FIXED_NONCE })).rejects.toMatchObject({
      kind: 'not-found',
    });
    expect(searchCalls).toBe(2); // page 1 + ONE follow-up that came back identical — not the full 5-page budget
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('pagination stalled'));
    warn.mockRestore();
  });

  it('stall guard: an EMPTY follow-up page stops the walk early', async () => {
    const base = makeMockFetch();
    let searchCalls = 0;
    const fetchImpl: typeof base.fetchImpl = async (path, body, headers) => {
      if (path === '/mcp/hotel/search-hotels') {
        searchCalls++;
        return {
          success: true,
          result: {
            correlationId: 'corr-fixture-123',
            token: 'listing-token-abc',
            nextResultsKey: `page-${searchCalls + 1}`,
            result: searchCalls === 1 ? [{ id: 'H-9', name: 'Some Other Hotel' }] : [], // page 2 empty
          },
        };
      }
      return base.fetchImpl(path, body, headers);
    };
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(searchAndRates(INPUT, { fetchImpl, now: FIXED_NOW, nonce: FIXED_NONCE })).rejects.toMatchObject({
      kind: 'not-found',
    });
    expect(searchCalls).toBe(2);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('empty page'));
    warn.mockRestore();
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

  it('sends the RouteStack checkout-page enrichment (10c, live-verified 2026-07-03): publishedRate on revalidate, display/destination/displayedPrice/travellers + priceCheckResult on get-payment-url', async () => {
    const { fetchImpl, calls } = makeMockFetch();
    const enriched: RoomSelection = {
      ...SEL,
      display: { hotelAddress: '99 Beach Rd, Patong, Phuket, Thailand', hotelImage: 'https://cdn.example.test/beach-resort.jpg', hotelLatitude: 7.8804, hotelLongitude: 98.3923, hotelStarRating: 5, hotelRating: 5 },
      destination: 'Phuket',
      displayedPrice: 175.14,
      party: { adults: 2, childAges: [], rooms: 1 },
    };
    await selectAndPaymentUrl(enriched, { fetchImpl, now: FIXED_NOW, nonce: FIXED_NONCE });

    const revalidate = calls.find((c) => c.path === '/mcp/hotel/revalidate')!;
    expect(revalidate.body).toMatchObject({ publishedRate: 175.14 });

    const payment = calls.find((c) => c.path === '/mcp/hotel/get-payment-url')!;
    expect(payment.body).toMatchObject({
      hotelAddress: '99 Beach Rd, Patong, Phuket, Thailand',
      hotelImage: 'https://cdn.example.test/beach-resort.jpg',
      hotelLatitude: 7.8804,
      hotelLongitude: 98.3923,
      hotelStarRating: 5,
      hotelRating: 5,
      destination: 'Phuket',
      displayedPrice: 175.14,
      travellers: 'Room 1: 2A/0C',
      priceCheckResult: REVALIDATE_RESPONSE,
    });
  });

  it('omits the enrichment fields (never sends undefined/guessed values) when the selection carries none', async () => {
    const { fetchImpl, calls } = makeMockFetch();
    await selectAndPaymentUrl(SEL, { fetchImpl, now: FIXED_NOW, nonce: FIXED_NONCE });
    const revalidate = calls.find((c) => c.path === '/mcp/hotel/revalidate')!;
    expect(revalidate.body).not.toHaveProperty('publishedRate');
    const payment = calls.find((c) => c.path === '/mcp/hotel/get-payment-url')!;
    for (const key of ['hotelAddress', 'hotelImage', 'hotelLatitude', 'hotelLongitude', 'hotelStarRating', 'hotelRating', 'destination', 'displayedPrice', 'travellers']) {
      expect(payment.body).not.toHaveProperty(key);
    }
    // priceCheckResult is always sent — it's the just-fetched revalidate result, never guessed.
    expect(payment.body).toMatchObject({ priceCheckResult: REVALIDATE_RESPONSE });
  });

  it('maps a 5148 revalidate envelope to offer-expired', async () => {
    const { fetchImpl } = makeMockFetch({ '/mcp/hotel/revalidate': OFFER_EXPIRED_RESPONSE });
    await expect(selectAndPaymentUrl(SEL, { fetchImpl, now: FIXED_NOW, nonce: FIXED_NONCE })).rejects.toMatchObject({
      kind: 'offer-expired',
      code: 5148,
    });
  });
});
