/* Shared request/response contracts for the booking API routes (Phase 7).
 *
 * The booking wrapper is server-only (RouteStack key + HMAC secret never reach the client),
 * so the chat calls it through /api/booking/*. These types are the wire contract shared by
 * the client flow hook and the route handlers. Pure types — safe to import from either side. */
import type { TravelParty, BookingDates, RoomRateOption, BookingErrorKind, HotelDisplayInfo } from './types';

/** POST /api/booking/rates — phase 1 (search + rates for the picker). */
export interface RatesRequest {
  hotelId: string;
  hotelName: string;
  destination: string;
  party: TravelParty;
  dates: BookingDates;
  currency?: string;
  /** Client-minted per-conversation correlation id (specs/14) — validated server-side and
   * bound into OTEL baggage so booking.rates + its routestack.* spans join the chat's
   * hz.conversation_id Dash0 view. Optional so an older client omitting it still books. */
  conversationId?: string;
}

export interface RatesResponse {
  hotelId: string;
  hotelName: string;
  correlationId: string;
  token: string;
  options: RoomRateOption[];
  /** Hotel display metadata for RouteStack's checkout page (see HotelDisplayInfo) — carried
   * client-side through to PaymentUrlRequest.display, never re-fetched. */
  display: HotelDisplayInfo;
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
  /** Booking context for the pending booking_orders row (10d's pending-write contract) AND
   * (destination + displayedPrice) forwarded to RouteStack's own get-payment-url — see
   * HotelDisplayInfo doc comment. Optional so an older client omitting them still gets its
   * deep link (RouteStack's checkout page just renders with less). */
  destination?: string;
  currency?: string;
  /** Carried verbatim from phase 1's RatesResponse.display, then sent to get-payment-url so
   * RouteStack's hosted checkout page has the hotel photo/address/rating (10c). */
  display?: HotelDisplayInfo;
  /** The selected option's total price (RoomRateOption.price) — sent to RouteStack as
   * `displayedPrice` and as `publishedRate` on the preceding revalidate call. */
  displayedPrice?: number;
  /** Confirmed party — used only to build the "Room 1: 2A/0C" traveller summary RouteStack's
   * checkout page expects; never re-validated (the server already validated it in phase 1). */
  party?: TravelParty;
  /** Per-conversation correlation id (specs/14) — same contract as RatesRequest.conversationId. */
  conversationId?: string;
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
