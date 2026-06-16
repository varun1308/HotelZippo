/* mapDatasetItems (12h · stage) — raw Apify dataset items → FetchedHotel[]. Pure, no DB.
 * Mirrors the fetch path: maps hotel rows, drops non-hotels (category/type guard), validates. */
import { mapDatasetItems } from '@/lib/curation/stage';

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
