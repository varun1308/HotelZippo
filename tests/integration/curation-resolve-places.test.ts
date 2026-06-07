/* Phase 1b integration (12a): resolvePlaceIds over staged curation_hotels against local Supabase.
 * Uses a STUB resolver (no Google key, no network) — staged null-place rows get a google_place_id;
 * a no-match row stays null and is reported skipped. Migration 0010 (geo cols) applies as part of
 * the local DB spin-up. Service client (curation_hotels is service-role only). */
import { serviceClient } from './helpers';
import { resolvePlaceIds, type PlaceResolver } from '@/lib/curation/resolve-places';

jest.setTimeout(30_000);
const admin = serviceClient();

const DEST = 'Maldives';
const HOTEL_WITH_GEO = 'Resolve Geo Hotel';
const HOTEL_NO_GEO = 'Resolve NoGeo Hotel';
const HOTEL_NO_MATCH = 'Resolve NoMatch Hotel';
const OWN = [HOTEL_WITH_GEO, HOTEL_NO_GEO, HOTEL_NO_MATCH];

beforeAll(async () => {
  await admin.from('curation_hotels').insert([
    { name: HOTEL_WITH_GEO, destination: DEST, status: 'pending', latitude: 4.17, longitude: 73.5 },
    { name: HOTEL_NO_GEO, destination: DEST, status: 'pending' },
    { name: HOTEL_NO_MATCH, destination: DEST, status: 'pending' },
  ]);
});

afterAll(async () => {
  await admin.from('curation_hotels').delete().in('name', OWN);
});

// Stub: returns a place id for everything except the "no match" hotel.
const stubResolver: PlaceResolver = async (q) =>
  q.name === HOTEL_NO_MATCH ? null : `ChIJ_stub_${q.name.replace(/\s+/g, '_')}`;

describe('resolvePlaceIds (curation place-id resolution)', () => {
  it('resolves null-place rows; no-match stays null + reported; name-only flagged low-confidence', async () => {
    const res = await resolvePlaceIds(admin, DEST, stubResolver);

    expect(res.total).toBe(3);
    expect(res.resolved).toBe(2);
    expect(res.skipped).toEqual([{ name: HOTEL_NO_MATCH, reason: 'no_match' }]);
    // The geo-less hotel resolved but is flagged for a double-check.
    expect(res.lowConfidence).toEqual([HOTEL_NO_GEO]);

    // DB: the two matched rows now carry a place id; the no-match row is still null.
    const { data } = await admin
      .from('curation_hotels')
      .select('name, google_place_id')
      .in('name', OWN);
    const byName = Object.fromEntries((data ?? []).map((r) => [r.name, r.google_place_id]));
    expect(byName[HOTEL_WITH_GEO]).toBe(`ChIJ_stub_${HOTEL_WITH_GEO.replace(/\s+/g, '_')}`);
    expect(byName[HOTEL_NO_GEO]).toBe(`ChIJ_stub_${HOTEL_NO_GEO.replace(/\s+/g, '_')}`);
    expect(byName[HOTEL_NO_MATCH]).toBeNull();
  });

  it('is idempotent — a second run finds nothing left to resolve (already-set rows are skipped by the IS NULL filter)', async () => {
    const res = await resolvePlaceIds(admin, DEST, stubResolver);
    // Only the no-match row remains null → it's the only one re-attempted.
    expect(res.total).toBe(1);
    expect(res.resolved).toBe(0);
  });
});
