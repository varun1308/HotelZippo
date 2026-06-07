/* POST /api/booking/payment-url — Phase 7 booking phase 2 (specs/10c-booking-routestack.md).
 * Revalidates the chosen rate and returns the deep-link checkout URL (booking_url) the chat
 * opens in a new tab. Called only after the user selects a room in the picker.
 *
 * Server-side (key/secret never reach the client); behind the auth gate. Warm JSON errors on
 * any RouteStack business failure (e.g. offer expired) — the chat offers a clear next action
 * (re-search / another shortlisted hotel) per spec 14. */
import { cookies } from 'next/headers';
import { createSupabaseServerClient } from '@/lib/db/ssr';
import { selectAndPaymentUrl } from '@/lib/booking/routestack';
import { createRouteStackFetch } from '@/lib/booking/transport';
import { e2eEnabled } from '@/lib/booking/e2e-stub';
import { BookingError } from '@/lib/booking/types';
import type { PaymentUrlRequest, PaymentUrlResponse, BookingApiError } from '@/lib/booking/api-contract';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request): Promise<Response> {
  let body: PaymentUrlRequest;
  try {
    body = (await req.json()) as PaymentUrlRequest;
  } catch {
    return errJson('transport', 'Invalid request', 400);
  }
  if (!body?.hotelId || !body?.token || !body?.correlationId || !body?.recommendationId || !body?.roomId || !body?.dates) {
    return errJson('transport', 'Missing room selection', 400);
  }

  const cookieStore = await cookies();
  const supabase = createSupabaseServerClient({ getAll: () => cookieStore.getAll(), setAll: () => {} });
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return errJson('config', 'Please sign in to book.', 401);

  // E2E stub seam (specs/15a §1.1): after the REAL auth gate, return a deterministic deep
  // link instead of calling RouteStack when the harness sets NEXT_PUBLIC_E2E=1.
  if (e2eEnabled()) {
    const { e2ePaymentUrlStub } = await import('@/lib/booking/e2e-stub');
    return e2ePaymentUrlStub(body);
  }

  try {
    const result = await selectAndPaymentUrl(
      {
        hotelId: body.hotelId,
        hotelName: body.hotelName,
        correlationId: body.correlationId,
        token: body.token,
        recommendationId: body.recommendationId,
        roomId: body.roomId,
        dates: body.dates,
      },
      { fetchImpl: createRouteStackFetch() },
    );
    const payload: PaymentUrlResponse = result;
    return Response.json(payload, { status: 200 });
  } catch (e) {
    if (e instanceof BookingError) {
      const status = e.kind === 'config' ? 500 : 200;
      return Response.json({ error: e.kind, message: e.message, traceId: e.traceId } satisfies BookingApiError, { status });
    }
    return Response.json({ error: 'unknown', message: 'Booking is unavailable right now.' } satisfies BookingApiError, { status: 200 });
  }
}

function errJson(kind: BookingApiError['error'], message: string, status: number): Response {
  return Response.json({ error: kind, message } satisfies BookingApiError, { status });
}
