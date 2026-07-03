/**
 * @jest-environment node
 *
 * POST /api/booking/rates — error/edge branches (specs/10c + 10e + 14).
 *
 * The happy live path + correlation is covered by booking-route-correlation.test.ts; this
 * suite targets the RED branches: malformed body, missing/invalid booking details, the
 * anonymous 401, the E2E-stub seam (15a §1.1), the ROUTESTACK_MOCK seam (10e), the
 * BookingError → warm-JSON envelope mapping (kind/status/traceId — spec 14), the
 * best-effort service-client/cache fallback, and the warm-failing geocode wrapper.
 *
 * Key-free + network-free: Supabase SSR auth, the service client, and the RouteStack
 * orchestrator are all mocked; only the route's own branching is under test. Observable
 * behaviour only — status codes, BookingApiError shapes, and searchAndRates call args.
 */
jest.mock('server-only', () => ({}));

// Controllable auth seam (house pattern — route-auth-gates.test.ts).
let mockUser: { id: string } | null = { id: 'user-1' };
jest.mock('next/headers', () => ({
  cookies: async () => ({ getAll: () => [] }),
}));
jest.mock('@/lib/db/ssr', () => ({
  createSupabaseServerClient: () => ({
    auth: { getUser: async () => ({ data: { user: mockUser } }) },
  }),
}));

// Service client: controllable so the best-effort catch (cache = undefined) is reachable.
let mockServiceThrows = false;
jest.mock('@/lib/db/server', () => ({
  createServiceClient: () => {
    if (mockServiceThrows) throw new Error('service env missing');
    return {};
  },
}));

// Sentinels so we can assert exactly what the route wires into searchAndRates.
const mockCacheSentinel = { kind: 'id-cache' };
const mockDebugLogSentinel = { kind: 'payload-log' };
let mockPayloadLogging = false;
jest.mock('@/lib/booking/id-cache', () => ({
  makeSupabaseIdCache: () => mockCacheSentinel,
}));
jest.mock('@/lib/booking/payload-log', () => ({
  payloadLoggingEnabled: () => mockPayloadLogging,
  makeSupabasePayloadLog: () => mockDebugLogSentinel,
}));

// Live transport is inert; the geocode dependency is controllable (resolve vs throw).
jest.mock('@/lib/booking/transport', () => ({
  createRouteStackFetch: () => async () => ({}),
}));
const mockResolveCityLocation = jest.fn();
jest.mock('@/lib/curation/google-places', () => ({
  resolveCityLocation: (...a: unknown[]) => mockResolveCityLocation(...a),
}));

// The RouteStack orchestrator — the route's downstream. Mocked per-test.
const mockSearchAndRates = jest.fn();
jest.mock('@/lib/booking/routestack', () => ({
  searchAndRates: (...a: unknown[]) => mockSearchAndRates(...a),
}));

import { BookingError } from '@/lib/booking/types';

/* eslint-disable @typescript-eslint/no-var-requires */
const { POST } = require('@/app/api/booking/rates/route');

const OK_RESULT = {
  hotelId: 'H-1',
  hotelName: 'The Family Beach Resort',
  correlationId: 'corr-1',
  token: 'tok-1',
  options: [{ recommendationId: 'reco-A', roomId: 'room-A' }],
};

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    hotelId: 'H-1',
    hotelName: 'The Family Beach Resort',
    destination: 'Phuket',
    party: { adults: 2, childAges: [4, 7], rooms: 1 },
    dates: { checkIn: '2026-07-10', checkOut: '2026-07-14' },
    ...overrides,
  };
}

function req(body: unknown) {
  return new Request('http://localhost/api/booking/rates', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

const ENV_KEYS = ['NEXT_PUBLIC_E2E', 'ROUTESTACK_MOCK'] as const;
const savedEnv: Record<string, string | undefined> = {};
beforeAll(() => {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
});
beforeEach(() => {
  mockUser = { id: 'user-1' };
  mockServiceThrows = false;
  mockPayloadLogging = false;
  mockSearchAndRates.mockReset();
  mockResolveCityLocation.mockReset();
  for (const k of ENV_KEYS) delete process.env[k];
});
afterAll(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

describe('request validation (400 transport errors)', () => {
  it('400s a malformed JSON body with the standard error shape', async () => {
    const res = await POST(req('{not json'));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'transport', message: 'Invalid request' });
    expect(mockSearchAndRates).not.toHaveBeenCalled();
  });

  it('400s when required booking details are missing (hotelName)', async () => {
    const res = await POST(req(validBody({ hotelName: undefined })));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'transport', message: 'Missing booking details' });
  });

  it('400s when the dates are incomplete (no checkOut)', async () => {
    const res = await POST(req(validBody({ dates: { checkIn: '2026-07-10' } })));
    expect(res.status).toBe(400);
    expect((await res.json()).message).toBe('Missing booking details');
  });

  it('400s an out-of-bounds party (adults: 0) with the validateParty message', async () => {
    const res = await POST(req(validBody({ party: { adults: 0, childAges: [], rooms: 1 } })));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('transport');
    expect(body.message).toMatch(/Adults must be between 1 and 8/);
    expect(mockSearchAndRates).not.toHaveBeenCalled();
  });

  it('400s rooms > adults (never silently collapses the room count)', async () => {
    const res = await POST(req(validBody({ party: { adults: 1, childAges: [], rooms: 3 } })));
    expect(res.status).toBe(400);
    expect((await res.json()).message).toMatch(/Each room needs at least one adult/);
  });
});

describe('auth gate', () => {
  it('401s an anonymous caller before any RouteStack work', async () => {
    mockUser = null;
    const res = await POST(req(validBody()));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'config', message: 'Please sign in to book.' });
    expect(mockSearchAndRates).not.toHaveBeenCalled();
  });
});

