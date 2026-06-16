/* Phase 7 optimisation — searchAndRates with the RouteStack id cache (lib/booking/id-cache).
 * Proves the cache skips search-destinations on a hit, back-fills on a miss, matches the hotel by
 * cached id, and — critically — that a THROWING cache never breaks the booking (best-effort). */
import { searchAndRates } from '@/lib/booking/routestack';
import { _clearTokenCache } from '@/lib/booking/auth';
import type { IdCache, CachedDestination } from '@/lib/booking/id-cache';
import { makeMockFetch, FIXED_NOW, FIXED_NONCE } from '@/tests/fixtures/routestack';

// Dummy RouteStack creds so getPartnerToken can build its HMAC without a real key. CRITICAL for
// key-free CI: searchAndRates reads these BEFORE hitting the mock fetch, so without them the test
// throws "Missing ROUTESTACK_API_KEY" in CI (no creds) while passing locally off .env.local.
// Restored after each test. (Mirrors tests/unit/booking-orchestrator.test.ts.)
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

const INPUT = {
  hotelId: 'our-uuid-1',
  hotelName: 'The Family Beach Resort', // matches SEARCH_HOTELS_RESPONSE H-1001 by name
  destination: 'Phuket',
  party: { adults: 2, children: 1, childAges: [7], rooms: 1 },
  dates: { checkIn: '2026-08-01', checkOut: '2026-08-04' },
};

const deps = (cache: IdCache | undefined, fetchImpl: ReturnType<typeof makeMockFetch>['fetchImpl']) => ({
  fetchImpl,
  now: FIXED_NOW,
  nonce: FIXED_NONCE,
  cache,
});

/** A spyable in-memory cache. */
function fakeCache(seed?: { dest?: CachedDestination; hotelRsId?: string }) {
  const calls = { loadDestination: 0, saveDestination: 0, loadHotelRsId: 0, saveHotelRsId: 0 };
  const saved: { dest?: CachedDestination; hotelRsId?: string; hotelRsName?: string | null } = {};
  const cache: IdCache = {
    async loadDestination() {
      calls.loadDestination++;
      return seed?.dest ?? null;
    },
    async saveDestination(_d, hit) {
      calls.saveDestination++;
      saved.dest = hit;
    },
    async loadHotelRsId() {
      calls.loadHotelRsId++;
      return seed?.hotelRsId ?? null;
    },
    async saveHotelRsId(_h, rsId, rsName) {
      calls.saveHotelRsId++;
      saved.hotelRsId = rsId;
      saved.hotelRsName = rsName;
    },
  };
  return { cache, calls, saved };
}

const paths = (calls: Array<{ path: string }>) => calls.map((c) => c.path);

describe('searchAndRates — RouteStack id cache', () => {
  it('destination cache MISS: calls search-destinations and back-fills the cache', async () => {
    const { fetchImpl, calls } = makeMockFetch();
    const { cache, calls: cc, saved } = fakeCache(); // empty seed → miss
    await searchAndRates(INPUT, deps(cache, fetchImpl));
    expect(paths(calls)).toContain('/mcp/hotel/search-destinations');
    expect(cc.loadDestination).toBe(1);
    expect(cc.saveDestination).toBe(1);
    expect(saved.dest).toMatchObject({ rsDestinationId: '900100' }); // from DESTINATIONS_RESPONSE
  });

  it('destination cache HIT: SKIPS search-destinations and uses the stored handle', async () => {
    const { fetchImpl, calls } = makeMockFetch();
    const { cache, calls: cc } = fakeCache({
      dest: { rsDestinationId: '900100', rsDestinationType: 'City', lat: 7.88, long: 98.39 },
    });
    await searchAndRates(INPUT, deps(cache, fetchImpl));
    expect(paths(calls)).not.toContain('/mcp/hotel/search-destinations');
    expect(paths(calls)).toContain('/mcp/hotel/search-hotels'); // still runs (session token)
    expect(cc.saveDestination).toBe(0); // nothing to back-fill on a hit
  });

  it('hotel cache MISS: matches by name and back-fills the RouteStack hotel id', async () => {
    const { fetchImpl } = makeMockFetch();
    const { cache, calls: cc, saved } = fakeCache();
    const out = await searchAndRates(INPUT, deps(cache, fetchImpl));
    expect(out.hotelId).toBe('H-1001');
    expect(cc.saveHotelRsId).toBe(1);
    expect(saved.hotelRsId).toBe('H-1001');
    expect(saved.hotelRsName).toBe('The Family Beach Resort');
  });

  it('hotel cache HIT: matches by the stored id and does NOT re-save it', async () => {
    const { fetchImpl } = makeMockFetch();
    const { cache, calls: cc } = fakeCache({ hotelRsId: 'H-1001' });
    const out = await searchAndRates(INPUT, deps(cache, fetchImpl));
    expect(out.hotelId).toBe('H-1001');
    expect(cc.loadHotelRsId).toBe(1);
    expect(cc.saveHotelRsId).toBe(0); // same id already cached → no write
  });

  it('a THROWING cache never breaks the booking (best-effort warm-fail)', async () => {
    const { fetchImpl, calls } = makeMockFetch();
    const throwing: IdCache = {
      loadDestination: async () => {
        throw new Error('db down');
      },
      saveDestination: async () => {
        throw new Error('db down');
      },
      loadHotelRsId: async () => {
        throw new Error('db down');
      },
      saveHotelRsId: async () => {
        throw new Error('db down');
      },
    };
    const out = await searchAndRates(INPUT, deps(throwing, fetchImpl));
    // Falls back to the full live path: search-destinations runs, hotel matched by name.
    expect(paths(calls)).toContain('/mcp/hotel/search-destinations');
    expect(out.hotelId).toBe('H-1001');
    expect(out.options.length).toBeGreaterThan(0);
  });

  it('no cache provided (deps.cache undefined): behaves exactly as before', async () => {
    const { fetchImpl, calls } = makeMockFetch();
    const out = await searchAndRates(INPUT, deps(undefined, fetchImpl));
    expect(paths(calls)).toContain('/mcp/hotel/search-destinations');
    expect(out.hotelId).toBe('H-1001');
  });
});
