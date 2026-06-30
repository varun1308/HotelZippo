/* Mock RouteStack transport — production-showable demo path (specs/10e-booking-mock.md).
 *
 * The RouteStack sandbox is chronically unstable, so a real live booking can't be driven on
 * demand. HotelZippo's MOAT is the curated hotel-selection intelligence, not the booking
 * transport — so for launch/demo we mock ONLY the upstream booking HTTP and let the entire
 * production booking stack (orchestrator → rates mapper → booking_orders → webhook lifecycle)
 * run unchanged.
 *
 * This is a third RouteStackFetch (alongside the live createRouteStackFetch and the test
 * fixtures): it returns REAL RouteStack envelope JSON ({ success, code, message, result }) for
 * each /mcp/... path the orchestrator calls, so mapRoomRateOptions, the session handles, the
 * deep-link extraction, etc. all run for real. Determinism comes from hashing the request
 * (hotel name + dates) so the same input always yields the same rooms/prices.
 *
 * Gated by the SERVER-ONLY flag ROUTESTACK_MOCK=1 (never NEXT_PUBLIC_ → never baked into the
 * browser bundle → the preflight build guard needs no change). Default off → byte-for-byte the
 * live behaviour.
 *
 * NOT 'use client': server-side (reached only by the booking API routes + tests), like
 * ./transport and ./routestack. */
import { DESTINATIONS } from '@/lib/db/schemas';
import type { RouteStackFetch } from './auth';

/** Server-only flag. Read at CALL time (never at import) so the module is env-free to import. */
export function routeStackMockEnabled(): boolean {
  return process.env.ROUTESTACK_MOCK === '1';
}

/** Magic demo-control tokens (mirror the E2E-stub convention) embedded in a hotelName to force
 * a warm fallback path without touching real RouteStack. */
const NOAVAIL = '__NOAVAIL__';
const EXPIRED = '__EXPIRED__';

/** Real lat/long per supported destination so pickDestination resolves a sensible candidate
 * (geocode disambiguation is a no-op here — we return exactly one candidate). */
const DEST_COORDS: Record<string, { lat: number; long: number; country: string }> = {
  Phuket: { lat: 7.8804, long: 98.3923, country: 'Thailand' },
  Singapore: { lat: 1.3521, long: 103.8198, country: 'Singapore' },
  Tokyo: { lat: 35.6762, long: 139.6503, country: 'Japan' },
  Orlando: { lat: 28.5383, long: -81.3792, country: 'United States' },
  Bali: { lat: -8.3405, long: 115.092, country: 'Indonesia' },
};

/** Small, stable string hash (FNV-1a) → drives deterministic per-hotel pricing. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function asBody(body: unknown): Record<string, unknown> {
  return body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
}

/** Nights between two ISO yyyy-mm-dd dates (≥1), so the total scales with the stay length. */
function nights(checkIn?: unknown, checkOut?: unknown): number {
  if (typeof checkIn !== 'string' || typeof checkOut !== 'string') return 1;
  const a = Date.parse(checkIn);
  const b = Date.parse(checkOut);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return 1;
  return Math.max(1, Math.round((b - a) / 86_400_000));
}

/** Build a deterministic availability.groups[].rooms[] payload in the CONFIRMED live shape
 * (10c §6) so the REAL mapRoomRateOptions produces several options — including a sparse room
 * (only ids + name) to prove graceful field omission. Prices vary per hotel + stay length. */
