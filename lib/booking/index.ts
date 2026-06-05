/* Booking module barrel (Phase 7 · specs/10c-booking-routestack.md). */
export { searchAndRates, selectAndPaymentUrl } from './routestack';
export type { SearchAndRatesInput, BookingDeps } from './routestack';
export { inferParty, describeParty, defaultRoomCount, buildRoomsOccupancy, resolveDates, isIsoDate } from './party';
export type { InferredParty } from './party';
export { mapRoomRateOptions } from './rates';
export { signPartnerToken, getPartnerToken, readEnv, _clearTokenCache } from './auth';
export type { RouteStackFetch } from './auth';
export {
  BookingError,
  type TravelParty,
  type BookingDates,
  type RoomRateOption,
  type RoomsAndRates,
  type RoomSelection,
  type BookingHandoff,
  type BookingErrorKind,
} from './types';
