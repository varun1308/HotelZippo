/* Google Places resolver client (curation place-id resolution, 12a). Server-side by construction:
 * reads GOOGLE_PLACES_API_KEY and calls Text Search (New). Env-gated like the Apify path — no key →
 * GooglePlacesError('no_key'), which the caller treats as "skip", so CI stays key-free. All
 * request/response shape lives in google-places-mapper.ts; this module is the network + OTEL seam
 * (mirrors lib/apify/client.ts).
 *
 * No `import 'server-only'`: like lib/apify/client.ts, this is also reached from standalone tsx
 * dev/maintenance scripts (scripts/dev/live-curation-fetch.ts), where that guard throws. It is
 * server-side by construction (reads a secret key) and is imported only by the admin curation route
 * + lib/curation/resolve-places.ts — never by a client component. */
import { trace, SpanStatusCode } from '@opentelemetry/api';
import { buildTextSearchBody, mapTextSearchResponse, hasGeo, type PlaceQuery } from './google-places-mapper';
import { withActorCache } from '@/lib/dev/actor-cache';

const SEARCH_TEXT_URL = 'https://places.googleapis.com/v1/places:searchText';

export type GooglePlacesErrorKind = 'no_key' | 'http_error' | 'bad_response';

export class GooglePlacesError extends Error {
  constructor(
    message: string,
    public readonly kind: GooglePlacesErrorKind,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'GooglePlacesError';
  }
}

function snippet(body: string): string {
  const clean = body.replace(/\s+/g, ' ').trim();
  return clean.length > 300 ? `${clean.slice(0, 300)}…` : clean;
}

/** Resolve one hotel → its Google place id (top Text Search match), or null when there's no match.
 * Throws GooglePlacesError('no_key') when the API key is absent (caller skips) or ('http_error')
 * on a non-2xx. Injectable `fetchImpl` keeps unit tests network-free. ID-only field mask = cheapest
 * SKU; never sends/logs the key beyond the header. */
export async function resolveGooglePlaceId(
  query: PlaceQuery,
  fetchImpl?: typeof fetch,
): Promise<string | null> {
  // Dev-only file cache (CURATION_USE_CACHE=1): a HIT replays the banked place id with NO live call
  // (and needs no key), so the resolve-places route can be exercised end-to-end for free. No-op in prod.
  return withActorCache('places', 'searchText', query, () => resolveGooglePlaceIdLive(query, fetchImpl)) as Promise<
    string | null
  >;
}

async function resolveGooglePlaceIdLive(query: PlaceQuery, fetchImpl?: typeof fetch): Promise<string | null> {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) throw new GooglePlacesError('GOOGLE_PLACES_API_KEY is not set', 'no_key');
  const doFetch = fetchImpl ?? fetch;

  const tracer = trace.getTracer('hotelzippo');
  return tracer.startActiveSpan('google.places.search_text', async (span) => {
    span.setAttribute('has_geo', hasGeo(query));
    try {
      let res: Response;
      try {
        res = await doFetch(SEARCH_TEXT_URL, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'X-Goog-Api-Key': key,
            'X-Goog-FieldMask': 'places.id',
          },
          body: JSON.stringify(buildTextSearchBody(query)),
        });
      } catch (e) {
        throw new GooglePlacesError(
          `places request failed: ${e instanceof Error ? e.message : String(e)}`,
          'http_error',
        );
      }
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new GooglePlacesError(`places returned ${res.status}: ${snippet(body)}`, 'http_error', res.status);
      }
      let json: unknown;
      try {
        json = await res.json();
      } catch (e) {
        throw new GooglePlacesError(
          `places response was not valid JSON: ${e instanceof Error ? e.message : String(e)}`,
          'bad_response',
        );
      }
      const placeId = mapTextSearchResponse(json);
      span.setAttribute('found', placeId !== null);
      span.setStatus({ code: SpanStatusCode.OK });
      return placeId;
    } catch (e) {
      span.recordException(e as Error);
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw e;
    } finally {
      span.end();
    }
  });
}
