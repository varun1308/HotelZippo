/* mapDatasetItems + stageHotels (12h · stage). mapDatasetItems: raw Apify dataset items →
 * FetchedHotel[] (pure, no DB), mirroring the fetch path. stageHotels: upsert semantics against
 * a fake Supabase client — re-stage preserves enrichment/founder edits (H10) and reports
 * per-row write failures instead of counting them as staged (M17). */
import { mapDatasetItems, stageHotels } from '@/lib/curation/stage';
import type { FetchedHotel } from '@/lib/curation/types';
import type { SupabaseClient } from '@supabase/supabase-js';

describe('mapDatasetItems', () => {
  it('maps hotel rows and drops non-hotel / nearby rows', () => {
    const items = [
      { name: 'Beach Resort Phuket', category: 'hotel', numberOfReviews: 1200, hotelClass: '5.0' },
      { name: 'Some Restaurant', category: 'restaurant' }, // dropped (not a hotel)
      { name: 'Nearby Inn', category: 'hotel', isNearbyResult: true }, // dropped (nearby)
      { title: 'Another Hotel', type: 'HOTEL', reviewsCount: 300 }, // alt field names
    ];
    const out = mapDatasetItems(items, 'Phuket');
    const names = out.map((h) => h.name);
    expect(names).toContain('Beach Resort Phuket');
    expect(names).toContain('Another Hotel');
    expect(names).not.toContain('Some Restaurant');
    expect(names).not.toContain('Nearby Inn');
    expect(out.every((h) => h.destination === 'Phuket')).toBe(true);
  });

  it('throws on an unknown destination', () => {
    expect(() => mapDatasetItems([], 'Atlantis')).toThrow(/unknown destination/);
  });

  it('returns [] for empty input', () => {
    expect(mapDatasetItems([], 'Bali')).toEqual([]);
  });
});

describe('stageHotels', () => {
  /** In-memory curation_hotels fake: rows keyed by (name,destination); records writes. */
  function fakeDb(seed: Array<Record<string, unknown>> = [], opts: { failWrites?: boolean } = {}) {
    const rows = new Map<string, Record<string, unknown>>(
      seed.map((r) => [`${r.name}|${r.destination}`, { ...r }]),
    );
    let nextId = 1;
    const client = {
      from(_t: string) {
        return {
          select(_cols: string) {
            const filters: Record<string, unknown> = {};
            const chain = {
              eq(col: string, val: unknown) {
                filters[col] = val;
                return chain;
              },
              async maybeSingle() {
                const hit = rows.get(`${filters.name}|${filters.destination}`) ?? null;
                return { data: hit, error: null };
              },
            };
            return chain;
          },
          update(patch: Record<string, unknown>) {
            return {
              async eq(_col: string, id: unknown) {
                if (opts.failWrites) return { error: { message: 'update boom' } };
                for (const r of rows.values()) if (r.id === id) Object.assign(r, patch);
                return { error: null };
              },
            };
          },
          async insert(row: Record<string, unknown>) {
            if (opts.failWrites) return { error: { message: 'insert boom' } };
            const withId = { id: `id-${nextId++}`, ...row };
            rows.set(`${row.name}|${row.destination}`, withId);
            return { error: null };
          },
        };
      },
    } as unknown as SupabaseClient;
    const byName = (name: string, destination = 'Phuket') => rows.get(`${name}|${destination}`);
    return { client, byName };
  }

  const fetched = (over: Partial<FetchedHotel> = {}): FetchedHotel => ({
    name: 'Beach Resort Phuket',
    destination: 'Phuket',
    tripadvisor_url: 'https://tripadvisor.com/h1',
    tripadvisor_rank: 3,
    review_count: 1200,
    google_place_id: null, // the TA search actor never returns one (apify-mapper.ts)
    brand: null,
    price_tier: null,
    star_rating: 4,
    images: ['https://example.com/a.jpg'],
    latitude: null,
    longitude: null,
    address: null,
    ...over,
  });

  it('H10: re-stage preserves a resolved google_place_id (paid enrichment survives Refresh/Ingest)', async () => {
    const { client, byName } = fakeDb();

    // stage → founder resolves the place id (admin PATCH) → re-stage with a null incoming id.
    const first = await stageHotels(client, [fetched()], 'apify');
    expect(first).toEqual({ staged: 1, failed: 0, errors: [] });
    byName('Beach Resort Phuket')!.google_place_id = 'ChIJ-resolved-123';

    const second = await stageHotels(client, [fetched({ review_count: 1300 })], 'apify');
    expect(second.staged).toBe(1);
    const row = byName('Beach Resort Phuket')!;
    expect(row.google_place_id).toBe('ChIJ-resolved-123'); // survived
    expect(row.review_count).toBe(1300); // fetched fields still refresh
  });

  it('H10: incoming non-null google_place_id wins; founder-edited fields survive a re-fetch', async () => {
    const { client, byName } = fakeDb();
    await stageHotels(client, [fetched()], 'apify');
    // Founder inline edits (admin PATCH whitelist) + a prior resolution.
    Object.assign(byName('Beach Resort Phuket')!, {
      google_place_id: 'ChIJ-old',
      price_tier: 'luxury',
      brand: 'Marriott',
      address: '1 Beach Rd',
    });

    await stageHotels(
      client,
      [fetched({ google_place_id: 'ChIJ-new', price_tier: 'mid-range', brand: null, address: null })],
      'apify',
    );
    const row = byName('Beach Resort Phuket')!;
    expect(row.google_place_id).toBe('ChIJ-new'); // incoming non-null wins for enrichment
    expect(row.price_tier).toBe('luxury'); // founder edit wins over the actor value
    expect(row.brand).toBe('Marriott'); // null incoming never wipes an edit
    expect(row.address).toBe('1 Beach Rd');
  });

  it('H10: a null incoming star_rating does not wipe an existing one', async () => {
    const { client, byName } = fakeDb();
    await stageHotels(client, [fetched({ star_rating: 4 })], 'apify');
    await stageHotels(client, [fetched({ star_rating: null })], 'apify');
    expect(byName('Beach Resort Phuket')!.star_rating).toBe(4);
  });

  it('H10: existing status is never touched by a re-stage (approve/reject decisions survive)', async () => {
    const { client, byName } = fakeDb();
    await stageHotels(client, [fetched()], 'apify');
    byName('Beach Resort Phuket')!.status = 'approved';
    await stageHotels(client, [fetched()], 'apify');
    expect(byName('Beach Resort Phuket')!.status).toBe('approved');
  });

  it('M17: write failures are counted + reported, not silently staged', async () => {
    const { client } = fakeDb([], { failWrites: true });
    const res = await stageHotels(client, [fetched(), fetched({ name: 'Second Hotel' })], 'apify');
    expect(res.staged).toBe(0);
    expect(res.failed).toBe(2);
    expect(res.errors).toHaveLength(2);
    expect(res.errors[0]).toMatch(/Beach Resort Phuket: write failed/);
  });
});
