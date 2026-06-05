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
 * carry the two ids + descriptive fields (under plausible aliases the mapper probes). */
export const DETAILS_AND_RATES_RESPONSE = {
  success: true,
  message: null,
  code: 200,
  result: {
    hotelId: 'H-1001',
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

export const REVALIDATE_RESPONSE = { success: true, message: null, code: 200, result: { ok: true } };

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
