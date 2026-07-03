/* RouteStack booking session orchestrator (Phase 7 · specs/10c-booking-routestack.md).
 *
 * The Booking Agent is a thin pass-through (08c decision D4 — no Claude prompt). RouteStack
 * is plain HTTPS REST with an HMAC→JWT auth step; the booking is a multi-step SESSION that
 * ends in a deep-link checkout URL the user completes off-platform (no payment/PCI/
 * reservation state in HotelZippo).
 *
 * Two phases, split so the chat can put a room picker between them:
 *   Phase 1  searchAndRates(input)        → mint/cache JWT → search-destinations →
 *            search-hotels (match chosen hotel by NAME) → get-hotel-details-and-rates →
 *            { rooms/rates options, correlationId, token } for the picker. No auto-pick.
 *   Phase 2  selectAndPaymentUrl(sel)     → revalidate the chosen rate → get-payment-url →
 *            { bookingUrl } the UI opens in a new tab.
 *
 * Every call threads correlationId + token from search-hotels (never invented). Every call
 * is OTEL-traced (specs/14: hotel_id, dates, success/failure, latency). RouteStack returns
 * a uniform { success, message, code, result } envelope and signals BUSINESS failures with
 * HTTP 200 + success:false — so we branch on `success`, not HTTP status, and map known codes
 * (204 no-availability, 5148 offer-expired) to warm BookingError kinds.
 *
 * The HTTP transport is INJECTABLE (RouteStackFetch): mock fixtures in tests / key-free CI,
 * a real fetch client in dev/live (Slice C).
 *
 * No `import 'server-only'`: like ./auth, ./transport and lib/curation/google-places, this is also
 * reached from standalone tsx dev/maintenance scripts (the guard throws there). Server-side by
 * construction (RouteStack creds) and imported only by API routes + server libs — never a client
 * component (verified: all importers are server-side). */
import { trace, SpanStatusCode, type Span } from '@opentelemetry/api';
import { HZ, stampCorrelation } from '@/lib/otel/trace';
import { getPartnerToken, invalidatePartnerToken, type RouteStackFetch } from './auth';
import { buildRoomsOccupancy } from './party';
import { mapRoomRateOptions } from './rates';
import type { IdCache } from './id-cache';
import type { PayloadLog } from './payload-log';
import {
  BookingError,
  type TravelParty,
  type BookingDates,
  type RoomsAndRates,
  type RoomSelection,
  type BookingHandoff,
  type HotelDisplayInfo,
} from './types';

/** Phase-1 input: the chosen hotel + confirmed party + resolved dates. `destination` and
 * `hotelName` come from the hotels row; `party` + `dates` are the CONFIRMED values from the
 * combined confirm turn (Slice B). */
export interface SearchAndRatesInput {
  hotelId: string;
  hotelName: string;
  destination: string;
  party: TravelParty;
  dates: BookingDates;
  /** ISO currency (USD default for v1; user-changeable currency is future scope). */
  currency?: string;
}

/** Injectable seam + clock/nonce hooks (so auth is deterministic in tests). `cache` is OPTIONAL —
 * when present, stable RouteStack ids are reused to skip search-destinations and match hotels by id;
 * when absent (or any cache call fails), the flow runs the full live path unchanged. */
export interface BookingDeps {
  fetchImpl: RouteStackFetch;
  now?: () => number;
  nonce?: () => string;
  cache?: IdCache;
  /** OPTIONAL destination geocoder (Google Places, 10c/12i). When present, its authoritative lat/long
   * disambiguates which RouteStack search-destinations candidate to use (nearest wins). When absent or
   * it throws/returns null, resolution warm-fails to the legacy first-valid pick — never blocks a booking. */
  geocode?: (query: string) => Promise<{ lat: number; long: number } | null>;
  /** OPTIONAL RouteStack payload debug log. When present (route injects it only if
   * ROUTESTACK_DEBUG_PAYLOADS=1), every call's REDACTED request/response is persisted for replay.
   * Best-effort: a failed/absent log never affects the booking. */
  debugLog?: PayloadLog;
  /** OPTIONAL honesty marker — true when fetchImpl is the demo mock transport (10e). Tags every
   * span with `mock: true` so Dash0 traces are never mistaken for a live booking. */
  mock?: boolean;
}

const TRACER = 'hotelzippo';
const DEFAULT_CURRENCY = 'USD';

/* ---- envelope handling -------------------------------------------------- */

interface Envelope {
  success: boolean;
  message: string | null;
  code?: number;
  result?: unknown;
  /** The original response body — some steps (get-payment-url) put fields like `url` at the
   * top level alongside `success`, not under `result`. */
  raw: unknown;
}

