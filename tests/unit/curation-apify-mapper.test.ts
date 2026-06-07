/* Curation search mapper (lib/curation/apify-mapper.ts). Pure: a fixture of TripAdvisor-search
 * dataset items → FetchedHotel, exercising field-name variants, coercion, and skip-on-malformed.
 * jsdom-safe (no server-only, no network). */
import { buildSearchInput, mapSearchItem } from '@/lib/curation/apify-mapper';
import items from '../fixtures/apify/tripadvisor-search.json';

describe('buildSearchInput', () => {
  it('encodes the destination + maxResults cap', () => {
    const input = buildSearchInput('Phuket', 50);
    expect(input.locationQuery).toBe('Phuket');
    expect(input.maxItems).toBe(50);
    expect(String(input.query)).toMatch(/Phuket/);
  });
});

describe('mapSearchItem', () => {
  // items[0] is a REAL TripAdvisor hotel-search dataset row (Hilton Chicago) — verifies the
  // mapper against the live actor's exact field names + value formats.
  it('maps a real actor row: webUrl, hotelClass "4.0"→4, priceLevel "$$$"→luxury, angle-bracket-wrapped url+image stripped', () => {
    const h = mapSearchItem(items[0], 'Phuket');
    expect(h).not.toBeNull();
    expect(h).toMatchObject({
      name: 'Hilton Chicago',
      destination: 'Phuket',
      tripadvisor_url:
        'https://www.tripadvisor.com/Hotel_Review-g35805-d87590-Reviews-Hilton_Chicago-Chicago_Illinois.html',
      tripadvisor_rank: 129,
      review_count: 6717,
      star_rating: 4,
      price_tier: 'luxury',
      google_place_id: null,
      brand: null, // the actor has no brand/chain field
    });
    // image was wrapped in <…>; bracket stripped, no trailing '>'.
    expect(h!.images).toEqual(['https://media-cdn.tripadvisor.com/media/photo-o/28/6c/18/b7/exterior.jpg']);
    // Geo captured for the place-id resolver (lat/long floats, not rounded; flat address).
    expect(h!.latitude).toBe(41.872528);
    expect(h!.longitude).toBe(-87.62451);
    expect(h!.address).toBe('720 South Michigan Avenue, Chicago, IL 60605-2116');
  });

  it('falls back to addressObj when no flat address; geo is null when the actor omits it', () => {
    const fromObj = mapSearchItem(
      { name: 'Obj Hotel', addressObj: { street1: '1 Beach Rd', city: 'Phuket', country: 'Thailand' } },
      'Phuket',
    );
    expect(fromObj!.address).toBe('1 Beach Rd, Phuket, Thailand');
    // items[1] (Angsana) has no geo at all → nulls.
    const noGeo = mapSearchItem(items[1], 'Phuket')!;
    expect(noGeo.latitude).toBeNull();
    expect(noGeo.longitude).toBeNull();
    expect(noGeo.address ?? null).toBeNull();
  });

  it('handles alternate field names + coercion (title/url, rank "7", "3,100", stars 4.5→4, "$$$$"→ultra-luxury)', () => {
    const h = mapSearchItem(items[1], 'Phuket');
    expect(h).not.toBeNull();
    expect(h).toMatchObject({
      name: 'Angsana Laguna Phuket',
      tripadvisor_rank: 7,
      review_count: 3100,
      star_rating: 4,
      price_tier: 'ultra-luxury',
    });
    expect(h!.images).toEqual(['https://example.com/angsana1.jpg', 'https://example.com/angsana2.jpg']);
  });

  it('always sets destination from the arg, not the row', () => {
    const h = mapSearchItem(items[0], 'Bali');
    expect(h!.destination).toBe('Bali');
  });

  it('returns null for a malformed row (no usable name)', () => {
    expect(mapSearchItem(items[2], 'Phuket')).toBeNull();
    expect(mapSearchItem(null, 'Phuket')).toBeNull();
    expect(mapSearchItem({ junk: true }, 'Phuket')).toBeNull();
  });
});
