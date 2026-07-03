/**
 * @jest-environment node
 *
 * Conversation correlation on the booking routes (specs/14 "Conversation correlation").
 *
 * POST /api/booking/rates and /api/booking/payment-url bind the client-minted conversationId
 * (validated) + the signed-in userId into OTEL baggage via withCorrelation, so the
 * booking.rates / booking.payment_url root spans AND every routestack.* child span carry
 * hz.conversation_id + hz.user_id — the chat→booking handoff stays one Dash0 view.
 *
 * Key-free + network-free: the RouteStack orchestrator is mocked to a stub that opens a REAL
 * child span through withSpan, proving the baggage actually reaches child spans.
 */
jest.mock('server-only', () => ({}));

import { trace, context } from '@opentelemetry/api';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
  type ReadableSpan,
} from '@opentelemetry/sdk-trace-base';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { withSpan, HZ } from '@/lib/otel/trace';

// Request-scope + auth seams (same shape as route-auth-gates.test.ts): a signed-in user.
jest.mock('next/headers', () => ({
  cookies: async () => ({ getAll: () => [] }),
}));
jest.mock('@/lib/db/ssr', () => ({
  createSupabaseServerClient: () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'user-9', email: 'raj@example.com' } } }) },
  }),
}));
jest.mock('@/lib/db/server', () => ({ createServiceClient: () => ({}) }));

// The RouteStack side: transports/caches/geocode are inert; the orchestrator stubs below
// open a real child span so correlation inheritance is what's actually under test.
jest.mock('@/lib/booking/transport', () => ({ createRouteStackFetch: () => async () => ({}) }));
jest.mock('@/lib/booking/id-cache', () => ({ makeSupabaseIdCache: () => undefined }));
jest.mock('@/lib/booking/payload-log', () => ({
  payloadLoggingEnabled: () => false,
  makeSupabasePayloadLog: () => undefined,
}));
jest.mock('@/lib/curation/google-places', () => ({ resolveCityLocation: async () => null }));
jest.mock('@/lib/booking/webhook', () => ({ recordPendingOrder: jest.fn(async () => {}) }));

const mockSearchAndRates = jest.fn();
const mockSelectAndPaymentUrl = jest.fn();
jest.mock('@/lib/booking/routestack', () => ({
  searchAndRates: (...a: unknown[]) => mockSearchAndRates(...a),
  selectAndPaymentUrl: (...a: unknown[]) => mockSelectAndPaymentUrl(...a),
}));

const { POST: ratesPOST } = require('@/app/api/booking/rates/route');
const { POST: paymentUrlPOST } = require('@/app/api/booking/payment-url/route');

const exporter = new InMemorySpanExporter();

beforeAll(() => {
  context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
  const provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
  trace.setGlobalTracerProvider(provider);
});

beforeEach(() => {
  exporter.reset();
  mockSearchAndRates.mockImplementation(() =>
    withSpan('routestack.search_hotels', {}, async () => ({
      hotelId: 'H-1',
      hotelName: 'The Family Beach Resort',
      correlationId: 'corr-1',
      token: 'tok-1',
      options: [],
    })),
  );
  mockSelectAndPaymentUrl.mockImplementation(() =>
    withSpan('routestack.get_payment_url', {}, async () => ({ bookingUrl: 'https://checkout.example/x' })),
  );
});

function byName(name: string): ReadableSpan {
  const span = exporter.getFinishedSpans().find((s) => s.name === name);
  if (!span) throw new Error(`no finished span named ${name}`);
  return span;
}

const CONV = '3744958a-29ac-41ff-958a-dee431a77b48';

function ratesReq(conversationId?: unknown) {
  return new Request('http://localhost/api/booking/rates', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      hotelId: 'H-1',
      hotelName: 'The Family Beach Resort',
      destination: 'Phuket',
      party: { adults: 2, childAges: [4, 7], rooms: 1 },
      dates: { checkIn: '2026-07-10', checkOut: '2026-07-14' },
      ...(conversationId !== undefined ? { conversationId } : {}),
    }),
  });
}

function paymentUrlReq(conversationId?: unknown) {
  return new Request('http://localhost/api/booking/payment-url', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      hotelId: 'H-1',
      hotelName: 'The Family Beach Resort',
      correlationId: 'corr-1',
      token: 'tok-1',
      recommendationId: 'reco-A',
      roomId: 'room-A',
      dates: { checkIn: '2026-07-10', checkOut: '2026-07-14' },
      destination: 'Phuket',
      currency: 'USD',
      ...(conversationId !== undefined ? { conversationId } : {}),
    }),
  });
}

describe('POST /api/booking/rates correlation (M4)', () => {
  it('stamps hz.conversation_id + hz.user_id on the root span AND the routestack child span', async () => {
    const res = await ratesPOST(ratesReq(CONV));
    expect(res.status).toBe(200);
    const root = byName('booking.rates');
    expect(root.attributes[HZ.conversationId]).toBe(CONV);
    expect(root.attributes[HZ.userId]).toBe('user-9');
    const child = byName('routestack.search_hotels');
    expect(child.attributes[HZ.conversationId]).toBe(CONV);
    expect(child.attributes[HZ.userId]).toBe('user-9');
    // Same trace: the child nests under the request's root span.
    expect(child.spanContext().traceId).toBe(root.spanContext().traceId);
  });

  it('rejects a non-UUID conversationId (attribute never poisoned) but still books', async () => {
    const res = await ratesPOST(ratesReq('not-a-uuid; DROP TABLE'));
    expect(res.status).toBe(200);
    expect(byName('booking.rates').attributes[HZ.conversationId]).toBeUndefined();
  });

  it('books fine with no conversationId (older client), still stamping the user', async () => {
    const res = await ratesPOST(ratesReq());
    expect(res.status).toBe(200);
    const root = byName('booking.rates');
    expect(root.attributes[HZ.conversationId]).toBeUndefined();
    expect(root.attributes[HZ.userId]).toBe('user-9');
  });
});

describe('POST /api/booking/payment-url correlation (M4)', () => {
  it('stamps hz.conversation_id + hz.user_id on the root span AND the routestack child span', async () => {
    const res = await paymentUrlPOST(paymentUrlReq(CONV));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ bookingUrl: 'https://checkout.example/x' });
    const root = byName('booking.payment_url');
    expect(root.attributes[HZ.conversationId]).toBe(CONV);
    expect(root.attributes[HZ.userId]).toBe('user-9');
    const child = byName('routestack.get_payment_url');
    expect(child.attributes[HZ.conversationId]).toBe(CONV);
    expect(child.attributes[HZ.userId]).toBe('user-9');
  });

  it('rejects a non-UUID conversationId but still returns the deep link', async () => {
    const res = await paymentUrlPOST(paymentUrlReq(12345));
    expect(res.status).toBe(200);
    expect(byName('booking.payment_url').attributes[HZ.conversationId]).toBeUndefined();
  });
});
