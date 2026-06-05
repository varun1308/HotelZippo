/* Shared request/response contracts for the booking API routes (Phase 7).
 *
 * The booking wrapper is server-only (RouteStack key + HMAC secret never reach the client),
 * so the chat calls it through /api/booking/*. These types are the wire contract shared by
 * the client flow hook and the route handlers. Pure types — safe to import from either side. */
import type { TravelParty, BookingDates, RoomRateOption, BookingErrorKind } from './types';

/** POST /api/booking/rates — phase 1 (search + rates for the picker). */
export interface RatesRequest {
  hotelId: string;
  hotelName: string;
  destination: string;
  party: TravelParty;
  dates: BookingDates;
  currency?: string;
}

export interface RatesResponse {
  hotelId: string;
  hotelName: string;
  correlationId: string;
  token: string;
  options: RoomRateOption[];
}

/** POST /api/booking/payment-url — phase 2 (revalidate + deep link for a chosen room). */
export interface PaymentUrlRequest {
  hotelId: string;
  hotelName: string;
  correlationId: string;
  token: string;
  recommendationId: string;
  roomId: string;
  dates: BookingDates;
}

export interface PaymentUrlResponse {
  bookingUrl: string;
}

/** Error body returned by both routes (warm, never a raw stack — drives the fallback copy). */
export interface BookingApiError {
  error: BookingErrorKind;
  message: string;
  traceId?: string;
}
