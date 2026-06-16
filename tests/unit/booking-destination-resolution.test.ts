/* PR-0 (10c / 12i) — destination disambiguation. RouteStack search-destinations returns several
 * geo-valid candidates for a free-text query (e.g. "Bali" → the real Bali State AND a Fiji islet);
 * picking the FIRST is the live-probe-confirmed bug. With a Google-Places anchor (deps.geocode) the
 * orchestrator must pick the candidate NEAREST the anchor; without/failed geocode it warm-falls to
 * the legacy first-valid pick. We assert on the destinationId actually sent to search-hotels. */
import { searchAndRates } from '@/lib/booking/routestack';
import { _clearTokenCache } from '@/lib/booking/auth';
import { makeMockFetch, FIXED_NOW, FIXED_NONCE, SEARCH_HOTELS_RESPONSE } from '@/tests/fixtures/routestack';

const ENV = { ROUTESTACK_API_KEY: 'rs_test_key', ROUTESTACK_API_SECRET: 'shhh', ROUTESTACK_API_URL: 'https://evolvemcp.routestack.ai' };
const savedEnv = { ...process.env };
beforeEach(() => {
  Object.assign(process.env, ENV);
  _clearTokenCache();
});
afterEach(() => {
  process.env = { ...savedEnv };
  _clearTokenCache();
});

// "Bali" — the real Bali State (id rs-bali, lat -8.34) is NOT first; a Fiji islet (id rs-fiji,
// lat -17.5) is first. This is the exact shape the live probe found.
const BALI_CANDIDATES = {
  success: true,
  message: 'data retrieved',
  code: 5128,
  result: [
    { type: 'City', fullName: 'Bali, Fiji', id: 'rs-fiji', coordinates: { lat: -17.5457, long: 177.684 } },
    { type: 'State', fullName: 'Bali, Indonesia', id: 'rs-bali', coordinates: { lat: -8.3405, long: 115.0919 } },
  ],
};

// The hotel the INPUT looks for must exist in search-hotels results regardless of destination.
const INPUT = {
  hotelId: 'our-uuid-1',
  hotelName: 'The Family Beach Resort', // matches SEARCH_HOTELS_RESPONSE H-1001
  destination: 'Bali',
  party: { adults: 2, children: 0, childAges: [], rooms: 1 },
  dates: { checkIn: '2026-08-01', checkOut: '2026-08-04' },
};

const baseDeps = (fetchImpl: ReturnType<typeof makeMockFetch>['fetchImpl']) => ({
  fetchImpl,
  now: FIXED_NOW,
  nonce: FIXED_NONCE,
});

/** destinationId sent to search-hotels (the observable proof of which candidate won). */
function searchHotelsDestId(calls: Array<{ path: string; body: unknown }>): string | undefined {
  const c = calls.find((x) => x.path === '/mcp/hotel/search-hotels');
  return (c?.body as { destinationId?: string } | undefined)?.destinationId;
}

describe('searchAndRates — destination disambiguation (PR-0)', () => {
  it('with a Google anchor near the REAL Bali, picks the nearest candidate (not the first)', async () => {
    const { fetchImpl, calls } = makeMockFetch({ '/mcp/hotel/search-destinations': BALI_CANDIDATES });
    const geocode = async () => ({ lat: -8.34, long: 115.09 }); // authoritative Bali, Indonesia
    await searchAndRates(INPUT, { ...baseDeps(fetchImpl), geocode });
    expect(searchHotelsDestId(calls)).toBe('rs-bali'); // NOT 'rs-fiji'
  });

  it('WITHOUT a geocoder, falls back to the legacy first-valid candidate', async () => {
    const { fetchImpl, calls } = makeMockFetch({ '/mcp/hotel/search-destinations': BALI_CANDIDATES });
    await searchAndRates(INPUT, baseDeps(fetchImpl)); // no geocode dep
    expect(searchHotelsDestId(calls)).toBe('rs-fiji'); // first valid (unchanged legacy behavior)
  });

  it('when the geocoder THROWS, warm-falls to first-valid — never breaks the booking', async () => {
    const { fetchImpl, calls } = makeMockFetch({ '/mcp/hotel/search-destinations': BALI_CANDIDATES });
    const geocode = async () => {
      throw new Error('no_key');
    };
    const out = await searchAndRates(INPUT, { ...baseDeps(fetchImpl), geocode });
    expect(searchHotelsDestId(calls)).toBe('rs-fiji'); // graceful fallback
    expect(out).toBeTruthy(); // flow completed
  });

  it('when the geocoder returns null (no match), falls back to first-valid', async () => {
    const { fetchImpl, calls } = makeMockFetch({ '/mcp/hotel/search-destinations': BALI_CANDIDATES });
    const geocode = async () => null;
    await searchAndRates(INPUT, { ...baseDeps(fetchImpl), geocode });
    expect(searchHotelsDestId(calls)).toBe('rs-fiji');
  });

  it('anchor disambiguation still works when the hotel list is the default fixture', async () => {
    // Sanity: with the anchor picking rs-bali, search-hotels still returns the fixture hotels and
    // the named hotel is matched (the rest of the flow is unaffected by the candidate choice).
    const { fetchImpl, calls } = makeMockFetch({ '/mcp/hotel/search-destinations': BALI_CANDIDATES });
    const geocode = async () => ({ lat: -8.34, long: 115.09 });
    await searchAndRates(INPUT, { ...baseDeps(fetchImpl), geocode });
    expect(searchHotelsDestId(calls)).toBe('rs-bali');
    expect(SEARCH_HOTELS_RESPONSE.result.result.some((h) => h.name === INPUT.hotelName)).toBe(true);
  });
});
