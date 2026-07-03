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

  it('SELF-HEALS a stale cached destination that yields zero hotels (L30)', async () => {
    // A pre-anchor mis-resolution (e.g. "Bali" → a Fiji islet id) cached with no TTL would be
    // served warm forever. When the cached id yields ZERO hotels, the orchestrator must
    // invalidate that row, re-resolve once, and retry the search with the fresh id.
    const base = makeMockFetch();
    const invalidated: string[] = [];
    const saved: CachedDestination[] = [];
    const cache: IdCache = {
      loadDestination: async () => ({ rsDestinationId: 'stale-fiji-islet', rsDestinationType: 'City', lat: -17.5, long: 179.0 }),
      saveDestination: async (_d, hit) => {
        saved.push(hit);
      },
      invalidateDestination: async (d) => {
        invalidated.push(d);
      },
      loadHotelRsId: async () => null,
      saveHotelRsId: async () => {},
    };
    const searchBodies: Array<Record<string, unknown>> = [];
    const fetchImpl: typeof base.fetchImpl = async (path, body, headers) => {
      if (path === '/mcp/hotel/search-hotels') {
        searchBodies.push(body as Record<string, unknown>);
        if ((body as Record<string, unknown>).destinationId === 'stale-fiji-islet') {
          // the mis-resolved destination: a successful envelope with an EMPTY hotel list
          return { success: true, result: { correlationId: 'corr-x', token: 'tok-x', result: [] } };
        }
      }
      return base.fetchImpl(path, body, headers); // fresh id ('900100') → normal inventory
    };

    const out = await searchAndRates(INPUT, deps(cache, fetchImpl));
    expect(invalidated).toEqual(['Phuket']); // the stale row was dropped
    expect(saved).toHaveLength(1); // …and the fresh resolution re-cached
    expect(saved[0]).toMatchObject({ rsDestinationId: '900100' });
    expect(searchBodies.map((b) => b.destinationId)).toEqual(['stale-fiji-islet', '900100']); // retried ONCE
    expect(out.hotelId).toBe('H-1001'); // the booking succeeded on the healed id
  });

  it('does NOT retry the search when re-resolution returns the SAME id (genuine empty inventory)', async () => {
    const base = makeMockFetch();
    const cache: IdCache = {
      loadDestination: async () => ({ rsDestinationId: '900100', rsDestinationType: 'City', lat: 7.88, long: 98.39 }),
      saveDestination: async () => {},
      invalidateDestination: async () => {},
      loadHotelRsId: async () => null,
      saveHotelRsId: async () => {},
    };
    let searches = 0;
    const fetchImpl: typeof base.fetchImpl = async (path, body, headers) => {
      if (path === '/mcp/hotel/search-hotels') {
        searches++;
        return { success: true, result: { correlationId: 'corr-x', token: 'tok-x', result: [] } };
      }
      return base.fetchImpl(path, body, headers); // search-destinations resolves the SAME 900100
    };
    // Fresh resolution matches the cached id → no second paid search; the empty inventory
    // propagates as the normal not-found outcome.
    await expect(searchAndRates(INPUT, deps(cache, fetchImpl))).rejects.toMatchObject({ kind: 'not-found' });
    expect(searches).toBe(1);
  });
});
