/* Mock RouteStack fixtures + a fake transport for Phase 7 unit tests (key-free CI).
 *
 * Until a real sandbox response is captured (Slice C → specs/fixtures/routestack/
 * rooms-rates.json), these mirror the SHAPES confirmed by specs/openapi.yaml: the
 * { success, message, code, result } envelope, search-hotels' result.result[] + correlationId
 * + token, a rooms/rates blob carrying recommendationId + roomId, and get-payment-url's
 * { success, url }. The rates blob deliberately nests rate nodes so the adaptive mapper is
 * exercised against realistic nesting. */
import type { RouteStackFetch } from '@/lib/booking/auth';

export const TOKEN_RESPONSE = { token: 'jwt-fixture-token', expiresIn: '24h' };

export const DESTINATIONS_RESPONSE = {
  success: true,
  message: 'data retrieved',
  code: 5128,
  result: [
    { city: null, type: 'City', referenceId: null, fullName: 'Phuket, Thailand', country: 'TH', id: '900100', coordinates: { lat: 7.8804, long: 98.3923 } },
  ],
};

export const SEARCH_HOTELS_RESPONSE = {
  success: true,
  message: null,
  code: 200,
  result: {
    correlationId: 'corr-fixture-123',
    token: 'listing-token-abc',
    currency: 'USD',
    count: 2,
    result: [
      { id: 'H-1001', name: 'The Family Beach Resort', ourprice: 240.5, baseprice: 280, starRating: 5, currency: 'USD' },
      { id: 'H-1002', name: 'Karon Quiet Stay', ourprice: 180, baseprice: 200, starRating: 4, currency: 'USD' },
    ],
  },
};

/** Mimics the trimmed get-hotel-details-and-rates payload: rooms each with rate plans that
 * carry the two ids + descriptive fields (under plausible aliases the mapper probes), plus a
 * `content` node with the hotel display metadata (address/geo/star/heroImage) confirmed live
 * 2026-07-03 against a real successful booking — see extractDisplayInfo. */
export const DETAILS_AND_RATES_RESPONSE = {
  success: true,
  message: null,
  code: 200,
  result: {
    hotelId: 'H-1001',
    content: {
      heroImage: 'https://cdn.example.test/beach-resort.jpg',
      contact: {
        address: {
          line1: '99 Beach Rd',
          city: { name: 'Patong' },
          state: { name: 'Phuket' },
          country: { name: 'Thailand' },
        },
      },
      geoCode: { lat: 7.8804, long: 98.3923 },
      starRating: 5,
    },
    rooms: [
      {
        roomType: 'Deluxe Twin',
        bedType: '2 Twin',
        maxOccupancy: 3,
        rates: [
          {
            recommendationId: 'reco-A',
            roomId: 'room-A',
            total: 482.5,
            currency: 'USD',
            boardBasis: 'Breakfast included',
            free_cancellation: true,
            cancellation: 'Free cancellation until 10 May',
          },
        ],
      },
      {
        roomType: 'Family Suite',
        bedType: '1 King + 1 Sofa',
        maxOccupancy: 4,
        rates: [
          {
            recommendationId: 'reco-B',
            roomId: 'room-B',
            total: 690,
            currency: 'USD',
            boardBasis: 'Room only',
            free_cancellation: false,
          },
        ],
      },
    ],
  },
};

/** A representative revalidate result (pricing breakdown + room/rate echo) — the whole envelope
 * is forwarded verbatim as get-payment-url's `priceCheckResult` (10c, live-verified 2026-07-03). */
export const REVALIDATE_RESPONSE = {
  success: true,
  message: 'data retrieved',
  code: 200,
  result: { token: 'listing-token-abc', currency: 'USD', hotelId: 'H-1001', ourprice: 372.13, totalRate: 336.72, publishedRate: 416.78 },
};

export const PAYMENT_URL_RESPONSE = {
  success: true,
  url: 'https://evolve.routestack.ai/hotel/guests?query=ABC123&deeplink=Y',
};

/** Common failure envelopes. */
export const NO_AVAILABILITY_RESPONSE = { success: false, message: null, code: 204, result: null };
export const OFFER_EXPIRED_RESPONSE = { success: false, message: 'The offer you were viewing has expired', code: 5148, result: null };

export type PathOverrides = Partial<Record<string, unknown>>;

/** Build a fake RouteStackFetch returning canned responses by path. Pass `overrides` to
 * swap a single step's response (e.g. force no-availability on search-hotels). Records calls
 * for assertions on what the wrapper sent. */
