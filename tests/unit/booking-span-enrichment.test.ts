/**
 * @jest-environment node
 *
 * Result-shaped span attributes on the booking path (specs/14): each routestack.search_hotels
 * span records how many hotels the page returned (hz.result_count), which page it was (hz.page)
 * and whether another page exists (hz.next_key_present); the enclosing booking.* span rolls up
 * hz.pages_scanned / hz.matched (+ hz.pagination_stalled when the stall guard fires) — so a slow
 * or stalled pagination walk is diagnosable from Dash0 alone. Key-free + network-free.
 */
jest.mock('server-only', () => ({}));

import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
  type ReadableSpan,
} from '@opentelemetry/sdk-trace-base';
import { trace, context } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { withSpan, HZ } from '@/lib/otel/trace';
import { searchAndRates, type SearchAndRatesInput } from '@/lib/booking/routestack';
import { _clearTokenCache } from '@/lib/booking/auth';
import { makeMockFetch, FIXED_NOW, FIXED_NONCE } from '@/tests/fixtures/routestack';

const ENV = { ROUTESTACK_API_KEY: 'rs_test_key', ROUTESTACK_API_SECRET: 'shhh', ROUTESTACK_API_URL: 'https://evolvemcp.routestack.ai' };

const INPUT: SearchAndRatesInput = {
  hotelId: 'local-uuid',
  hotelName: 'The Family Beach Resort',
  destination: 'Phuket',
  party: { adults: 2, childAges: [2, 7], rooms: 2 },
  dates: { checkIn: '2026-07-01', checkOut: '2026-07-05' },
};

const exporter = new InMemorySpanExporter();
let provider: BasicTracerProvider;
let ctxManager: AsyncLocalStorageContextManager;

beforeAll(() => {
  ctxManager = new AsyncLocalStorageContextManager();
  ctxManager.enable();
  context.setGlobalContextManager(ctxManager);
  provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
  trace.setGlobalTracerProvider(provider);
});
afterAll(async () => {
  await provider.shutdown();
  context.disable();
  trace.disable();
});

const saved = { ...process.env };
beforeEach(() => {
  Object.assign(process.env, ENV);
  _clearTokenCache();
  exporter.reset();
});
afterEach(() => {
  process.env = { ...saved };
  _clearTokenCache();
});

const byName = (name: string): ReadableSpan[] =>
  exporter.getFinishedSpans().filter((s) => s.name === name);

it('search_hotels spans carry result_count / page / next_key_present; booking span rolls up the walk', async () => {
  const { fetchImpl } = makeMockFetch();
  await withSpan('booking.rates', {}, async () => {
    await searchAndRates(INPUT, { fetchImpl, now: FIXED_NOW, nonce: FIXED_NONCE });
  });
  await provider.forceFlush();

  const searches = byName('routestack.search_hotels');
  expect(searches).toHaveLength(1); // fixture inventory has the hotel on page 1
  expect(searches[0].attributes[HZ.page]).toBe(1);
  expect(typeof searches[0].attributes[HZ.resultCount]).toBe('number');
  expect(searches[0].attributes[HZ.resultCount] as number).toBeGreaterThan(0);
  expect(searches[0].attributes[HZ.nextKeyPresent]).toBe(false);

  const rates = byName('routestack.get_hotel_details_and_rates');
  expect(rates).toHaveLength(1);
  expect(rates[0].attributes[HZ.resultCount] as number).toBeGreaterThan(0); // bookable room options

  const booking = byName('booking.rates');
  expect(booking).toHaveLength(1);
  expect(booking[0].attributes[HZ.pagesScanned]).toBe(1);
  expect(booking[0].attributes[HZ.matched]).toBe(true);
  expect(booking[0].attributes[HZ.paginationStalled]).toBeUndefined();
});

it('a stalled pagination walk marks the booking span + records each page honestly', async () => {
  const base = makeMockFetch();
  let searchCalls = 0;
  const fetchImpl: typeof base.fetchImpl = async (path, body, headers) => {
    if (path === '/mcp/hotel/search-hotels') {
      searchCalls++;
      return {
        success: true,
        result: {
          correlationId: 'corr-fixture-123',
          token: 'listing-token-abc',
          nextResultsKey: 'page-2', // repeated key — server ignored the request-side field
          result: [{ id: `H-${searchCalls}`, name: `Filler Hotel ${searchCalls}` }],
        },
      };
    }
    return base.fetchImpl(path, body, headers);
  };
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  await withSpan('booking.rates', {}, async () => {
    await expect(searchAndRates(INPUT, { fetchImpl, now: FIXED_NOW, nonce: FIXED_NONCE })).rejects.toMatchObject({
      kind: 'not-found',
    });
  }).catch(() => {}); // withSpan rethrows nothing here — the inner expect swallowed the rejection
  await provider.forceFlush();
  warn.mockRestore();

  const searches = byName('routestack.search_hotels');
  expect(searches).toHaveLength(2); // page 1 + one identical follow-up, then the guard stopped
  expect(searches.map((s) => s.attributes[HZ.page])).toEqual([1, 2]);
  expect(searches.every((s) => s.attributes[HZ.nextKeyPresent] === true)).toBe(true);

  const booking = byName('booking.rates');
  expect(booking).toHaveLength(1);
  expect(booking[0].attributes[HZ.pagesScanned]).toBe(2);
  expect(booking[0].attributes[HZ.matched]).toBe(false);
  expect(booking[0].attributes[HZ.paginationStalled]).toBe(true);
});