function asEnvelope(res: unknown): Envelope {
  if (res && typeof res === 'object') {
    const r = res as Record<string, unknown>;
    if (typeof r.success === 'boolean') {
      return {
        success: r.success,
        message: typeof r.message === 'string' ? r.message : null,
        code: typeof r.code === 'number' ? r.code : undefined,
        result: r.result,
        raw: res,
      };
    }
  }
  // A non-envelope payload (e.g. the trimmed details blob) is treated as a success carrying
  // the raw body as result — callers that need the envelope guard call requireSuccess first.
  return { success: true, message: null, result: res, raw: res };
}

/** RouteStack signalled the partner JWT itself is bad (401-ish envelope) — distinct from the
 * search-session expiring, but both mean the cached auth state must not be reused. */
function isAuthRejection(env: Envelope): boolean {
  if (env.code === 401) return true;
  return !!env.message && /unauthori[sz]ed|forbidden|invalid token|token (is )?(invalid|expired)|member token/i.test(env.message);
}

/** Map a failed envelope to the right warm BookingError kind. */
function envelopeError(env: Envelope, step: string): BookingError {
  const code = env.code;
  if (code === 204) return new BookingError('no-availability', env.message ?? 'No availability', code);
  if (code === 5148) return new BookingError('offer-expired', env.message ?? 'The offer has expired', code);
  if (code === 5034) return new BookingError('not-found', env.message ?? 'Not found', code);
  // Session/correlation expiry surfaces as a provider message; treat as recoverable re-search.
  if (env.message && /expired|correlation|session/i.test(env.message)) {
    return new BookingError('session-expired', env.message, code);
  }
  return new BookingError('unknown', env.message ?? `RouteStack ${step} failed`, code);
}

/* ---- traced POST -------------------------------------------------------- */

async function tracedCall(
  deps: BookingDeps,
  step: string,
  path: string,
  token: string | null,
  body: unknown,
  attrs: Record<string, string | number>,
  // Derives result-shaped attributes (counts, pagination hints) stamped on the span after a
  // successful envelope — so Dash0 shows WHAT came back, not just that something did (specs/14).
  resultAttrs?: (result: unknown) => Record<string, string | number | boolean>,
): Promise<Envelope> {
  const tracer = trace.getTracer(TRACER);
  return tracer.startActiveSpan(`routestack.${step}`, async (span: Span) => {
    for (const [k, v] of Object.entries(attrs)) span.setAttribute(k, v);
    // Inherit conversation/user correlation from baggage so a booking span joins the same
    // Dash0 view as the chat turn that started it (specs/14).
    stampCorrelation(span);
    if (deps.mock) span.setAttribute(HZ.mock, true);
    const start = Date.now();
    // Debug-log capture (best-effort, flag-gated via deps.debugLog). Tracks the raw response +
    // outcome across every exit path so one record() in finally covers success AND failure.
    let rawResponse: unknown = null;
    let logSuccess: boolean | null = null;
    let logCode: number | null = null;
    let logError: string | null = null;
    try {
      const headers = token ? { Authorization: `Bearer ${token}` } : undefined;
      let raw: unknown;
      try {
        raw = await deps.fetchImpl(path, body, headers);
      } catch (e) {
        throw new BookingError('transport', `${step} request failed: ${e instanceof Error ? e.message : String(e)}`);
      }
      rawResponse = raw;
      const env = asEnvelope(raw);
      logSuccess = env.success;
      logCode = env.code ?? null;
      span.setAttribute(HZ.success, env.success);
      if (env.code !== undefined) span.setAttribute(HZ.code, env.code);
      if (!env.success) {
        const err = attachTrace(envelopeError(env, step), span);
        // A rejected token/session must not poison the 1h JWT cache: the 'session-expired'
        // guidance is "search again", which only works if the retry re-authenticates.
        if (err.kind === 'session-expired' || isAuthRejection(env)) invalidatePartnerToken();
        logError = err.message;
        span.recordException(err);
        span.setStatus({ code: SpanStatusCode.ERROR });
        throw err;
      }
      if (resultAttrs) {
        // Best-effort: a malformed result must never fail the call over an attribute.
        try {
          for (const [k, v] of Object.entries(resultAttrs(env.result))) span.setAttribute(k, v);
        } catch { /* attribute derivation only */ }
      }
      span.setStatus({ code: SpanStatusCode.OK });
      return env;
    } catch (e) {
      if (logError === null) logError = e instanceof Error ? e.message : String(e);
      if (e instanceof BookingError) {
        attachTrace(e, span);
        if (e.kind === 'transport' || e.kind === 'config') {
          span.recordException(e);
          span.setStatus({ code: SpanStatusCode.ERROR });
        }
        throw e;
      }
      span.recordException(e as Error);
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw e;
    } finally {
      span.setAttribute(HZ.durationMs, Date.now() - start);
      if (deps.debugLog) {
        // Fire-and-forget, fully isolated: the injected log is an arbitrary impl, so we guard against
        // BOTH a synchronous throw and a rejected promise — a misbehaving debug log must NEVER surface
        // as an unhandled rejection or block the booking. hotel_id comes from the span attrs if present.
        try {
          const p = deps.debugLog.record({
            step,
            path,
            request: body,
            response: rawResponse,
            success: logSuccess,
            code: logCode,
            durationMs: Date.now() - start,
            error: logError,
            hotelId: typeof attrs.hotel_id === 'string' ? attrs.hotel_id : null,
            traceId: span.spanContext()?.traceId ?? null,
          });
          if (p && typeof p.catch === 'function') p.catch(() => {});
        } catch {
          /* debug logging is best-effort — swallow */
        }
      }
      span.end();
    }
  });
}

