/* Mock RouteStack transport (specs/10e-booking-mock.md).
 *
 * Drives the REAL orchestrator (searchAndRates → selectAndPaymentUrl) through the demo mock
 * transport — proving the mock returns real-shaped envelope JSON that the production code maps
 * to valid RoomsAndRates + a /booking-demo deep link, plus the magic-token warm-fallback paths.
 * Key-free: dummy creds let getPartnerToken build its HMAC; the mock fetch never hits the network. */
import { searchAndRates, selectAndPaymentUrl } from '@/lib/booking/routestack';
import { createMockRouteStackFetch, routeStackMockEnabled } from '@/lib/booking/mock-transport';
import { _clearTokenCache } from '@/lib/booking/auth';
import { BookingError } from '@/lib/booking/types';

// Dummy creds (getPartnerToken reads them before the mock fetch — needed for key-free CI).
const ENV = { ROUTESTACK_API_KEY: 'rs_test_key', ROUTESTACK_API_SECRET: 'shhh', ROUTESTACK_API_URL: 'https://evolvemcp.routestack.ai' };
const savedEnv = { ...process.env };
beforeEach(() => {
  Object.assign(process.env, ENV);
  _clearTokenCache();
});
afterEach(() => {
  process.env = { ...savedEnv };
  _clearTokenCache();
});

const ORIGIN = 'https://hotel-zippo.vercel.app';
const INPUT = {
  hotelId: 'our-uuid-1',
  hotelName: 'The Family Beach Resort',
  destination: 'Phuket',
  party: { adults: 2, children: 1, childAges: [7], rooms: 1 },
  dates: { checkIn: '2026-08-01', checkOut: '2026-08-04' },
};

describe('routeStackMockEnabled', () => {
  it('is true only when ROUTESTACK_MOCK=1', () => {
    process.env.ROUTESTACK_MOCK = '1';
    expect(routeStackMockEnabled()).toBe(true);
    process.env.ROUTESTACK_MOCK = '0';
    expect(routeStackMockEnabled()).toBe(false);
    delete process.env.ROUTESTACK_MOCK;
    expect(routeStackMockEnabled()).toBe(false);
  });
});

describe('createMockRouteStackFetch — full happy path through the real orchestrator', () => {
  it('searchAndRates returns mapped room options + session handles', async () => {
    const fetchImpl = createMockRouteStackFetch(ORIGIN, INPUT.hotelName);
    const result = await searchAndRates(INPUT, { fetchImpl, mock: true });

    expect(result.hotelName).toBe(INPUT.hotelName);
    expect(result.correlationId).toMatch(/^mock-corr-/);
    expect(result.token).toMatch(/^mock-session-/);
    // The real mapper produced ≥2 options from the mock's availability.groups[].rooms[].
    expect(result.options.length).toBeGreaterThanOrEqual(2);

    // The fully-described room carries its fields; the sparse one omits them gracefully.
    const full = result.options.find((o) => o.roomName === 'Deluxe Pool Access');
    const sparse = result.options.find((o) => o.roomName === 'Garden Twin');
    expect(full).toBeDefined();
    expect(full?.price).toBeGreaterThan(0);
    expect(full?.board).toBe('Breakfast included');
    expect(full?.bed).toBe('KING');
    expect(full?.freeCancellation).toBe(true);
    expect(sparse).toBeDefined();
    // sparse room: only ids + name + a stamped currency; no board/bed/price.
    expect(sparse?.board).toBeUndefined();
    expect(sparse?.bed).toBeUndefined();
    // Every option gets a currency (stamped from the request when the rate node lacks one).
    expect(result.options.every((o) => !!o.currency)).toBe(true);
  });

  it('pricing is deterministic per hotel and scales with stay length', async () => {
    const a = await searchAndRates(INPUT, { fetchImpl: createMockRouteStackFetch(ORIGIN, INPUT.hotelName), mock: true });
    const b = await searchAndRates(INPUT, { fetchImpl: createMockRouteStackFetch(ORIGIN, INPUT.hotelName), mock: true });
    expect(priceOf(a)).toBe(priceOf(b)); // same input → same price

    const longer = { ...INPUT, dates: { checkIn: '2026-08-01', checkOut: '2026-08-08' } };
    const c = await searchAndRates(longer, { fetchImpl: createMockRouteStackFetch(ORIGIN, longer.hotelName), mock: true });
    expect(priceOf(c)).toBeGreaterThan(priceOf(a)); // 7 nights > 3 nights
  });

  it('selectAndPaymentUrl returns an in-app /booking-demo deep link', async () => {
    const rates = await searchAndRates(INPUT, { fetchImpl: createMockRouteStackFetch(ORIGIN, INPUT.hotelName), mock: true });
    const chosen = rates.options[0];
    const handoff = await selectAndPaymentUrl(
      {
        hotelId: rates.hotelId,
        hotelName: rates.hotelName,
        correlationId: rates.correlationId,
        token: rates.token,
        recommendationId: chosen.recommendationId,
        roomId: chosen.roomId,
        dates: INPUT.dates,
      },
      { fetchImpl: createMockRouteStackFetch(ORIGIN, INPUT.hotelName), mock: true },
    );
    expect(handoff.bookingUrl.startsWith(`${ORIGIN}/booking-demo?`)).toBe(true);
    const url = new URL(handoff.bookingUrl);
    expect(url.searchParams.get('hotel')).toBe(INPUT.hotelName);
    expect(url.searchParams.get('checkIn')).toBe(INPUT.dates.checkIn);
  });
});

describe('magic-token demo controls map to warm BookingError kinds', () => {
  it('__NOAVAIL__ → no-availability', async () => {
    const input = { ...INPUT, hotelName: 'Sold Out Resort __NOAVAIL__' };
    const fetchImpl = createMockRouteStackFetch(ORIGIN, input.hotelName);
    await expect(searchAndRates(input, { fetchImpl, mock: true })).rejects.toMatchObject({
      kind: 'no-availability',
    } as Partial<BookingError>);
  });

  it('__EXPIRED__ → offer-expired at revalidate', async () => {
    const input = { ...INPUT, hotelName: 'Gone Resort __EXPIRED__' };
    // search/rates still succeed; the failure surfaces at revalidate in phase 2.
    const rates = await searchAndRates(input, { fetchImpl: createMockRouteStackFetch(ORIGIN, input.hotelName), mock: true });
    const chosen = rates.options[0];
    await expect(
      selectAndPaymentUrl(
        {
          hotelId: rates.hotelId,
          hotelName: input.hotelName,
          correlationId: rates.correlationId,
          token: rates.token,
          recommendationId: chosen.recommendationId,
          roomId: chosen.roomId,
          dates: input.dates,
        },
        { fetchImpl: createMockRouteStackFetch(ORIGIN, input.hotelName), mock: true },
      ),
    ).rejects.toMatchObject({ kind: 'offer-expired' } as Partial<BookingError>);
  });
});

function priceOf(r: { options: Array<{ roomName?: string; price?: number }> }): number {
  return r.options.find((o) => o.roomName === 'Deluxe Pool Access')?.price ?? 0;
}
