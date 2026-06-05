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
 * a real fetch client in dev/live (Slice C). Server-side only. */
import 'server-only';
import { trace, SpanStatusCode, type Span } from '@opentelemetry/api';
import { getPartnerToken, type RouteStackFetch } from './auth';
import { buildRoomsOccupancy } from './party';
import { mapRoomRateOptions } from './rates';
import {
  BookingError,
  type TravelParty,
  type BookingDates,
  type RoomsAndRates,
  type RoomSelection,
  type BookingHandoff,
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

/** Injectable seam + clock/nonce hooks (so auth is deterministic in tests). */
export interface BookingDeps {
  fetchImpl: RouteStackFetch;
  now?: () => number;
  nonce?: () => string;
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
): Promise<Envelope> {
  const tracer = trace.getTracer(TRACER);
  return tracer.startActiveSpan(`routestack.${step}`, async (span: Span) => {
    for (const [k, v] of Object.entries(attrs)) span.setAttribute(k, v);
    const start = Date.now();
    try {
      const headers = token ? { Authorization: `Bearer ${token}` } : undefined;
      let raw: unknown;
      try {
        raw = await deps.fetchImpl(path, body, headers);
      } catch (e) {
        throw new BookingError('transport', `${step} request failed: ${e instanceof Error ? e.message : String(e)}`);
      }
      const env = asEnvelope(raw);
      span.setAttribute('success', env.success);
      if (env.code !== undefined) span.setAttribute('code', env.code);
      if (!env.success) {
        const err = attachTrace(envelopeError(env, step), span);
        span.recordException(err);
        span.setStatus({ code: SpanStatusCode.ERROR });
        throw err;
      }
      span.setStatus({ code: SpanStatusCode.OK });
      return env;
    } catch (e) {
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
      span.setAttribute('duration_ms', Date.now() - start);
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

function pickDestination(result: unknown): DestinationHit | null {
  const arr = Array.isArray(result) ? result : [];
  for (const item of arr) {
    if (item && typeof item === 'object') {
      const r = item as Record<string, unknown>;
      const coords = (r.coordinates ?? {}) as Record<string, unknown>;
      const id = r.id;
      const lat = coords.lat;
      const long = coords.long;
      if (typeof id === 'string' && typeof lat === 'number' && typeof long === 'number') {
        return { id, lat, long, type: typeof r.type === 'string' ? r.type : 'City' };
      }
    }
  }
  return null;
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
export async function searchAndRates(
  input: SearchAndRatesInput,
  deps: BookingDeps,
): Promise<RoomsAndRates> {
  const dateAttrs = { hotel_id: input.hotelId, check_in: input.dates.checkIn, check_out: input.dates.checkOut };
  const jwt = await getPartnerToken(deps.fetchImpl, { now: deps.now, nonce: deps.nonce });
  const currency = input.currency ?? DEFAULT_CURRENCY;
  const rooms = buildRoomsOccupancy(input.party);

  // 1. resolve destination → id + coords
  const destEnv = await tracedCall(deps, 'search_destinations', '/mcp/hotel/search-destinations', jwt, {
    query: input.destination,
    type: 'DESTINATION',
  }, dateAttrs);
  const dest = pickDestination(destEnv.result);
  if (!dest) throw new BookingError('not-found', `Could not resolve destination "${input.destination}"`);

  // 2. search hotels in that destination
  const searchEnv = await tracedCall(deps, 'search_hotels', '/mcp/hotel/search-hotels', jwt, {
    destinationId: dest.id,
    destinationType: dest.type,
    lat: dest.lat,
    long: dest.long,
    checkIn: input.dates.checkIn,
    checkOut: input.dates.checkOut,
    rooms,
    currency,
  }, dateAttrs);

  const match = matchHotelByName(searchEnv.result, input.hotelName);
  if (!match) throw new BookingError('not-found', `"${input.hotelName}" not found in ${input.destination} availability`);
  const handles = sessionHandles(searchEnv.result);
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
  }, dateAttrs);

  const options = mapRoomRateOptions(ratesEnv.result);
  if (options.length === 0) {
    throw new BookingError('no-availability', `No bookable rooms returned for "${match.name}"`);
  }

  return {
    hotelId: match.id,
    hotelName: match.name,
    correlationId: handles.correlationId,
    token: handles.token,
    options,
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

/** PHASE 2 — revalidate the chosen rate, then fetch the deep-link payment URL. Called only
 * after the user picks a room in the modal. Threads the session handles from phase 1. */
export async function selectAndPaymentUrl(
  sel: RoomSelection,
  deps: BookingDeps,
): Promise<BookingHandoff> {
  const attrs = { hotel_id: sel.hotelId, check_in: sel.dates.checkIn, check_out: sel.dates.checkOut };
  const jwt = await getPartnerToken(deps.fetchImpl, { now: deps.now, nonce: deps.nonce });

  // revalidate the selected rate before payment (recommended immediately before payment-url)
  await tracedCall(deps, 'revalidate', '/mcp/hotel/revalidate', jwt, {
    hotelId: sel.hotelId,
    recommendationId: sel.recommendationId,
    token: sel.token,
    correlationId: sel.correlationId,
  }, attrs);

  // get the deep-link checkout URL
  const payEnv = await tracedCall(deps, 'get_payment_url', '/mcp/hotel/get-payment-url', jwt, {
    hotelId: sel.hotelId,
    hotelName: sel.hotelName,
    token: sel.token,
    correlationId: sel.correlationId,
    recommendationId: sel.recommendationId,
    roomId: sel.roomId,
    checkIn: sel.dates.checkIn,
    checkOut: sel.dates.checkOut,
  }, attrs);

  const url = extractUrl(payEnv);
  if (!url) throw new BookingError('unknown', 'get-payment-url returned no url');
  return { bookingUrl: url };
}
