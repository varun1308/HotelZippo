/* POST /api/booking/rates — Phase 7 booking phase 1 (specs/10c-booking-routestack.md).
 * Runs the RouteStack session up to get-hotel-details-and-rates and returns the room/rate
 * options for the picker modal + the session handles (correlationId + token) phase 2 needs.
 *
 * Server-side so the RouteStack key + HMAC secret never reach the client. Behind the /chat
 * auth gate (signed-in user); a booking call by an anonymous user is rejected. Business
 * failures from RouteStack surface as a warm JSON error (kind + message + traceId), never a
 * raw stack — the chat speaks it back per spec 14. */
import { cookies } from 'next/headers';
import { createSupabaseServerClient } from '@/lib/db/ssr';
import { createServiceClient } from '@/lib/db/server';
import { searchAndRates } from '@/lib/booking/routestack';
import { createRouteStackFetch } from '@/lib/booking/transport';
import { createMockRouteStackFetch, routeStackMockEnabled } from '@/lib/booking/mock-transport';
import { makeSupabaseIdCache } from '@/lib/booking/id-cache';
import { makeSupabasePayloadLog, payloadLoggingEnabled } from '@/lib/booking/payload-log';
import { resolveCityLocation } from '@/lib/curation/google-places';
import { e2eEnabled } from '@/lib/booking/e2e-stub';
import { startDebugTimer } from '@/lib/observability/debug-timing';
import { BookingError } from '@/lib/booking/types';
import type { RatesRequest, RatesResponse, BookingApiError } from '@/lib/booking/api-contract';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request): Promise<Response> {
  let body: RatesRequest;
  try {
    body = (await req.json()) as RatesRequest;
  } catch {
    return errJson('transport', 'Invalid request', 400);
  }
  if (!body?.hotelName || !body?.destination || !body?.dates?.checkIn || !body?.dates?.checkOut || !body?.party) {
    return errJson('transport', 'Missing booking details', 400);
  }

  const cookieStore = await cookies();
  const supabase = createSupabaseServerClient({ getAll: () => cookieStore.getAll(), setAll: () => {} });
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return errJson('config', 'Please sign in to book.', 401);

  // E2E stub seam (specs/15a §1.1): after the REAL auth gate, swap the RouteStack provider
  // for a deterministic stub when the harness sets NEXT_PUBLIC_E2E=1. Lazy-imported so the
  // live bundle is untouched; absent the flag this is byte-for-byte today's behaviour.
  if (e2eEnabled()) {
    const { e2eRatesStub } = await import('@/lib/booking/e2e-stub');
    return e2eRatesStub(body);
  }

  // Mock-demo seam (specs/10e): server-only ROUTESTACK_MOCK=1 swaps the RouteStack transport for a
  // deterministic mock so the FULL booking stack (orchestrator → mapper → handles) runs unchanged,
  // without depending on the unstable RouteStack sandbox. The mock returns a deep link to the in-app
  // /booking-demo checkout. Not NEXT_PUBLIC_ → never in the browser bundle → prod-safe.
  if (routeStackMockEnabled()) {
    const t = startDebugTimer('booking.rates(mock)', { hotel: body.hotelName, dest: body.destination });
    try {
      const fetchImpl = createMockRouteStackFetch(req.url ? new URL(req.url).origin : '', body.hotelName);
      const result = await searchAndRates(body, { fetchImpl, mock: true });
      t.done({ options: result.options.length });
      return Response.json(result satisfies RatesResponse, { status: 200 });
    } catch (e) {
      t.fail(e);
      return bookingErr(e);
    }
  }

  const t = startDebugTimer('booking.rates(live)', { hotel: body.hotelName, dest: body.destination });

  try {
    // The RouteStack id cache (service-role tables) lets repeat bookings skip search-destinations and
    // match the hotel by id. Best-effort: if the service client can't be built, book without it.
    let cache;
    let debugLog;
    try {
      const service = createServiceClient();
      cache = makeSupabaseIdCache(service);
      // Flag-gated RouteStack payload capture (ROUTESTACK_DEBUG_PAYLOADS=1). Off → undefined → no capture.
      if (payloadLoggingEnabled()) debugLog = makeSupabasePayloadLog(service);
    } catch {
      cache = undefined;
      debugLog = undefined;
    }
    // Google-Places geocoder disambiguates the RouteStack destination (10c). Wrapped to warm-fail:
    // no GOOGLE_PLACES_API_KEY / any error → null → searchAndRates uses the legacy first-valid pick.
    const geocode = async (q: string) => {
      try {
        return await resolveCityLocation(q);
      } catch {
        return null;
      }
    };
    t.mark('searchAndRates:start');
    const result = await searchAndRates(body, { fetchImpl: createRouteStackFetch(), cache, geocode, debugLog });
    t.done({ options: result.options.length });
    const payload: RatesResponse = result;
    return Response.json(payload, { status: 200 });
  } catch (e) {
    t.fail(e);
    return bookingErr(e);
  }
}

function bookingErr(e: unknown): Response {
  if (e instanceof BookingError) {
    const status = e.kind === 'config' ? 500 : 200; // business outcomes are 200 + warm body
    const body: BookingApiError = { error: e.kind, message: e.message, traceId: e.traceId };
    return Response.json(body, { status });
  }
  const body: BookingApiError = { error: 'unknown', message: 'Booking is unavailable right now.' };
  return Response.json(body, { status: 200 });
}

function errJson(kind: BookingApiError['error'], message: string, status: number): Response {
  return Response.json({ error: kind, message } satisfies BookingApiError, { status });
}