describe('E2E stub seam (NEXT_PUBLIC_E2E=1, specs/15a §1.1)', () => {
  it('serves the deterministic stub after the real auth gate, never touching RouteStack', async () => {
    process.env.NEXT_PUBLIC_E2E = '1';
    const res = await POST(req(validBody()));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.correlationId).toBe('e2e-correlation');
    expect(body.options[0].recommendationId).toBe('e2e-reco-1');
    expect(mockSearchAndRates).not.toHaveBeenCalled();
  });

  it('still 401s an anonymous caller when the E2E flag is set (auth is NOT stubbed)', async () => {
    process.env.NEXT_PUBLIC_E2E = '1';
    mockUser = null;
    const res = await POST(req(validBody()));
    expect(res.status).toBe(401);
  });

  it('returns the warm no-availability envelope for the __NOAVAIL__ magic token', async () => {
    process.env.NEXT_PUBLIC_E2E = '1';
    const res = await POST(req(validBody({ hotelName: 'Resort __NOAVAIL__' })));
    expect(res.status).toBe(200); // business outcome = warm 200 body
    expect((await res.json()).error).toBe('no-availability');
  });
});

describe('mock-transport seam (ROUTESTACK_MOCK=1, specs/10e)', () => {
  it('runs the full orchestrator with the mock transport (mock: true, real fetchImpl)', async () => {
    process.env.ROUTESTACK_MOCK = '1';
    mockSearchAndRates.mockResolvedValue(OK_RESULT);
    const res = await POST(req(validBody()));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(OK_RESULT);
    const [, opts] = mockSearchAndRates.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(opts.mock).toBe(true);
    expect(typeof opts.fetchImpl).toBe('function');
  });

  it('maps a BookingError on the mock path to the warm 200 envelope', async () => {
    process.env.ROUTESTACK_MOCK = '1';
    mockSearchAndRates.mockRejectedValue(
      new BookingError('no-availability', 'No rooms for those dates.', 204),
    );
    const res = await POST(req(validBody()));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      error: 'no-availability',
      message: 'No rooms for those dates.',
    });
  });
});

describe('live-path BookingError → BookingApiError mapping (spec 14)', () => {
  it('business outcomes (offer-expired) are 200 + warm body, carrying the traceId', async () => {
    const err = new BookingError('offer-expired', 'That rate just expired — let me refresh.', 5148);
    err.traceId = 'trace-abc';
    mockSearchAndRates.mockRejectedValue(err);
    const res = await POST(req(validBody()));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      error: 'offer-expired',
      message: 'That rate just expired — let me refresh.',
      traceId: 'trace-abc',
    });
  });

  it('config failures are a real 500', async () => {
    mockSearchAndRates.mockRejectedValue(new BookingError('config', 'RouteStack credentials missing'));
    const res = await POST(req(validBody()));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe('config');
  });

  it('a non-BookingError never leaks its message — generic warm unknown envelope', async () => {
    mockSearchAndRates.mockRejectedValue(new Error('ECONNRESET: internal stack detail'));
    const res = await POST(req(validBody()));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ error: 'unknown', message: 'Booking is unavailable right now.' });
    expect(JSON.stringify(body)).not.toContain('ECONNRESET');
  });
});

describe('live-path dependency wiring (cache / payload log / geocode)', () => {
  it('passes the id cache, a cleaned party (extra keys dropped), and no debugLog when the flag is off', async () => {
    mockSearchAndRates.mockResolvedValue(OK_RESULT);
    const res = await POST(
      req(validBody({ party: { adults: 2, childAges: [4, 7], rooms: 1, evil: 'x' } })),
    );
    expect(res.status).toBe(200);
    const [sentBody, opts] = mockSearchAndRates.mock.calls[0] as [
      Record<string, unknown>,
      Record<string, unknown>,
    ];
    expect(sentBody.party).toEqual({ adults: 2, childAges: [4, 7], rooms: 1 }); // normalised
    expect(opts.cache).toBe(mockCacheSentinel);
    expect(opts.debugLog).toBeUndefined();
  });

  it('passes the payload log when ROUTESTACK_DEBUG_PAYLOADS gating says so', async () => {
    mockPayloadLogging = true;
    mockSearchAndRates.mockResolvedValue(OK_RESULT);
    await POST(req(validBody()));
    const [, opts] = mockSearchAndRates.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(opts.debugLog).toBe(mockDebugLogSentinel);
  });

  it('books WITHOUT the cache when the service client cannot be built (best-effort)', async () => {
    mockServiceThrows = true;
    mockSearchAndRates.mockResolvedValue(OK_RESULT);
    const res = await POST(req(validBody()));
    expect(res.status).toBe(200);
    const [, opts] = mockSearchAndRates.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(opts.cache).toBeUndefined();
    expect(opts.debugLog).toBeUndefined();
  });

  it('geocode wrapper resolves the city and warm-fails to null on error', async () => {
    mockSearchAndRates.mockResolvedValue(OK_RESULT);
    await POST(req(validBody()));
    const [, opts] = mockSearchAndRates.mock.calls[0] as [
      unknown,
      { geocode: (q: string) => Promise<unknown> },
    ];
    expect(typeof opts.geocode).toBe('function');

    const loc = { lat: 7.88, long: 98.39 };
    mockResolveCityLocation.mockResolvedValueOnce(loc);
    await expect(opts.geocode('Phuket')).resolves.toBe(loc);
    expect(mockResolveCityLocation).toHaveBeenCalledWith('Phuket');

    mockResolveCityLocation.mockRejectedValueOnce(new Error('no GOOGLE_PLACES_API_KEY'));
    await expect(opts.geocode('Phuket')).resolves.toBeNull();
  });
});