/** Surface the OTEL trace id on the error so the UI can cite it in Dash0 (specs/14). */
function attachTrace(err: BookingError, span: Span): BookingError {
  if (!err.traceId) {
    const ctx = span.spanContext();
    if (ctx?.traceId) err.traceId = ctx.traceId;
  }
  return err;
}

/* ---- phase 1: search + rates ------------------------------------------- */

interface DestinationHit {
  id: string;
  lat: number;
  long: number;
  type: string;
}

/** Best-effort cache READ: resolve the promise, but swallow any error/absence to a null "miss".
 * Caching must never break a booking — a failed read just means we run the live call. */
async function cacheGet<T>(p: Promise<T | null> | undefined): Promise<T | null> {
  if (!p) return null;
  try {
    return await p;
  } catch {
    return null;
  }
}

/** Best-effort geocode: resolve the destination anchor, swallowing any error/absence to null.
 * Resolution must never break a booking — a failed geocode just means we use the legacy first-valid
 * candidate pick (10c). */
async function geocodeAnchor(deps: BookingDeps, destination: string): Promise<{ lat: number; long: number } | null> {
  if (!deps.geocode) return null;
  try {
    return await deps.geocode(destination);
  } catch {
    return null;
  }
}

/** Best-effort cache WRITE: swallow any error. A failed write just means we don't cache this time. */
async function cacheRun(p: Promise<void> | undefined): Promise<void> {
  if (!p) return;
  try {
    await p;
  } catch {
    /* best-effort — never block a booking on the cache */
  }
}

/** Match the chosen hotel by an exact RouteStack id within search-hotels results (deterministic,
 * used when we have a cached id). Returns null if the id isn't in this search's availability. */
function matchHotelById(result: unknown, rsHotelId: string): { id: string; name: string } | null {
  for (const h of extractHotelList(result)) {
    if (h.id === rsHotelId) return { id: h.id, name: h.name ?? '' };
  }
  return null;
}

/** Great-circle distance (km) — used only to rank destination candidates, so a cheap approximation
 * is fine. */
