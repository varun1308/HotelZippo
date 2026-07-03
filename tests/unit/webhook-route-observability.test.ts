/**
 * @jest-environment node
 *
 * POST /api/webhooks/routestack — persistence-failure observability (specs/14 "never lose
 * data silently"). The route deliberately ACKS with 200 even when correlate/persist fails
 * (so RouteStack doesn't retry forever), but the webhook.routestack span must record the
 * exception + an ERROR status so a dropped confirmed-booking record is loud in Dash0 —
 * withSpan preserves the call-site status instead of clobbering it with OK (L6).
 */
jest.mock('server-only', () => ({}));

import { trace, context, SpanStatusCode } from '@opentelemetry/api';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
  type ReadableSpan,
} from '@opentelemetry/sdk-trace-base';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { HZ } from '@/lib/otel/trace';

jest.mock('@/lib/db/server', () => ({ createServiceClient: () => ({}) }));

const mockCorrelateOrder = jest.fn();
const mockRecordWebhookEvent = jest.fn();
jest.mock('@/lib/booking/webhook', () => ({
  ...jest.requireActual('@/lib/booking/webhook'),
  correlateOrder: (...a: unknown[]) => mockCorrelateOrder(...a),
  recordWebhookEvent: (...a: unknown[]) => mockRecordWebhookEvent(...a),
}));

const { POST } = require('@/app/api/webhooks/routestack/route');

const exporter = new InMemorySpanExporter();

beforeAll(() => {
  context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
  const provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
  trace.setGlobalTracerProvider(provider);
  // Configured secret → the route authenticates via header (no dev-mode warn noise).
  process.env.ROUTESTACK_WEBHOOK_SECRET = 's3cr3t';
});

afterAll(() => {
  delete process.env.ROUTESTACK_WEBHOOK_SECRET;
});

beforeEach(() => {
  exporter.reset();
  mockCorrelateOrder.mockReset();
  mockRecordWebhookEvent.mockReset();
});

function webhookSpan(): ReadableSpan {
  const span = exporter.getFinishedSpans().find((s) => s.name === 'webhook.routestack');
  if (!span) throw new Error('no finished webhook.routestack span');
  return span;
}

function req() {
  return new Request('http://localhost/api/webhooks/routestack', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-webhook-key': 's3cr3t' },
    body: JSON.stringify({
      event: 'BOOKING_SUCCESS',
      orderid: 'RSA-1234567890',
      orderstatus: 'CONFIRMED',
      billing_email: 'raj@example.com',
      module: 'HOTEL',
    }),
  });
}

describe('webhook persistence failure (M5)', () => {
  it('still ACKS 200 but marks the span ERROR with the exception recorded', async () => {
    mockCorrelateOrder.mockRejectedValue(new Error('db unreachable'));
    const res = await POST(req());
    expect(res.status).toBe(200); // deliberate ack — RouteStack must not retry forever
    expect(await res.json()).toEqual({ ok: true, persisted: false });

    const span = webhookSpan();
    expect(span.status.code).toBe(SpanStatusCode.ERROR); // not clobbered by withSpan's OK default
    expect(span.status.message).toBe('persist_failed');
    expect(span.attributes[HZ.outcome]).toBe('persist_failed');
    const exception = span.events.find((e) => e.name === 'exception');
    expect(exception?.attributes?.['exception.message']).toBe('db unreachable');
  });

  it('a persisted event stays OK with the matched outcome', async () => {
    mockCorrelateOrder.mockResolvedValue({ bookingOrderId: 'o1', matched: true });
    mockRecordWebhookEvent.mockResolvedValue(undefined);
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, matched: true });

    const span = webhookSpan();
    expect(span.status.code).toBe(SpanStatusCode.OK);
    expect(span.attributes[HZ.outcome]).toBe('matched');
    expect(span.attributes[HZ.webhookMatched]).toBe(true);
    expect(span.attributes[HZ.webhookEvent]).toBe('BOOKING_SUCCESS');
  });
});
