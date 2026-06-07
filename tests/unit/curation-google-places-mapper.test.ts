/* Google Places Text Search mapper (lib/curation/google-places-mapper.ts). Pure, no network:
 * request-body builder (geo on/off) + response→place-id extraction. */
import {
  buildTextSearchBody,
  mapTextSearchResponse,
  hasGeo,
} from '@/lib/curation/google-places-mapper';
import fixtures from '../fixtures/google/places-text-search.json';

describe('buildTextSearchBody', () => {
  it('with lat/long emits a locationBias circle + lodging type + name/destination query', () => {
    const body = buildTextSearchBody({ name: 'Hilton Chicago', destination: 'Chicago', latitude: 41.87, longitude: -87.62 });
    expect(body.textQuery).toBe('Hilton Chicago Chicago');
    expect(body.includedType).toBe('lodging');
    expect(body.pageSize).toBe(1);
    expect(body.locationBias).toEqual({ circle: { center: { latitude: 41.87, longitude: -87.62 }, radius: 2000 } });
  });

  it('without lat/long omits locationBias (name-only query)', () => {
    const body = buildTextSearchBody({ name: 'JW Marriott', destination: 'Phuket' });
    expect(body.locationBias).toBeUndefined();
    expect(body.textQuery).toBe('JW Marriott Phuket');
  });
});

describe('hasGeo', () => {
  it('true only when both coordinates are numbers', () => {
    expect(hasGeo({ name: 'a', destination: 'b', latitude: 1, longitude: 2 })).toBe(true);
    expect(hasGeo({ name: 'a', destination: 'b', latitude: 1 })).toBe(false);
    expect(hasGeo({ name: 'a', destination: 'b' })).toBe(false);
  });
});

describe('mapTextSearchResponse', () => {
  it('returns the top place id on a hit', () => {
    expect(mapTextSearchResponse(fixtures.hit)).toBe('ChIJ7cv00DwsDogRAMDACa2m4K8');
  });
  it('returns null for empty / missing / malformed', () => {
    expect(mapTextSearchResponse(fixtures.empty)).toBeNull();
    expect(mapTextSearchResponse(fixtures.missing)).toBeNull();
    expect(mapTextSearchResponse(null)).toBeNull();
    expect(mapTextSearchResponse({ places: [{ noId: true }] })).toBeNull();
  });
});
