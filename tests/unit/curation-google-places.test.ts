/* Google Places resolver client (lib/curation/google-places.ts). Network-free via injected fetch;
 * exercises hit / no-match / no-key / http-error. */
jest.mock('server-only', () => ({}));

import { resolveGooglePlaceId, resolveCityLocation, GooglePlacesError } from '@/lib/curation/google-places';
import fixtures from '../fixtures/google/places-text-search.json';

const query = { name: 'Hilton Chicago', destination: 'Chicago', latitude: 41.87, longitude: -87.62 };

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) } as Response;
}

describe('resolveGooglePlaceId', () => {
  const ORIG = process.env.GOOGLE_PLACES_API_KEY;
  beforeEach(() => {
    process.env.GOOGLE_PLACES_API_KEY = 'test-key';
  });
  afterAll(() => {
    if (ORIG === undefined) delete process.env.GOOGLE_PLACES_API_KEY;
    else process.env.GOOGLE_PLACES_API_KEY = ORIG;
  });

  it('returns the top place id, sending the ID-only field mask + the api key header', async () => {
    let seenInit: RequestInit | undefined;
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      seenInit = init;
      return jsonResponse(fixtures.hit);
    }) as unknown as typeof fetch;

    const id = await resolveGooglePlaceId(query, fetchImpl);
    expect(id).toBe('ChIJ7cv00DwsDogRAMDACa2m4K8');
    const headers = seenInit?.headers as Record<string, string>;
    expect(headers['X-Goog-FieldMask']).toBe('places.id');
    expect(headers['X-Goog-Api-Key']).toBe('test-key');
    expect(JSON.parse(String(seenInit?.body)).textQuery).toBe('Hilton Chicago Chicago');
  });

  it('returns null when there is no match (empty results)', async () => {
    const fetchImpl = (async () => jsonResponse(fixtures.empty)) as unknown as typeof fetch;
    expect(await resolveGooglePlaceId(query, fetchImpl)).toBeNull();
  });

  it('throws no_key when GOOGLE_PLACES_API_KEY is unset', async () => {
    delete process.env.GOOGLE_PLACES_API_KEY;
    await expect(resolveGooglePlaceId(query)).rejects.toMatchObject({ name: 'GooglePlacesError', kind: 'no_key' });
  });

  it('throws http_error with the status on a non-2xx', async () => {
    const fetchImpl = (async () => ({ ok: false, status: 403, text: async () => 'denied' }) as Response) as unknown as typeof fetch;
    const err = await resolveGooglePlaceId(query, fetchImpl).catch((e) => e);
    expect(err).toBeInstanceOf(GooglePlacesError);
    expect(err.kind).toBe('http_error');
    expect(err.status).toBe(403);
  });
});

describe('resolveCityLocation (10c destination disambiguation)', () => {
  const ORIG = process.env.GOOGLE_PLACES_API_KEY;
  beforeEach(() => {
    process.env.GOOGLE_PLACES_API_KEY = 'test-key';
  });
  afterAll(() => {
    if (ORIG === undefined) delete process.env.GOOGLE_PLACES_API_KEY;
    else process.env.GOOGLE_PLACES_API_KEY = ORIG;
  });

  it('returns {lat,long} from places[0].location, requesting the places.location field mask', async () => {
    let seenInit: RequestInit | undefined;
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      seenInit = init;
      return jsonResponse({ places: [{ location: { latitude: -8.34, longitude: 115.09 } }] });
    }) as unknown as typeof fetch;
    const loc = await resolveCityLocation('Bali', fetchImpl);
    expect(loc).toEqual({ lat: -8.34, long: 115.09 });
    expect((seenInit?.headers as Record<string, string>)['X-Goog-FieldMask']).toBe('places.location');
  });

  it('returns null on empty results', async () => {
    const fetchImpl = (async () => jsonResponse({ places: [] })) as unknown as typeof fetch;
    expect(await resolveCityLocation('Nowhere', fetchImpl)).toBeNull();
  });

  it('throws no_key when the key is unset (caller warm-falls to legacy pick)', async () => {
    delete process.env.GOOGLE_PLACES_API_KEY;
    await expect(resolveCityLocation('Bali')).rejects.toMatchObject({ name: 'GooglePlacesError', kind: 'no_key' });
  });
});
