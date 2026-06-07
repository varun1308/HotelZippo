/* E2E-ONLY deterministic /api/booking/* stub (specs/15a §1.1, J4).
 *
 * When NEXT_PUBLIC_E2E === '1' (Playwright harness only), the booking routes delegate here
 * instead of calling RouteStack. This makes the booking journey deterministic + key-free
 * (RouteStack is admin-blocked anyway — see routestack-sandbox-blocker), and never executes
 * a real booking.
 *
 * It returns the EXACT RatesResponse / PaymentUrlResponse / BookingApiError shapes the live
 * routes return, so the CLIENT booking flow under test is 100% production code — only the
 * RouteStack provider is swapped. The auth gate is NOT stubbed (the route still 401s an
 * anonymous caller); this stub only runs AFTER the route's own auth check.
 *
 * A request whose hotelName contains the magic token "__NOAVAIL__" returns a warm
 * no-availability error, so J4 can exercise the graceful-fallback path deterministically.
 *
 * NOT a client module — imported only by the server routes. No 'use client'. */
import type {
  RatesRequest,
  RatesResponse,
  PaymentUrlRequest,
  PaymentUrlResponse,
  BookingApiError,
} from './api-contract';
import type { RoomRateOption } from './types';

/** True when the harness has enabled E2E stub mode. Read at call time (not import). */
export function e2eEnabled(): boolean {
  return process.env.NEXT_PUBLIC_E2E === '1';
}

/** Two deterministic room options: one fully-described, one sparse — so J4 can assert both
 * the present fields AND graceful omission of absent ones. */
const STUB_OPTIONS: RoomRateOption[] = [
  {
    recommendationId: 'e2e-reco-1',
    roomId: 'e2e-room-1',
    roomName: 'Deluxe Pool Access',
    price: 482.5,
    currency: 'USD',
    cancellation: 'Free cancellation until 3 days before',
    freeCancellation: true,
    board: 'Breakfast included',
    bed: '1 King',
    maxOccupancy: 3,
  },
  {
    // Intentionally sparse — only the ids + a name. Every other field omitted to prove the
    // picker renders it without broken/empty rows.
    recommendationId: 'e2e-reco-2',
    roomId: 'e2e-room-2',
    roomName: 'Garden Twin',
  },
];

const STUB_BOOKING_URL = 'https://example.test/checkout/e2e-booking-session';

/** Magic hotelName token → force the no-availability fallback path. */
function wantsNoAvailability(name: string | undefined): boolean {
  return typeof name === 'string' && name.includes('__NOAVAIL__');
}

/** Stub POST /api/booking/rates. */
export function e2eRatesStub(body: RatesRequest): Response {
  if (wantsNoAvailability(body?.hotelName)) {
    const err: BookingApiError = {
      error: 'no-availability',
      message: 'No rooms are available for those dates. Want me to try different dates?',
    };
    return Response.json(err, { status: 200 }); // business outcome = warm 200 body
  }
  const payload: RatesResponse = {
    hotelId: body.hotelId,
    hotelName: body.hotelName,
    correlationId: 'e2e-correlation',
    token: 'e2e-token',
    options: STUB_OPTIONS,
  };
  return Response.json(payload, { status: 200 });
}

/** Stub POST /api/booking/payment-url. */
export function e2ePaymentUrlStub(_body: PaymentUrlRequest): Response {
  const payload: PaymentUrlResponse = { bookingUrl: STUB_BOOKING_URL };
  return Response.json(payload, { status: 200 });
}
