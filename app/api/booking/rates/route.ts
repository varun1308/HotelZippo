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
import { searchAndRates } from '@/lib/booking/routestack';
import { createRouteStackFetch } from '@/lib/booking/transport';
import { e2eEnabled } from '@/lib/booking/e2e-stub';
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

  try {
    const result = await searchAndRates(body, { fetchImpl: createRouteStackFetch() });
    const payload: RatesResponse = result;
    return Response.json(payload, { status: 200 });
  } catch (e) {
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
