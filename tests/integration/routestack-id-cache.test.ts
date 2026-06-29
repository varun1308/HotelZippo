/* Phase 7 optimisation — the RouteStack id cache round-trips through its service-role tables
 * (migration 0011). Proves the Supabase-backed IdCache reads/writes routestack_destinations +
 * routestack_hotels correctly, upserts idempotently, and that the hotel mapping cascades when its
 * hotels row is deleted. Service-role only (these tables have RLS enabled with no client policies). */
import { serviceClient } from './helpers';
import { makeSupabaseIdCache } from '@/lib/booking/id-cache';

jest.setTimeout(30_000);

const admin = serviceClient();
const cache = makeSupabaseIdCache(admin);

afterAll(async () => {
  await admin.from('routestack_destinations').delete().eq('destination', 'Phuket');
});

describe('routestack_destinations cache', () => {
  it('saves and loads a destination handle, upserting on re-save', async () => {
    await cache.saveDestination('Phuket', {
      rsDestinationId: '281988',
      rsDestinationType: 'State',
      lat: 7.88479,
      long: 98.38915,
    });
    const hit = await cache.loadDestination('Phuket');
    expect(hit).toMatchObject({ rsDestinationId: '281988', rsDestinationType: 'State', lat: 7.88479, long: 98.38915 });

    // Re-save with a different id → still ONE row (upsert on the PK `destination`).
    await cache.saveDestination('Phuket', { rsDestinationId: '328629', rsDestinationType: 'City', lat: 7.8804, long: 98.3922 });
    const { data } = await admin.from('routestack_destinations').select('rs_destination_id').eq('destination', 'Phuket');
    expect(data).toHaveLength(1);
    expect((await cache.loadDestination('Phuket'))?.rsDestinationId).toBe('328629');
  });

  it('returns null for an unresolved destination', async () => {
    expect(await cache.loadDestination('Tokyo')).toBeNull();
  });
});

describe('routestack_hotels cache', () => {
  it('maps a RouteStack hotel id to our hotels row and cascades on hotel delete', async () => {
    // A real hotels row to reference (service-role inserted reference data).
    const { data: hotels } = await admin
      .from('hotels')
      .insert([{ name: 'RS Cache Hotel', destination: 'Phuket', star_rating: 5, price_tier: 'luxury' }])
      .select('id');
    const hotelId = (hotels ?? [])[0]?.id as string;

    try {
      expect(await cache.loadHotelRsId(hotelId)).toBeNull(); // not resolved yet

      await cache.saveHotelRsId(hotelId, '15626873', 'Ramada Plaza by Wyndham Chao Fah');
      expect(await cache.loadHotelRsId(hotelId)).toBe('15626873');

      // Idempotent upsert on (hotel_id, provider) — re-save keeps one row, updates the id.
      await cache.saveHotelRsId(hotelId, '99999999', 'Renamed');
      const { data: rows } = await admin.from('routestack_hotels').select('rs_hotel_id').eq('hotel_id', hotelId);
      expect(rows).toHaveLength(1);
      expect(await cache.loadHotelRsId(hotelId)).toBe('99999999');
    } finally {
      // Deleting the hotel cascades the mapping away (FK on delete cascade).
      await admin.from('hotels').delete().eq('id', hotelId);
      expect(await cache.loadHotelRsId(hotelId)).toBeNull();
    }
  });
});
