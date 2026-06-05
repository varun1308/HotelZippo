/* Booking wrapper public types (Phase 7 · specs/10c-booking-routestack.md).
 *
 * The Booking Agent is a thin pass-through to RouteStack (08c decision D4 — no Claude
 * prompt). RouteStack's deep-link model means HotelZippo holds NO payment/PCI/reservation
 * state: the final get-payment-url step returns a checkout URL the user completes
 * off-platform. These types describe what the wrapper exchanges with the chat UI — they
 * are deliberately UI-shaped (the booking_url, the room/rate options for the picker),
 * not a mirror of RouteStack's raw payloads. */

/** The travelling party the booking is for. INFERRED from the family profile (adults =
 * 1 + spouse, children with ages) but AUTHORITATIVE only once the user confirms it in the
 * combined confirm turn — that's how grandparents (notes-only, not a structured field)
 * enter the party. The confirmed party + rooms drive RouteStack's rooms[] array. */
export interface TravelParty {
  adults: number;
  /** Ages of accompanying children (drives RouteStack childAges). */
  childAges: number[];
  /** Number of rooms to book (inferred default; user-confirmed). */
  rooms: number;
}

/** The resolved trip dates for the booking (ISO yyyy-mm-dd). */
export interface BookingDates {
  checkIn: string;
  checkOut: string;
}

/** One selectable room/rate option shown in the picker modal. Mapped ADAPTIVELY from the
 * get-hotel-details-and-rates payload (its exact field names are pinned by a captured
 * sandbox fixture in Slice C) — every descriptive field is optional so a missing field is
 * omitted gracefully rather than rendering broken. The two ids are what phase 2 needs. */
export interface RoomRateOption {
  /** RouteStack identifiers threaded into revalidate + get-payment-url. */
  recommendationId: string;
  roomId: string;
  /** Display: room type / name (e.g. "Deluxe Twin"). */
  roomName?: string;
  /** Total price for the stay + its currency (e.g. 482.5 / "USD"). */
  price?: number;
  currency?: string;
  /** Cancellation summary (e.g. "Free cancellation until 10 May"). */
  cancellation?: string;
  /** True when the rate is refundable / free-cancellation. */
  freeCancellation?: boolean;
  /** Board basis (e.g. "Room only", "Breakfast included"). */
  board?: string;
  /** Bed configuration (e.g. "1 King", "2 Twin"). */
  bed?: string;
  /** Max occupancy for the room. */
  maxOccupancy?: number;
}

/** Phase-1 result: the matched hotel's available rooms/rates for the picker, plus the
 * session handles (correlationId + token) that phase 2 must thread back. */
export interface RoomsAndRates {
  hotelId: string;
  hotelName: string;
  correlationId: string;
  token: string;
  options: RoomRateOption[];
}

/** Phase-2 result: the deep-link checkout URL the user is handed off to (new tab). */
export interface BookingHandoff {
  bookingUrl: string;
}

/** A user's chosen room from the picker, carried into phase 2. */
export interface RoomSelection {
  hotelId: string;
  hotelName: string;
  correlationId: string;
  token: string;
  recommendationId: string;
  roomId: string;
  dates: BookingDates;
}

/** Why a booking step failed — drives the warm conversational fallback (specs/14). The
 * wrapper branches on the RouteStack success envelope (not HTTP status), so these map the
 * known business outcomes to a kind the UI can speak to without leaking raw errors. */
export type BookingErrorKind =
  | 'no-availability' // search returned nothing / code 204
  | 'offer-expired' // rate gone (code 5148) — revalidate / re-search
  | 'session-expired' // correlationId/token TTL lapsed mid-flow — re-run search
  | 'not-found' // chosen hotel not matched in destination results
  | 'config' // env / credentials missing
  | 'transport' // network / non-envelope failure
  | 'unknown';

export class BookingError extends Error {
  readonly kind: BookingErrorKind;
  /** RouteStack envelope code when present (e.g. 204, 5148). */
  readonly code?: number;
  /** OTEL trace id for Dash0 cross-reference (set by the wrapper). */
  traceId?: string;

  constructor(kind: BookingErrorKind, message: string, code?: number) {
    super(message);
    this.name = 'BookingError';
    this.kind = kind;
    this.code = code;
  }
}
