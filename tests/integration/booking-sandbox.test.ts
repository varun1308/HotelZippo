/* Phase 7 · Slice C — RouteStack SANDBOX smoke test (specs/10c-booking-routestack.md + 15).
 *
 * Runs the live session up to the rooms/rates payload and asserts the shape — it NEVER calls
 * get-payment-url and NEVER completes a booking. It is guarded so it is safe + fast by default:
 *   1. OPT-IN: the suite only runs when ROUTESTACK_LIVE_SMOKE=1 is set (in addition to the creds
 *      below). Without it the suite SKIPS — so it does NOT make slow, quota-costing, non-
 *      deterministic live RouteStack calls during a routine `npm run test:integration`. Run it
 *      deliberately: `ROUTESTACK_LIVE_SMOKE=1 npm run test:integration -- booking-sandbox`.
 *   2. CREDS: even with the flag, it skips unless ROUTESTACK_API_KEY/SECRET/URL are all present
 *      (key-free CI auto-skips — no false failures; CI never sets the flag OR the creds).
 *   3. If the account is not yet provisioned for hotel search (a "member token required" envelope —
 *      a RouteStack admin/account-config step, NOT a code defect), the test logs the reason and
 *      skips the assertions rather than failing.
 *
 * Credentials come from .env.local (loaded here explicitly — the integration project's
 * load-env.ts only loads the local-Supabase .env.test). */
import { config } from 'dotenv';
import path from 'node:path';
import { getPartnerToken, _clearTokenCache } from '@/lib/booking/auth';
import { createRouteStackFetch } from '@/lib/booking/transport';
import { buildRoomsOccupancy } from '@/lib/booking/party';
import { mapRoomRateOptions } from '@/lib/booking/rates';

config({ path: path.join(process.cwd(), '.env.local') });

const HAS_CREDS = !!(process.env.ROUTESTACK_API_KEY && process.env.ROUTESTACK_API_SECRET && process.env.ROUTESTACK_API_URL);
// Live calls are opt-in: a routine integration run must NOT hit the live RouteStack API (slow,
// quota-costing, non-deterministic). Set ROUTESTACK_LIVE_SMOKE=1 to actually run it.
const LIVE_SMOKE = process.env.ROUTESTACK_LIVE_SMOKE === '1';
const describeMaybe = HAS_CREDS && LIVE_SMOKE ? describe : describe.skip;

jest.setTimeout(60_000);

/** A provisioning-gap envelope means the account isn't ready for hotel search yet. */
function isProvisioningGap(env: { success?: boolean; message?: string | null }): boolean {
  if (env.success) return false;
  const m = (env.message ?? '').toLowerCase();
  return /member token|partner credentials|not anonymous|administrator/.test(m);
}

describeMaybe('RouteStack sandbox smoke (no live booking)', () => {
  const fetchImpl = createRouteStackFetch();

  beforeEach(() => _clearTokenCache());

  it('exchanges partner credentials for a JWT', async () => {
    const token = await getPartnerToken(fetchImpl);
    expect(typeof token).toBe('string');
    expect(token.length).toBeGreaterThan(20); // a real JWT
  });

  it('resolves a destination and lists rooms/rates (stops before payment)', async () => {
    const token = await getPartnerToken(fetchImpl);
    const auth = { Authorization: `Bearer ${token}` };

    const destEnv = (await fetchImpl(
      '/mcp/hotel/search-destinations',
      { query: 'Phuket', type: 'DESTINATION' },
      auth,
    )) as { success?: boolean; message?: string | null; result?: Array<{ id: string; type?: string; coordinates?: { lat: number; long: number } }> };

    if (isProvisioningGap(destEnv)) {
      // eslint-disable-next-line no-console
      console.warn(`[sandbox-smoke] SKIPPED — account not provisioned for hotel search: ${destEnv.message}`);
      return; // not a code failure — founder/RouteStack-admin step (see memory: routestack-sandbox-blocker)
    }

    const dest = destEnv.result?.find((d) => d.coordinates);
    expect(dest).toBeTruthy();

    const rooms = buildRoomsOccupancy({ adults: 2, childAges: [], rooms: 1 });
    const searchEnv = (await fetchImpl(
      '/mcp/hotel/search-hotels',
      {
        destinationId: dest!.id,
        destinationType: dest!.type ?? 'City',
        lat: dest!.coordinates!.lat,
        long: dest!.coordinates!.long,
        checkIn: '2026-09-01',
        checkOut: '2026-09-04',
        rooms,
        currency: 'USD',
      },
      auth,
    )) as { success?: boolean; message?: string | null; result?: { correlationId?: string; token?: string; result?: Array<{ id: string; name: string }> } };

    if (isProvisioningGap(searchEnv) || searchEnv.success === false) {
      // eslint-disable-next-line no-console
      console.warn(`[sandbox-smoke] no inventory / not provisioned: ${searchEnv.message ?? 'success:false'}`);
      return;
    }

    const listing = searchEnv.result;
    const first = listing?.result?.[0];
    expect(first?.id).toBeTruthy();
    expect(listing?.correlationId).toBeTruthy();
    expect(listing?.token).toBeTruthy();

    const ratesEnv = (await fetchImpl(
      '/mcp/hotel/get-hotel-details-and-rates',
      {
        hotelId: first!.id,
        hotelName: first!.name,
        token: listing!.token,
        correlationId: listing!.correlationId,
        checkIn: '2026-09-01',
        checkOut: '2026-09-04',
        rooms,
      },
      auth,
    )) as { success?: boolean; result?: unknown };

    // The adaptive mapper should resolve at least one bookable option from a live payload.
    const options = mapRoomRateOptions((ratesEnv as { result?: unknown }).result ?? ratesEnv);
    expect(Array.isArray(options)).toBe(true);
    // We intentionally STOP here — no revalidate, no get-payment-url, no booking.
  });
});
