/* Google Places "Text Search (New)" adapter (curation place-id resolution, 12a). Isolates ALL
 * knowledge of the request/response shape so the HTTP detail lives in one pure, fixture-tested
 * place (mirrors apify-mapper.ts). `buildTextSearchBody` produces the request body;
 * `mapTextSearchResponse` extracts the top place id.
 *
 * Docs: POST https://places.googleapis.com/v1/places:searchText with header
 * `X-Goog-FieldMask: places.id` → ID-only SKU (cheapest; free 10k/mo). */

export interface PlaceQuery {
  name: string;
  destination: string;
  latitude?: number | null;
  longitude?: number | null;
}

/** Build the Text Search body. With lat/long we add a 2km `locationBias` circle (the strongest
 * matching signal); `includedType: 'lodging'` constrains to hotels; `pageSize: 1` since we only
 * want the top match. */
export function buildTextSearchBody(q: PlaceQuery): Record<string, unknown> {
  const body: Record<string, unknown> = {
    textQuery: `${q.name} ${q.destination}`.trim(),
    includedType: 'lodging',
    pageSize: 1,
  };
  if (typeof q.latitude === 'number' && typeof q.longitude === 'number') {
    body.locationBias = {
      circle: { center: { latitude: q.latitude, longitude: q.longitude }, radius: 2000 },
    };
  }
  return body;
}

/** Whether a query carries usable geo (drives the low-confidence flag — a name-only match is
 * weaker than a lat/long-biased one). */
export function hasGeo(q: PlaceQuery): boolean {
  return typeof q.latitude === 'number' && typeof q.longitude === 'number';
}

/** Extract the top place id from a Text Search response, or null (empty results / malformed). */
export function mapTextSearchResponse(json: unknown): string | null {
  if (!json || typeof json !== 'object') return null;
  const places = (json as Record<string, unknown>).places;
  if (!Array.isArray(places) || places.length === 0) return null;
  const first = places[0];
  if (!first || typeof first !== 'object') return null;
  const id = (first as Record<string, unknown>).id;
  return typeof id === 'string' && id.trim().length > 0 ? id.trim() : null;
}

/** Build the Text Search body for resolving a CITY/DESTINATION to coordinates (10c destination
 * disambiguation, 12i). No `includedType: lodging` (we want the locality, not a hotel) and no
 * locationBias (we have no anchor yet — this IS the anchor lookup). */
export function buildCitySearchBody(query: string): Record<string, unknown> {
  return { textQuery: query.trim(), pageSize: 1 };
}

/** Extract `{ lat, long }` from a Text Search response whose field mask requested
 * `places.location`, or null (empty / malformed). Google returns `places[0].location.{latitude,
 * longitude}`. */
export function mapCityLocationResponse(json: unknown): { lat: number; long: number } | null {
  if (!json || typeof json !== 'object') return null;
  const places = (json as Record<string, unknown>).places;
  if (!Array.isArray(places) || places.length === 0) return null;
  const loc = (places[0] as Record<string, unknown>)?.location as Record<string, unknown> | undefined;
  const lat = loc?.latitude;
  const long = loc?.longitude;
  return typeof lat === 'number' && typeof long === 'number' ? { lat, long } : null;
}