export function makeMockFetch(overrides: PathOverrides = {}): {
  fetchImpl: RouteStackFetch;
  calls: Array<{ path: string; body: unknown; headers?: Record<string, string> }>;
} {
  const calls: Array<{ path: string; body: unknown; headers?: Record<string, string> }> = [];
  const defaults: Record<string, unknown> = {
    '/mcp/auth/partner-token': TOKEN_RESPONSE,
    '/mcp/hotel/search-destinations': DESTINATIONS_RESPONSE,
    '/mcp/hotel/search-hotels': SEARCH_HOTELS_RESPONSE,
    '/mcp/hotel/get-hotel-details-and-rates': DETAILS_AND_RATES_RESPONSE,
    '/mcp/hotel/revalidate': REVALIDATE_RESPONSE,
    '/mcp/hotel/get-payment-url': PAYMENT_URL_RESPONSE,
  };
  const table = { ...defaults, ...overrides };
  const fetchImpl: RouteStackFetch = async (path, body, headers) => {
    calls.push({ path, body, headers });
    if (!(path in table)) throw new Error(`unexpected path ${path}`);
    const v = table[path];
    if (v instanceof Error) throw v;
    return v;
  };
  return { fetchImpl, calls };
}

/** Deterministic clock/nonce for auth tests. */
export const FIXED_NOW = () => 1_700_000_000_000;
export const FIXED_NONCE = () => 'fixed-nonce-uuid';

/* ---- webhook lifecycle (10d) — captured LIVE 2026-07-03 -------------------
 *
 * A real sandbox booking (StripViewSuites at Jockey Club, Las Vegas, 2026-07-17→2026-07-20)
 * delivered this exact 4-event order lifecycle to our webhook endpoint via
 * `x-webhook-access-key` (the confirmed live carrier header — see lib/booking/webhook.ts).
 * `billing_email`/`billing_name` are genericised per house convention (never a real email in
 * committed fixtures); every other field — event names, orderid, orderstatus, price, currency,
 * paymentstatus, account_code — is the REAL captured shape, unmodified. */
export const WEBHOOK_ORDER_CREATION_SUCCESS = {
  event: 'ORDER_CREATION_SUCCESS',
  orderid: 'RSA-75271203599',
  orderstatus: 'INCOMPLETE',
  message: 'Created order successfully',
  billing_email: 'raj@example.com',
  billing_name: 'Raj Mehta',
  price: 1567.69,
  currency: 'USD',
  module: 'HOTEL',
  event_timestamp: '2026-07-03T14:06:20.904Z',
  createdat: '2026-07-03T14:06:20.904Z',
  account_code: 'AWP889CG',
};

export const WEBHOOK_ORDER_PAYMENT_AUTHORIZED = {
  event: 'ORDER_PAYMENT_AUTHORIZED',
  orderid: 'RSA-75271203599',
  orderstatus: 'INCOMPLETE',
  message: 'Authorized payment successfully',
  createdat: '2026-07-03T19:36:18.540Z',
  billing_email: 'raj@example.com',
  billing_name: 'Raj Mehta',
  price: 1567.69,
  currency: 'USD',
  module: 'HOTEL',
  event_timestamp: '2026-07-03 14:06:32',
  paymentstatus: 'AUTHORIZED',
  account_code: 'AWP889CG',
};

export const WEBHOOK_BOOKING_SUCCESS = {
  event: 'BOOKING_SUCCESS',
  orderid: 'RSA-75271203599',
  orderstatus: 'INCOMPLETE',
  message: 'Booked hotel successfully',
  billing_email: 'raj@example.com',
  billing_name: 'Raj Mehta',
  price: 1567.69,
  currency: 'USD',
  module: 'HOTEL',
  event_timestamp: '2026-07-03T14:06:45.669Z',
  createdat: '2026-07-03T19:36:18.540Z',
  paymentstatus: 'AUTH_ONLY',
  account_code: 'AWP889CG',
};

export const WEBHOOK_ORDER_PAYMENT_CAPTURED_SUCCESS = {
  event: 'ORDER_PAYMENT_CAPTURED_SUCCESS',
  orderid: 'RSA-75271203599',
  orderstatus: 'CONFIRMED',
  message: 'Captured payment successfully',
  createdat: '2026-07-03T19:36:18.540Z',
  billing_email: 'raj@example.com',
  billing_name: 'Raj Mehta',
  price: 1567.69,
  currency: 'USD',
  module: 'HOTEL',
  event_timestamp: '2026-07-03 14:06:46',
  paymentstatus: 'COMPLETED',
  account_code: 'AWP889CG',
};

/** The full real lifecycle in delivery order (RouteStack retried CREATION_SUCCESS ×3 and
 * BOOKING_SUCCESS ×3 while our webhook 401'd on the pre-fix header name — captured as delivered,
 * duplicates included, to also exercise idempotent re-delivery, TC-P5-style). */
export const WEBHOOK_LIVE_LIFECYCLE = [
  WEBHOOK_ORDER_CREATION_SUCCESS,
  WEBHOOK_ORDER_CREATION_SUCCESS,
  WEBHOOK_ORDER_CREATION_SUCCESS,
  WEBHOOK_ORDER_PAYMENT_AUTHORIZED,
  WEBHOOK_BOOKING_SUCCESS,
  WEBHOOK_ORDER_PAYMENT_CAPTURED_SUCCESS,
  WEBHOOK_BOOKING_SUCCESS,
  WEBHOOK_BOOKING_SUCCESS,
];