function buildRates(hotelId: string, hotelName: string, checkIn?: unknown, checkOut?: unknown) {
  const seed = hash(hotelName);
  const n = nights(checkIn, checkOut);
  const base = 120 + (seed % 260); // 120–379 per night, stable per hotel
  const id = (suffix: string) => `mock-${(seed % 100000).toString(36)}-${suffix}`;

  const fullRoom = {
    id: id('room-1'),
    name: 'Deluxe Pool Access',
    description: 'King bed, private balcony with pool access.',
    recommendationId: id('reco-1'),
    rateid: id('rate-1'),
    availability: '3',
    ourprice: round(base * n),
    publishedRate: round(base * n * 1.15),
    baseRate: round(base * n * 0.85),
    totalRate: round(base * n),
    refundable: true,
    refundability: 'Free cancellation until 3 days before check-in',
    boardBasis: { type: 'BreakfastIncluded', description: null, displayText: 'Breakfast included' },
    beds: [{ type: 'KING', count: 1 }],
    smokingAllowed: false,
    facilities: [],
    occupancies: [{ roomId: id('room-1'), numOfAdults: 2, numOfChildren: 1 }],
  };

  // Intentionally sparse — only ids + a name, every descriptive field omitted, so the picker
  // proves it renders without broken/empty rows (the mapper omits absent fields).
  const sparseRoom = {
    id: id('room-2'),
    name: 'Garden Twin',
    recommendationId: id('reco-2'),
    rateid: id('rate-2'),
    occupancies: [{ roomId: id('room-2'), numOfAdults: 2, numOfChildren: 0 }],
  };

  return {
    hotelId,
    token: id('token'),
    correlationId: id('corr'),
    checkIn: typeof checkIn === 'string' ? checkIn : null,
    checkOut: typeof checkOut === 'string' ? checkOut : null,
    content: { heroImage: null, images: [] },
    availability: {
      id: id('avail'),
      token: id('token'),
      correlationId: id('corr'),
      currencyrate: 1,
      groups: [
        { id: id('grp-1'), name: 'Deluxe Pool Access', type: 'DELUXE', beds: [{ type: 'KING', count: 1 }], rooms: [fullRoom] },
        { id: id('grp-2'), name: 'Garden Twin', type: 'STANDARD', beds: [{ type: 'TWIN', count: 2 }], rooms: [sparseRoom] },
      ],
    },
  };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Build the mock transport. A RouteStackFetch by construction → drops into the orchestrator's
 * injectable seam exactly where the live transport would.
 *
 * `appOrigin` is the base URL the deep-link payment URL points at (the in-app /booking-demo page);
 * the route derives it from the request origin.
 *
 * `targetHotelName` is the chosen hotel's name. The live `search-hotels` call carries NO hotel name
 * (it's destination-level — the orchestrator matches by name within the result), so the mock can't
 * learn the target from the request body. The route (which HAS body.hotelName) bakes it in here so
 * the mock's search-hotels returns a list whose entry NAME matches what matchHotelByName looks for.
 * When omitted (e.g. preview seeding, which lists a destination's inventory rather than one hotel),
 * the mock returns a small generic destination inventory instead. */
export function createMockRouteStackFetch(appOrigin: string, targetHotelName?: string): RouteStackFetch {
  return async (path, body) => {
    const b = asBody(body);

    switch (path) {
      case '/mcp/auth/partner-token':
        // Opaque, syntactically-valid token; never sent anywhere real.
        return { success: true, token: 'mock-jwt.partner.token' };

      case '/mcp/hotel/search-destinations': {
        const query = typeof b.query === 'string' ? b.query : '';
        const dest = matchDestination(query);
        const coords = DEST_COORDS[dest] ?? { lat: 0, long: 0, country: '' };
        return {
          success: true,
          // search-destinations result is the candidate array directly (pickDestination reads result[]).
          result: [
            {
              id: `mock-dest-${dest.toLowerCase()}`,
              fullName: dest,
              country: coords.country,
              type: 'DESTINATION',
              coordinates: { lat: coords.lat, long: coords.long },
            },
          ],
        };
      }

      case '/mcp/hotel/search-hotels': {
        // The orchestrator matches the chosen hotel by NAME within result.result[]. We return the
        // target hotel (baked in by the route) so the match is exact + thread the session handles.
        if (wants(targetHotelName, NOAVAIL)) {
          return { success: false, code: 204, message: 'No availability for those dates', result: null };
        }
        const seedName = targetHotelName ?? 'Mock Resort';
        const corr = `mock-corr-${hash(seedName) % 100000}`;
        const token = `mock-session-${hash(seedName) % 100000}`;
        // A few extra named hotels alongside the target → the result reads like a real inventory.
        const inventory = (targetHotelName ? [targetHotelName] : []).concat(['Mock Bayview Resort', 'Mock Garden Hotel']);
        return {
          success: true,
          result: {
            correlationId: corr,
            token,
            result: inventory.map((name) => ({
              id: `mock-hotel-${hash(name) % 100000}`,
              name,
              starRating: 5,
              ourprice: 120 + (hash(name) % 260),
              currency: typeof b.currency === 'string' ? b.currency : 'USD',
            })),
          },
        };
      }

      case '/mcp/hotel/get-hotel-details-and-rates': {
        // hotelName IS on this body (match.name); fall back to the baked-in target for the magic tokens.
        const hotelName = firstString(b.hotelName, targetHotelName, '') ?? '';
        const hotelId = firstString(b.hotelId, '') ?? '';
        if (wants(hotelName, NOAVAIL)) {
          return { success: false, code: 204, message: 'No rooms available', result: null };
        }
        return { success: true, result: buildRates(hotelId, hotelName, b.checkIn, b.checkOut) };
      }

      case '/mcp/hotel/revalidate': {
        // revalidate's live body carries NO hotelName ({ hotelId, recommendationId, token, correlationId }),
        // so the __EXPIRED__ magic token is read from the baked-in target name (the route always has it).
        if (wants(firstString(b.hotelName, targetHotelName), EXPIRED)) {
          return { success: false, code: 5148, message: 'The offer you were viewing has expired', result: null };
        }
        return { success: true, result: { rate: [{ providerName: 'MockSupplier' }] } };
      }

      case '/mcp/hotel/get-payment-url': {
        const params = new URLSearchParams({
          session: firstString(b.correlationId, 'mock-session') ?? 'mock-session',
          hotel: firstString(b.hotelName, 'Hotel') ?? 'Hotel',
          checkIn: firstString(b.checkIn, '') ?? '',
          checkOut: firstString(b.checkOut, '') ?? '',
          recommendationId: firstString(b.recommendationId, '') ?? '',
          roomId: firstString(b.roomId, '') ?? '',
        });
        // The deep link points at the IN-APP mock checkout page, not an external RouteStack URL.
        return { success: true, url: `${appOrigin.replace(/\/$/, '')}/booking-demo?${params.toString()}` };
      }

      default:
        // Any unexpected path → a benign success envelope (never throws → never dead-ends a demo).
        return { success: true, result: {} };
    }
  };
}

function firstString(...vals: unknown[]): string | undefined {
  for (const v of vals) if (typeof v === 'string' && v) return v;
  return undefined;
}

function wants(name: string | undefined, token: string): boolean {
  return typeof name === 'string' && name.includes(token);
}

/** Map a free-text destination query to one of the supported destinations (substring match);
 * default to the first supported destination so the demo never dead-ends on an odd query. */
function matchDestination(query: string): string {
  const q = query.trim().toLowerCase();
  for (const d of DESTINATIONS) {
    if (q.includes(d.toLowerCase()) || d.toLowerCase().includes(q)) return d;
  }
  return DESTINATIONS[0];
}