function haversineKm(aLat: number, aLong: number, bLat: number, bLong: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLong = toRad(bLong - aLong);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLong / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Pick the RouteStack destination candidate to use.
 *
 * RouteStack returns several geo-valid candidates for a free-text query (e.g. "Bali" → the real Bali
 * State AND a Fiji islet). Picking the FIRST one is a bug (live-probe-confirmed 2026-06-16: "Bali"
 * resolved to the Fiji islet → 0 hotels). When an `anchor` (authoritative lat/long from Google
 * Places, 10c/12i) is provided, pick the candidate NEAREST it; otherwise fall back to the legacy
 * first-valid behavior (warm-fail when Google is unavailable). */
function pickDestination(result: unknown, anchor?: { lat: number; long: number } | null): DestinationHit | null {
  const arr = Array.isArray(result) ? result : [];
  const valid: DestinationHit[] = [];
  for (const item of arr) {
    if (item && typeof item === 'object') {
      const r = item as Record<string, unknown>;
      const coords = (r.coordinates ?? {}) as Record<string, unknown>;
      const id = r.id;
      const lat = coords.lat;
      const long = coords.long;
      if (typeof id === 'string' && typeof lat === 'number' && typeof long === 'number') {
        valid.push({ id, lat, long, type: typeof r.type === 'string' ? r.type : 'City' });
      }
    }
  }
  if (valid.length === 0) return null;
  if (!anchor) return valid[0]; // legacy behavior (no anchor → first valid)
  return valid.reduce((best, c) =>
    haversineKm(anchor.lat, anchor.long, c.lat, c.long) < haversineKm(anchor.lat, anchor.long, best.lat, best.long)
      ? c
      : best,
  );
}

/** Find the chosen hotel by NAME within search-hotels results (RouteStack search is
 * destination-level; there is no per-property endpoint). Case-insensitive exact match
 * first, then a contains match, so minor formatting differences still resolve. */
function matchHotelByName(result: unknown, hotelName: string): { id: string; name: string } | null {
  const list = extractHotelList(result);
  const want = hotelName.trim().toLowerCase();
  let contains: { id: string; name: string } | null = null;
  for (const h of list) {
    const name = (h.name ?? '').trim();
    const lc = name.toLowerCase();
    if (lc === want && h.id) return { id: h.id, name };
    if (!contains && h.id && (lc.includes(want) || want.includes(lc)) && lc.length > 0) {
      contains = { id: h.id, name };
    }
  }
  return contains;
}

function extractHotelList(result: unknown): Array<{ id: string | null; name: string | null }> {
  // search-hotels nests the array at result.result[].
  const inner = result && typeof result === 'object' ? (result as Record<string, unknown>).result : result;
  const arr = Array.isArray(inner) ? inner : [];
  return arr.map((h) => {
    const r = (h ?? {}) as Record<string, unknown>;
    return {
      id: typeof r.id === 'string' ? r.id : null,
      name: typeof r.name === 'string' ? r.name : null,
    };
  });
}

function sessionHandles(result: unknown): { correlationId: string; token: string } | null {
  if (result && typeof result === 'object') {
    const r = result as Record<string, unknown>;
    const correlationId = r.correlationId;
    const token = r.token;
    if (typeof correlationId === 'string' && typeof token === 'string') {
      return { correlationId, token };
    }
  }
  return null;
}

/** PHASE 1 — resolve destination → search hotels → match by name → details+rates. Returns
 * the picker's room/rate options plus the session handles phase 2 must thread back. */
/** Resolve a destination (with Google-anchor disambiguation + id-cache) and run search-hotels.
 * Shared by searchAndRates AND preview verification (12i) so the destination-disambiguation fix lives
 * in ONE place. Returns the raw search envelope result (carries the hotel list + session handles) and
 * the resolved destination handle. `hotelIdForCache` is the optional our-hotels uuid used for the
 * destination cache scope key; pass the destination's confirmed dates/party. */
export async function searchHotelsInDestination(
  destination: string,
  party: SearchAndRatesInput['party'],
  dates: { checkIn: string; checkOut: string },
  deps: BookingDeps,
  currencyArg?: string,
): Promise<{ searchResult: unknown; dest: DestinationHit; nextPage: (nextResultsKey: string, page?: number) => Promise<unknown> }> {
  const dateAttrs = { check_in: dates.checkIn, check_out: dates.checkOut };
  const jwt = await getPartnerToken(deps.fetchImpl, { now: deps.now, nonce: deps.nonce, mock: deps.mock });
  const currency = currencyArg ?? DEFAULT_CURRENCY;
  const rooms = buildRoomsOccupancy(party);

  // Live destination resolution: search-destinations → Google-Places anchor disambiguation →
  // cache write. Also re-run by the self-heal path below when a cached id proves stale.
  const resolveLive = async (): Promise<DestinationHit> => {
    const destEnv = await tracedCall(deps, 'search_destinations', '/mcp/hotel/search-destinations', jwt, {
      query: destination,
      type: 'DESTINATION',
    }, dateAttrs);
    // Google-Places anchor disambiguates which candidate to use (RouteStack returns several "Bali"s).
    // Best-effort: any failure (no key, network, no match) → null → legacy first-valid pick. Never blocks.
    const anchor = await geocodeAnchor(deps, destination);
    const resolved = pickDestination(destEnv.result, anchor);
    if (!resolved) throw new BookingError('not-found', `Could not resolve destination "${destination}"`);
    await cacheRun(deps.cache?.saveDestination(destination, {
      rsDestinationId: resolved.id, rsDestinationType: resolved.type, lat: resolved.lat, long: resolved.long,
    }));
    return resolved;
  };

  // resolve destination → id + coords (cached handle skips the paid search-destinations call).
  const cachedDest = await cacheGet(deps.cache?.loadDestination(destination));
  let dest: DestinationHit = cachedDest
    ? { id: cachedDest.rsDestinationId, type: cachedDest.rsDestinationType ?? 'City', lat: cachedDest.lat, long: cachedDest.long }
    : await resolveLive();

  // search hotels in that destination (mints the session token + carries availability). `nextKey`
  // fetches a follow-up page (openapi HotelSearchResult.nextResultsKey) within the same session.
  // Each page span records how many hotels came back + whether another page exists, so a slow or
  // stalled pagination walk is diagnosable from Dash0 alone.
  const searchPage = (d: DestinationHit, nextKey?: string, page = 1) =>
    tracedCall(deps, 'search_hotels', '/mcp/hotel/search-hotels', jwt, {
      destinationId: d.id,
      destinationType: d.type,
      lat: d.lat,
      long: d.long,
      checkIn: dates.checkIn,
      checkOut: dates.checkOut,
      rooms,
      currency,
      ...(nextKey ? { nextResultsKey: nextKey } : {}),
    }, dateAttrs, (result) => ({
      [HZ.resultCount]: extractHotelList(result).length,
      [HZ.page]: page,
      [HZ.nextKeyPresent]: nextResultsKey(result) !== null,
    }));

  let searchEnv: Envelope | null = null;
  let searchErr: unknown = null;
  try {
    searchEnv = await searchPage(dest);
  } catch (e) {
    searchErr = e;
  }

  // SELF-HEAL a stale destination cache row: a cached hit short-circuits resolution, so a
  // pre-anchor mis-resolution (live-probe 2026-06-16: "Bali" → a Fiji islet → 0 hotels) would
  // otherwise be served warm forever (the cache has no TTL). When the CACHED id yields zero
  // hotels (empty list or a 204 no-availability envelope), invalidate that row and re-resolve
  // ONCE; re-search only if resolution actually changed (a same-id re-search would just repeat
  // the paid call — that's genuine no-availability, not a stale id).
  const zeroHotels = searchEnv
    ? extractHotelList(searchEnv.result).length === 0
    : searchErr instanceof BookingError && searchErr.kind === 'no-availability';
  if (cachedDest && zeroHotels) {
    await cacheRun(deps.cache?.invalidateDestination?.(destination));
    const fresh = await resolveLive();
    if (fresh.id !== dest.id) {
      dest = fresh;
      searchEnv = await searchPage(dest); // a genuine failure here propagates normally
      searchErr = null;
    }
  }
  if (searchErr) throw searchErr;

  return {
    searchResult: searchEnv!.result,
    dest,
    nextPage: async (nextResultsKey: string, page?: number) => (await searchPage(dest, nextResultsKey, page ?? 2)).result,
  };
}

/** Hotel list (with starRating/ourprice) from a search-hotels result — public for preview
 * verification (12i). Reads the RAW inventory directly (extractHotelList intentionally narrows to
 * {id,name} for booking; verification also needs the rating + price). */
export function listSearchHotels(searchResult: unknown): Array<{ id: string; name: string; starRating?: number; ourprice?: number }> {
  const inner = searchResult && typeof searchResult === 'object' ? (searchResult as Record<string, unknown>).result : searchResult;
  const arr = Array.isArray(inner) ? inner : [];
  const out: Array<{ id: string; name: string; starRating?: number; ourprice?: number }> = [];
  for (const h of arr) {
    const r = (h ?? {}) as Record<string, unknown>;
    if (typeof r.id !== 'string' || typeof r.name !== 'string') continue;
    out.push({
      id: r.id,
      name: r.name,
      starRating: typeof r.starRating === 'number' ? r.starRating : undefined,
      ourprice: typeof r.ourprice === 'number' ? r.ourprice : undefined,
    });
  }
  return out;
}

/** Pull the grounded hero image URL from a get-hotel-details-and-rates result
 * (`result.content.heroImage`, else the first `content.images[].links[].url`). Real CDN photo for
 * that exact hotel — never fabricated. Returns null if none. */
function extractHeroImage(detailsResult: unknown): string | null {
  const content = (detailsResult as Record<string, unknown> | undefined)?.content as Record<string, unknown> | undefined;
  if (!content) return null;
  if (typeof content.heroImage === 'string' && content.heroImage.trim()) return content.heroImage.trim();
  const images = content.images;
  if (Array.isArray(images)) {
    for (const img of images) {
      const links = (img as Record<string, unknown>)?.links;
      if (Array.isArray(links)) {
        for (const l of links) {
          const url = (l as Record<string, unknown>)?.url;
          if (typeof url === 'string' && url.trim()) return url.trim();
        }
      }
    }
  }
  return null;
}

/** Pull the display metadata RouteStack's own hosted checkout page renders (10c, live-verified
 * 2026-07-03) out of a get-hotel-details-and-rates result's `content` node: street address,
 * coordinates, and star/guest rating. Every field is best-effort — an absent/malformed value is
 * simply omitted, never guessed. */
function extractDisplayInfo(detailsResult: unknown): HotelDisplayInfo {
  const content = (detailsResult as Record<string, unknown> | undefined)?.content as Record<string, unknown> | undefined;
  const out: HotelDisplayInfo = {};
  if (!content) return out;

  const heroImage = extractHeroImage(detailsResult);
  if (heroImage) out.hotelImage = heroImage;

  const contact = content.contact as Record<string, unknown> | undefined;
  const address = contact?.address as Record<string, unknown> | undefined;
  if (address) {
    const line1 = typeof address.line1 === 'string' ? address.line1 : undefined;
    const city = (address.city as Record<string, unknown> | undefined)?.name;
    const state = (address.state as Record<string, unknown> | undefined)?.name;
    const country = (address.country as Record<string, unknown> | undefined)?.name;
    const parts = [line1, city, state, country].filter((p): p is string => typeof p === 'string' && p.trim().length > 0);
    if (parts.length > 0) out.hotelAddress = parts.join(', ');
  }

  const geo = content.geoCode as Record<string, unknown> | undefined;
  const lat = geo?.lat;
  const long = geo?.long;
  const latNum = typeof lat === 'number' ? lat : typeof lat === 'string' ? Number(lat) : NaN;
  const longNum = typeof long === 'number' ? long : typeof long === 'string' ? Number(long) : NaN;
  if (Number.isFinite(latNum)) out.hotelLatitude = latNum;
  if (Number.isFinite(longNum)) out.hotelLongitude = longNum;

  if (typeof content.starRating === 'number') {
    out.hotelStarRating = content.starRating;
    // RouteStack's own live payload sends the same figure for both hotelStarRating + hotelRating
    // (no separate guest-review score surfaced by this endpoint) — mirror that rather than
    // omitting a field their checkout page expects.
    out.hotelRating = content.starRating;
  }
  return out;
}

/** A real, bookable RouteStack hotel ready to stage as a preview row (12i — RouteStack-first flow). */
export interface RouteStackPreviewHotel {
  rsHotelId: string;
  name: string;
  starRating: number | null;
  heroImage: string | null;
}

/** RouteStack-FIRST preview seeding (12i, no-Claude flow): resolve a destination, list its REAL
 * bookable inventory, take the top `limit`, and fetch each hotel's grounded hero image via
 * get-hotel-details-and-rates. Everything returned is real + bookable by construction (it came from
 * RouteStack) — no LLM, no fabricated facts, no hallucinated images. Image fetch is best-effort per
 * hotel (a failed details call → null image → the card placeholder, never a broken img). */
export async function listPreviewHotelsFromRouteStack(
  destination: string,
  deps: BookingDeps,
  opts: { limit?: number; dates?: { checkIn: string; checkOut: string }; party?: SearchAndRatesInput['party']; fast?: boolean } = {},
): Promise<RouteStackPreviewHotel[]> {
  const limit = opts.limit ?? 8;
  const party = opts.party ?? { adults: 2, children: 0, childAges: [], rooms: 1 };
  const dates = opts.dates ?? defaultPreviewDates();
  const jwt = await getPartnerToken(deps.fetchImpl, { now: deps.now, nonce: deps.nonce, mock: deps.mock });
  const rooms = buildRoomsOccupancy(party);

  const { searchResult } = await searchHotelsInDestination(destination, party, dates, deps);
  const handles = sessionHandles(searchResult);
  const inventory = listSearchHotels(searchResult).filter((h) => h.id && h.name).slice(0, limit);

  // FAST mode (12i-C runtime seed): skip the per-hotel get-hotel-details image loop — the slow part
  // (~45s for 8 hotels). Stage names/star/price now (1 search call, fits the chat turn); images null →
  // card placeholder (12g), still bookable. A later full seed (/admin) backfills images.
  if (opts.fast) {
    return inventory.map((h) => ({ rsHotelId: h.id, name: h.name, starRating: h.starRating ?? null, heroImage: null }));
  }

  const out: RouteStackPreviewHotel[] = [];
  for (const h of inventory) {
    let heroImage: string | null = null;
    if (handles) {
      try {
        const det = await tracedCall(deps, 'get_hotel_details_and_rates', '/mcp/hotel/get-hotel-details-and-rates', jwt, {
          hotelId: h.id, hotelName: h.name, token: handles.token, correlationId: handles.correlationId,
          checkIn: dates.checkIn, checkOut: dates.checkOut, rooms,
        }, { hotel_id: h.id });
        heroImage = extractHeroImage(det.result);
      } catch {
        heroImage = null; // best-effort — a failed details call just means no image (placeholder)
      }
    }
    out.push({ rsHotelId: h.id, name: h.name, starRating: h.starRating ?? null, heroImage });
  }
  return out;
}

function defaultPreviewDates(): { checkIn: string; checkOut: string } {
  const base = Date.now();
  const d = (n: number) => new Date(base + n * 86400000).toISOString().slice(0, 10);
  return { checkIn: d(30), checkOut: d(33) };
}

/** Bound on how many search-hotels result pages we scan for the chosen hotel (page 1 + follow-ups).
 * RouteStack pages large destinations (openapi HotelSearchResult.count + nextResultsKey); a hotel
 * beyond page 1 must not surface as "not found", but following an endless key chain is a cost/DoS
 * hazard — 5 pages covers several hundred properties. */
const MAX_SEARCH_PAGES = 5;

function nextResultsKey(searchResult: unknown): string | null {
  if (searchResult && typeof searchResult === 'object') {
    const k = (searchResult as Record<string, unknown>).nextResultsKey;
    if (typeof k === 'string' && k) return k;
  }
  return null;
}

export async function searchAndRates(
  input: SearchAndRatesInput,
  deps: BookingDeps,
): Promise<RoomsAndRates> {
  const dateAttrs = { hotel_id: input.hotelId, check_in: input.dates.checkIn, check_out: input.dates.checkOut };
  const jwt = await getPartnerToken(deps.fetchImpl, { now: deps.now, nonce: deps.nonce, mock: deps.mock });
  const currency = input.currency ?? DEFAULT_CURRENCY;
  const rooms = buildRoomsOccupancy(input.party);

  // 1+2. resolve destination + search hotels (shared helper — carries the destination-disambiguation).
  const { searchResult, nextPage } = await searchHotelsInDestination(input.destination, input.party, input.dates, deps, currency);

  const cachedRsId = await cacheGet(deps.cache?.loadHotelRsId(input.hotelId));
  const findMatch = (result: unknown) =>
    (cachedRsId && matchHotelById(result, cachedRsId)) || matchHotelByName(result, input.hotelName);

  // Scan the first page, then FOLLOW pagination (bounded) — search-hotels pages its inventory, so
  // the chosen hotel may live beyond page 1. Session handles come from whichever page carries them
  // (they belong to the search session, so page 1's normally do).
  let pageResult = searchResult;
  let match = findMatch(pageResult);
  let handles = sessionHandles(pageResult);
  let key = nextResultsKey(pageResult);
  let pagesScanned = 1;
  let stalled = false;
  for (let scanned = 1; !match && key && scanned < MAX_SEARCH_PAGES; scanned++) {
    const prevKey = key;
    pageResult = await nextPage(key, scanned + 1);
    pagesScanned = scanned + 1;
    match = findMatch(pageResult);
    handles = sessionHandles(pageResult) ?? handles;
    key = nextResultsKey(pageResult);
    // STALL GUARD: the request-side pagination field name is unconfirmed against a live paged
    // capture (10c note). If the server ignored our key (same key back) or served an empty page,
    // walking further only repeats slow paid calls against inventory we've already seen — stop
    // early and fail honestly rather than burning the full page budget.
    if (!match && key !== null && (key === prevKey || extractHotelList(pageResult).length === 0)) {
      stalled = true;
      // eslint-disable-next-line no-console
      console.warn(
        `[booking] search-hotels pagination stalled for "${input.destination}" at page ${pagesScanned} ` +
          `(${key === prevKey ? 'nextResultsKey repeated — server likely ignored the request key' : 'empty page'}); stopping early`,
      );
      break;
    }
  }

  // Roll the walk up onto the enclosing booking.* span (booking.rates / booking.payment_url):
  // how far we scanned, whether the hotel matched, and whether the stall guard fired.
  const bookingSpan = trace.getActiveSpan();
  bookingSpan?.setAttribute(HZ.pagesScanned, pagesScanned);
  bookingSpan?.setAttribute(HZ.matched, Boolean(match));
  if (stalled) bookingSpan?.setAttribute(HZ.paginationStalled, true);

  if (!match) throw new BookingError('not-found', `"${input.hotelName}" not found in ${input.destination} availability`);
  // Lazy-populate the id↔hotel mapping on a fresh resolve (no-op if already cached the same id).
  if (match.id !== cachedRsId) {
    await cacheRun(deps.cache?.saveHotelRsId(input.hotelId, match.id, match.name));
  }
  if (!handles) throw new BookingError('session-expired', 'search-hotels returned no session handles');

  // 3. details + rates (combined endpoint)
  const ratesEnv = await tracedCall(deps, 'get_hotel_details_and_rates', '/mcp/hotel/get-hotel-details-and-rates', jwt, {
    hotelId: match.id,
    hotelName: match.name,
    token: handles.token,
    correlationId: handles.correlationId,
    checkIn: input.dates.checkIn,
    checkOut: input.dates.checkOut,
    rooms,
  }, dateAttrs, (result) => ({ [HZ.resultCount]: mapRoomRateOptions(result).length }));

  const mapped = mapRoomRateOptions(ratesEnv.result);
  if (mapped.length === 0) {
    throw new BookingError('no-availability', `No bookable rooms returned for "${match.name}"`);
  }
  // The live rate node carries no per-option currency code (only a `currencyrate` multiplier), so
  // stamp the REQUEST currency onto any option the mapper couldn't resolve one for — the picker
  // needs a currency to render the price.
  //
  // OPEN QUESTION (10c decision 6): every captured payload has currencyrate:1, so the conversion
  // DIRECTION (supplier→request or request→supplier) is unverified. We deliberately do NOT apply
  // the multiplier — but if RouteStack ever sends currencyrate ≠ 1, stamping the request currency
  // unconverted would mislabel every price, so make it LOUD and observable rather than silent.
  const currencyRate = mapped.find((o) => typeof o.currencyRate === 'number')?.currencyRate;
  if (currencyRate !== undefined && currencyRate !== 1) {
    console.warn(
      `[booking] RouteStack returned currencyrate=${currencyRate} (≠ 1) for "${match.name}" — ` +
        `totalRate may be in supplier currency; prices are stamped ${currency} UNCONVERTED. ` +
        'Verify the conversion direction with RouteStack before trusting these prices (10c decision 6).',
    );
    trace.getActiveSpan()?.setAttribute(HZ.currencyRate, currencyRate);
  }
  const options = mapped.map((o) => (o.currency ? o : { ...o, currency }));

  return {
    hotelId: match.id,
    hotelName: match.name,
    correlationId: handles.correlationId,
    token: handles.token,
    options,
    display: extractDisplayInfo(ratesEnv.result),
  };
}

/* ---- phase 2: revalidate + payment url --------------------------------- */

function extractUrl(env: Envelope): string | null {
  // get-payment-url returns { success, url } with `url` at the TOP level (not under result).
  if (env.raw && typeof env.raw === 'object') {
    const u = (env.raw as Record<string, unknown>).url;
    if (typeof u === 'string' && u) return u;
  }
  if (env.result && typeof env.result === 'object') {
    const u = (env.result as Record<string, unknown>).url;
    if (typeof u === 'string' && u) return u;
  }
  return null;
}

/** Render "Room 1: 2A/0C"-style traveller summary RouteStack's own checkout page expects
 * (confirmed 2026-07-03 against a live captured booking). v1 books a single room, so this is
 * always "Room 1: …" — matches every captured example. */
function describeTravellersForCheckout(party?: TravelParty): string | undefined {
  if (!party) return undefined;
  return `Room 1: ${party.adults}A/${party.childAges.length}C`;
}

/** PHASE 2 — revalidate the chosen rate, then fetch the deep-link payment URL. Called only
 * after the user picks a room in the modal. Threads the session handles from phase 1.
 *
 * Both calls carry more than RouteStack's OpenAPI marks `required`: `publishedRate` on
 * revalidate, and the display/pricing enrichment (hotelAddress/hotelImage/coordinates/
 * ratings/travellers/destination/displayedPrice + the revalidate result as `priceCheckResult`)
 * on get-payment-url. Confirmed 2026-07-03 against a live captured successful booking
 * (`scripts/booking/RouteStack.ai Hotel API.postman_collection.json`) — RouteStack decodes
 * these fields straight into the guest checkout page it hosts (deep-link `hotel/guests` URL),
 * so omitting them (as the wrapper previously did) ships a checkout page missing the hotel
 * photo, address, star rating, and price breakdown a real guest sees. Every field here is
 * still optional server-side — a caller with only the required ids still books. */
export async function selectAndPaymentUrl(
  sel: RoomSelection,
  deps: BookingDeps,
): Promise<BookingHandoff> {
  const attrs = { hotel_id: sel.hotelId, check_in: sel.dates.checkIn, check_out: sel.dates.checkOut };
  const jwt = await getPartnerToken(deps.fetchImpl, { now: deps.now, nonce: deps.nonce, mock: deps.mock });

  // revalidate the selected rate before payment (recommended immediately before payment-url).
  // publishedRate (when known) is the rate's own list price — RouteStack's request schema marks
  // it optional, but every live successful booking sends it.
  const revalidateEnv = await tracedCall(deps, 'revalidate', '/mcp/hotel/revalidate', jwt, {
    hotelId: sel.hotelId,
    recommendationId: sel.recommendationId,
    token: sel.token,
    correlationId: sel.correlationId,
    ...(sel.displayedPrice !== undefined ? { publishedRate: sel.displayedPrice } : {}),
  }, attrs);

  // get the deep-link checkout URL — enriched with display metadata + the revalidate result
  // (priceCheckResult) so RouteStack's hosted checkout page renders fully (see doc comment above).
  const payEnv = await tracedCall(deps, 'get_payment_url', '/mcp/hotel/get-payment-url', jwt, {
    hotelId: sel.hotelId,
    hotelName: sel.hotelName,
    token: sel.token,
    correlationId: sel.correlationId,
    recommendationId: sel.recommendationId,
    roomId: sel.roomId,
    checkIn: sel.dates.checkIn,
    checkOut: sel.dates.checkOut,
    ...(sel.display?.hotelAddress !== undefined ? { hotelAddress: sel.display.hotelAddress } : {}),
    ...(sel.display?.hotelImage !== undefined ? { hotelImage: sel.display.hotelImage } : {}),
    ...(sel.display?.hotelLatitude !== undefined ? { hotelLatitude: sel.display.hotelLatitude } : {}),
    ...(sel.display?.hotelLongitude !== undefined ? { hotelLongitude: sel.display.hotelLongitude } : {}),
    ...(sel.display?.hotelStarRating !== undefined ? { hotelStarRating: sel.display.hotelStarRating } : {}),
    ...(sel.display?.hotelRating !== undefined ? { hotelRating: sel.display.hotelRating } : {}),
    ...(sel.destination !== undefined ? { destination: sel.destination } : {}),
    ...(sel.displayedPrice !== undefined ? { displayedPrice: sel.displayedPrice } : {}),
    ...(describeTravellersForCheckout(sel.party) !== undefined ? { travellers: describeTravellersForCheckout(sel.party) } : {}),
    priceCheckResult: revalidateEnv.raw,
  }, attrs);

  const url = extractUrl(payEnv);
  if (!url) throw new BookingError('unknown', 'get-payment-url returned no url');
  return { bookingUrl: url };
}
