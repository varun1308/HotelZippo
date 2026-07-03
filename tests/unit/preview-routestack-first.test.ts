/* Preview seeding — RouteStack-FIRST flow (12i no-Claude). seedPreviewFromRouteStack takes the real
 * hotels RouteStack returns + their grounded hero images and stages them as source='preview'. Faked
 * RouteStack transport (search + details-with-heroImage) + faked Supabase upsert. */
import { seedPreviewFromRouteStack } from '@/lib/preview/verify';
import { makeMockFetch, FIXED_NOW, FIXED_NONCE } from '@/tests/fixtures/routestack';
import type { SupabaseClient } from '@supabase/supabase-js';

const ENV = { ROUTESTACK_API_KEY: 'rs_test_key', ROUTESTACK_API_SECRET: 'shhh', ROUTESTACK_API_URL: 'https://evolvemcp.routestack.ai' };
const savedEnv = { ...process.env };
beforeEach(() => {
  Object.assign(process.env, ENV);
  // next/jest loads .env.local, where a dev machine may have ROUTESTACK_MOCK=1 — the M26 guard
  // would then (correctly) no-op every seed. Tests control the flag explicitly.
  delete process.env.ROUTESTACK_MOCK;
});
afterEach(() => {
  process.env = { ...savedEnv };
});

const SEARCH = {
  success: true, message: null, code: 200,
  result: {
    correlationId: 'corr-x', token: 'tok-x', currency: 'USD', count: 2,
    result: [
      { id: 'RS-1', name: 'Alassari Plantation', starRating: 4, ourprice: 200 },
      { id: 'RS-2', name: 'Saridevi Ecolodge', starRating: 3, ourprice: 120 },
    ],
  },
};
// details payload carrying a grounded hero image (the real RouteStack shape: result.content.heroImage)
const DETAILS = {
  success: true, message: null, code: 200,
  result: { content: { heroImage: 'https://i.travelapi.com/lodging/abc/hero_b.jpg' }, availability: { groups: [] } },
};
const DATES = { checkIn: '2026-08-01', checkOut: '2026-08-04' };

function fakeClient(existing: Array<{ name: string; source: string }> = []) {
  const upserts: { rows: Array<Record<string, unknown>> }[] = [];
  const client = {
    from() {
      return {
        // The 12i-B guard reads the destination's current hotels (select name+source → eq).
        select() {
          return { eq: () => Promise.resolve({ data: existing, error: null }) };
        },
        upsert(rows: Array<Record<string, unknown>>) {
          upserts.push({ rows });
          // The seed now reads ids back via .select('id, name') to cache the RS-id mapping.
          return {
            select() {
              const data = rows.map((r, i) => ({ id: `our-${i}`, name: r.name }));
              return Promise.resolve({ data, error: null });
            },
          };
        },
      };
    },
  } as unknown as SupabaseClient;
  return { client, upserts };
}

/** A spyable IdCache to assert the RS-id mapping is persisted. */
function fakeCache() {
  const saved: Array<{ ourId: string; rsId: string; name: string | null }> = [];
  const cache = {
    loadDestination: async () => null,
    saveDestination: async () => {},
    loadHotelRsId: async () => null,
    saveHotelRsId: async (ourId: string, rsId: string, name: string | null) => {
      saved.push({ ourId, rsId, name });
    },
  };
  return { cache, saved };
}

const deps = (fetchImpl: ReturnType<typeof makeMockFetch>['fetchImpl'], cache?: ReturnType<typeof fakeCache>['cache']) => ({ fetchImpl, now: FIXED_NOW, nonce: FIXED_NONCE, cache });

