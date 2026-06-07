/* Curation search mapper (lib/curation/apify-mapper.ts). Pure: a fixture of TripAdvisor-search
 * dataset items → FetchedHotel, exercising field-name variants, coercion, and skip-on-malformed.
 * jsdom-safe (no server-only, no network). */
import { buildSearchInput, mapSearchItem } from '@/lib/curation/apify-mapper';
import items from '../fixtures/apify/tripadvisor-search.json';

describe('buildSearchInput', () => {
  // Keys verified against the real actor's input schema (founder-supplied 2026-06-07).
  it('uses the real actor keys: bare-location query + maxItemsPerQuery cap', () => {
    const input = buildSearchInput('Phuket', 50);
    expect(input.query).toBe('Phuket'); // bare location, NOT "hotels in Phuket"
    expect(input.maxItemsPerQuery).toBe(50);
    expect(input.language).toBe('en');
    expect(input.currency).toBe('USD');
  });

  it('restricts to hotels only (attractions + restaurants default true upstream)', () => {
    const input = buildSearchInput('Bali', 25);
    expect(input.includeHotels).toBe(true);
    expect(input.includeAttractions).toBe(false);
    expect(input.includeRestaurants).toBe(false);
    expect(input.includeNearbyResults).toBe(false);
  });

  it('omits the dead/guessed keys and the paid lead-gen add-ons', () => {
    const input = buildSearchInput('Phuket', 50);
    for (const dead of [
      'locationQuery',
      'maxItems',
      'includeReviewCount',
      'startUrls',
      'maximumLeadsEnrichmentRecords',
      'leadsEnrichmentDepartments',
      'verifyLeadsEnrichmentEmails',
    ]) {
      expect(input).not.toHaveProperty(dead);
    }
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

  // Hotels-only guard: the actor's output is an anyOf of HOTEL | RESTAURANT | ATTRACTION and tags
  // out-of-area matches with isNearbyResult. The mapper must never stage a non-hotel / nearby result.
  it('drops a non-hotel row by `category` or `type`', () => {
    expect(mapSearchItem({ name: 'Portillo\'s', category: 'restaurant' }, 'Phuket')).toBeNull();
    expect(mapSearchItem({ name: 'The Bean', type: 'ATTRACTION' }, 'Phuket')).toBeNull();
  });

  it('drops a nearby-result hotel (different city)', () => {
    expect(
      mapSearchItem({ name: 'Faraway Inn', type: 'HOTEL', isNearbyResult: true }, 'Phuket'),
    ).toBeNull();
  });

  it('still maps a real HOTEL row (type "HOTEL", not nearby)', () => {
    // items[0] (Hilton Chicago) carries type:"HOTEL" — the guard must let it through.
    const h = mapSearchItem(items[0], 'Phuket');
    expect(h).not.toBeNull();
    expect(h!.name).toBe('Hilton Chicago');
  });

  it('is permissive when category/type are absent (mock/playwright rows)', () => {
    // items[1] (Angsana) has no type/category — must still map.
    expect(mapSearchItem(items[1], 'Phuket')).not.toBeNull();
  });
});
