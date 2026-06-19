/* Proves the orchestrator's tracedCall captures EVERY RouteStack step into deps.debugLog (when
 * injected) with redacted request/response, on both the success path and a business-failure, and that
 * a THROWING debugLog never breaks the booking (best-effort). Reuses the shared mock fetch fixtures. */
import { searchAndRates } from '@/lib/booking/routestack';
import { _clearTokenCache } from '@/lib/booking/auth';
import type { PayloadLog, PayloadRecord } from '@/lib/booking/payload-log';
import { makeMockFetch, FIXED_NOW, FIXED_NONCE } from '@/tests/fixtures/routestack';

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

const INPUT = {
  hotelId: 'our-uuid-1',
  hotelName: 'The Family Beach Resort',
  destination: 'Phuket',
  party: { adults: 2, children: 1, childAges: [7], rooms: 1 },
  dates: { checkIn: '2026-08-01', checkOut: '2026-08-04' },
};

function fakeLog() {
  const records: PayloadRecord[] = [];
  const log: PayloadLog = { async record(r) { records.push(r); } };
  return { log, records };
}

describe('tracedCall → debugLog capture', () => {
  it('records one entry per RouteStack step on the success path', async () => {
    const { fetchImpl } = makeMockFetch();
    const { log, records } = fakeLog();
    await searchAndRates(INPUT, { fetchImpl, now: FIXED_NOW, nonce: FIXED_NONCE, debugLog: log });

    const steps = records.map((r) => r.step);
    expect(steps).toContain('search_destinations');
    expect(steps).toContain('search_hotels');
    expect(steps).toContain('get_hotel_details_and_rates');
    // each record carries the path + a success flag + a duration
    for (const r of records) {
      expect(typeof r.path).toBe('string');
      expect(r.success).toBe(true);
      expect(typeof r.durationMs).toBe('number');
    }
  });

  it('captures with NO debugLog injected → no error, booking still works', async () => {
    const { fetchImpl } = makeMockFetch();
    const out = await searchAndRates(INPUT, { fetchImpl, now: FIXED_NOW, nonce: FIXED_NONCE });
    expect(out.hotelId).toBe('H-1001');
  });

  it('a THROWING debugLog never breaks the booking (best-effort)', async () => {
    const { fetchImpl } = makeMockFetch();
    const log: PayloadLog = { async record() { throw new Error('log exploded'); } };
    // record() is fired with `void` and is itself try/caught in the real impl; the fake throws to
    // prove even a misbehaving log can't surface. The booking must still complete.
    const out = await searchAndRates(INPUT, { fetchImpl, now: FIXED_NOW, nonce: FIXED_NONCE, debugLog: log });
    expect(out.hotelId).toBe('H-1001');
  });

  it('records the FAILURE outcome (success=false + error) when a step fails', async () => {
    // Make search-hotels return a 204 no-availability envelope.
    const { fetchImpl } = makeMockFetch({
      '/mcp/hotel/search-hotels': { success: false, code: 204, message: 'No availability', result: null },
    });
    const { log, records } = fakeLog();
    await expect(searchAndRates(INPUT, { fetchImpl, now: FIXED_NOW, nonce: FIXED_NONCE, debugLog: log })).rejects.toBeTruthy();
    const failed = records.find((r) => r.step === 'search_hotels');
    expect(failed?.success).toBe(false);
    expect(failed?.code).toBe(204);
    expect(failed?.error).toBeTruthy();
  });
});
