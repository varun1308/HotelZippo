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
  it('maps a full item (name/url/rank/reviews/stars/brand/price/images)', () => {
    const h = mapSearchItem(items[0], 'Phuket');
    expect(h).not.toBeNull();
    expect(h).toMatchObject({
      name: 'JW Marriott Phuket Resort & Spa',
      destination: 'Phuket',
      tripadvisor_url: 'https://www.tripadvisor.com/Hotel_Review-JW-Marriott-Phuket',
      tripadvisor_rank: 3,
      review_count: 4200,
      star_rating: 5,
      brand: 'Marriott',
      price_tier: 'luxury',
      google_place_id: null,
    });
    expect(h!.images).toEqual(['https://example.com/jw1.jpg', 'https://example.com/jw2.jpg']);
  });

  it('handles alternate field names + string/decimal coercion (title/webUrl/rank string, "3,100", stars 4.5→4)', () => {
    const h = mapSearchItem(items[1], 'Phuket');
    expect(h).not.toBeNull();
    expect(h).toMatchObject({
      name: 'Angsana Laguna Phuket',
      tripadvisor_rank: 7,
      review_count: 3100,
      star_rating: 4,
    });
    expect(h!.images).toEqual(['https://example.com/angsana.jpg']);
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