describe('seedPreviewFromRouteStack', () => {
  it('stages RouteStack inventory as source=preview with grounded hero images', async () => {
    const { fetchImpl } = makeMockFetch({ '/mcp/hotel/search-hotels': SEARCH, '/mcp/hotel/get-hotel-details-and-rates': DETAILS });
    const { client, upserts } = fakeClient();

    const res = await seedPreviewFromRouteStack(client, 'Bali', deps(fetchImpl), { dates: DATES });

    expect(res.found).toBe(2);
    expect(res.staged).toBe(2);
    expect(res.hotels.map((h) => h.name).sort()).toEqual(['Alassari Plantation', 'Saridevi Ecolodge']);
    expect(res.hotels.every((h) => h.hasImage)).toBe(true);

    // Every upserted row is preview, in Bali, with the RouteStack hero image.
    const rows = upserts[0].rows;
    expect(rows.every((r) => r.source === 'preview' && r.destination === 'Bali')).toBe(true);
    expect(rows.every((r) => Array.isArray(r.images) && (r.images as string[])[0].includes('travelapi.com'))).toBe(true);
    // 4★ stays 4; 3★ stays 3 (both valid); price_tier is mid-range (not 5★).
    expect(rows.find((r) => r.name === 'Alassari Plantation')?.star_rating).toBe(4);
    expect(rows.every((r) => r.price_tier === 'mid-range')).toBe(true);
  });

  it('caches the RouteStack id↔our-id mapping when a cache is provided (booking optimization)', async () => {
    const { fetchImpl } = makeMockFetch({ '/mcp/hotel/search-hotels': SEARCH, '/mcp/hotel/get-hotel-details-and-rates': DETAILS });
    const { client } = fakeClient();
    const { cache, saved } = fakeCache();
    await seedPreviewFromRouteStack(client, 'Bali', deps(fetchImpl, cache), { dates: DATES });
    // Each staged hotel's RS id is mapped to our hotels.id.
    expect(saved.map((s) => s.rsId).sort()).toEqual(['RS-1', 'RS-2']);
    expect(saved.every((s) => s.ourId.startsWith('our-'))).toBe(true);
  });

  it('respects the limit (only stages the top N)', async () => {
    const { fetchImpl } = makeMockFetch({ '/mcp/hotel/search-hotels': SEARCH, '/mcp/hotel/get-hotel-details-and-rates': DETAILS });
    const { client } = fakeClient();
    const res = await seedPreviewFromRouteStack(client, 'Bali', deps(fetchImpl), { dates: DATES, limit: 1 });
    expect(res.found).toBe(1);
    expect(res.staged).toBe(1);
  });

  it('stages with a null image (placeholder) when the details call has no hero', async () => {
    const noHero = { success: true, message: null, code: 200, result: { content: {}, availability: { groups: [] } } };
    const { fetchImpl } = makeMockFetch({ '/mcp/hotel/search-hotels': SEARCH, '/mcp/hotel/get-hotel-details-and-rates': noHero });
    const { client, upserts } = fakeClient();
    const res = await seedPreviewFromRouteStack(client, 'Bali', deps(fetchImpl), { dates: DATES });
    expect(res.hotels.every((h) => h.hasImage)).toBe(false);
    expect(upserts[0].rows.every((r) => r.images === null)).toBe(true); // → card placeholder, never broken img
  });

  it('returns found:0 staged:0 when RouteStack has no inventory', async () => {
    const empty = { success: true, message: null, code: 200, result: { correlationId: 'c', token: 't', result: [] } };
    const { fetchImpl } = makeMockFetch({ '/mcp/hotel/search-hotels': empty });
    const { client, upserts } = fakeClient();
    const res = await seedPreviewFromRouteStack(client, 'Bali', deps(fetchImpl), { dates: DATES });
    expect(res).toEqual({ found: 0, staged: 0, hotels: [] });
    expect(upserts).toHaveLength(0);
  });

  // M24 (12i-B): never overwrite a curated destination with preview rows.
  it('refuses to seed a destination that already has curated hotels', async () => {
    const { fetchImpl } = makeMockFetch({ '/mcp/hotel/search-hotels': SEARCH, '/mcp/hotel/get-hotel-details-and-rates': DETAILS });
    const { client, upserts } = fakeClient([{ name: 'Alassari Plantation', source: 'curated' }]);
    await expect(seedPreviewFromRouteStack(client, 'Bali', deps(fetchImpl), { dates: DATES })).rejects.toThrow(
      /either curated OR preview/,
    );
    expect(upserts).toHaveLength(0);
  });

  // M26 (10e AC5): mock transport → no-op; no hotels rows, no id-cache writes.
  it('no-ops with deps.mock (nothing staged, id-cache untouched)', async () => {
    const { fetchImpl } = makeMockFetch({ '/mcp/hotel/search-hotels': SEARCH, '/mcp/hotel/get-hotel-details-and-rates': DETAILS });
    const { client, upserts } = fakeClient();
    const { cache, saved } = fakeCache();
    const res = await seedPreviewFromRouteStack(client, 'Bali', { ...deps(fetchImpl, cache), mock: true }, { dates: DATES });
    expect(res).toEqual({ found: 0, staged: 0, hotels: [] });
    expect(upserts).toHaveLength(0);
    expect(saved).toHaveLength(0);
  });

  it('no-ops when ROUTESTACK_MOCK=1 even without the deps.mock marker', async () => {
    process.env.ROUTESTACK_MOCK = '1';
    const { fetchImpl } = makeMockFetch({ '/mcp/hotel/search-hotels': SEARCH, '/mcp/hotel/get-hotel-details-and-rates': DETAILS });
    const { client, upserts } = fakeClient();
    const res = await seedPreviewFromRouteStack(client, 'Bali', deps(fetchImpl), { dates: DATES });
    expect(res).toEqual({ found: 0, staged: 0, hotels: [] });
    expect(upserts).toHaveLength(0);
  });
});
