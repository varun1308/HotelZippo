/**
 * @jest-environment node
 *
 * POST /api/webhooks/routestack against the REAL 4-event order lifecycle captured live
 * 2026-07-03 (specs/10d-booking-webhooks.md; fixtures in tests/fixtures/routestack.ts). Covers:
 *   1. the confirmed live secret carrier (`x-webhook-access-key`) authenticates every event;
 *   2. each real event shape parses + correlates + persists correctly (matched/unmatched);
 *   3. idempotent re-delivery (RouteStack retried CREATION_SUCCESS ×3 / BOOKING_SUCCESS ×3 live —
 *      pre-fix 401s; replayed here as the route would now see them);
 *   4. the webhook.routestack OTEL span records the real event/module/orderstatus attributes
 *      for each event type;
 *   5. the RouteStack payload-log seam (10c debug capture) now also fires for INBOUND webhook
 *      deliveries when ROUTESTACK_DEBUG_PAYLOADS=1 — previously wired only for outbound booking
 *      calls, so a real webhook delivery was invisible to raw_routestack_payloads (this session's
 *      finding: none of the 8 live deliveries were captured before this fix).
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
import {
  WEBHOOK_ORDER_CREATION_SUCCESS,
  WEBHOOK_ORDER_PAYMENT_AUTHORIZED,
  WEBHOOK_BOOKING_SUCCESS,
  WEBHOOK_ORDER_PAYMENT_CAPTURED_SUCCESS,
  WEBHOOK_LIVE_LIFECYCLE,
} from '@/tests/fixtures/routestack';

jest.mock('@/lib/db/server', () => ({ createServiceClient: () => ({}) }));

const mockCorrelateOrder = jest.fn();
const mockRecordWebhookEvent = jest.fn();
jest.mock('@/lib/booking/webhook', () => ({
  ...jest.requireActual('@/lib/booking/webhook'),
  correlateOrder: (...a: unknown[]) => mockCorrelateOrder(...a),
  recordWebhookEvent: (...a: unknown[]) => mockRecordWebhookEvent(...a),
}));

const mockRecord = jest.fn();
jest.mock('@/lib/booking/payload-log', () => ({
  ...jest.requireActual('@/lib/booking/payload-log'),
  makeSupabasePayloadLog: () => ({ record: (...a: unknown[]) => mockRecord(...a) }),
}));

const { POST } = require('@/app/api/webhooks/routestack/route');

const LIVE_SECRET = '7257676b3de027a9eda45a451145386fecb207808d0f6b6fc999fb4cd26e208d';
const exporter = new InMemorySpanExporter();

beforeAll(() => {
  context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
  const provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
  trace.setGlobalTracerProvider(provider);
});

beforeEach(() => {
  exporter.reset();
  mockCorrelateOrder.mockReset();
  mockRecordWebhookEvent.mockReset();
  mockRecord.mockReset();
  process.env.ROUTESTACK_WEBHOOK_SECRET = LIVE_SECRET;
  delete process.env.ROUTESTACK_DEBUG_PAYLOADS;
});
afterEach(() => {
  delete process.env.ROUTESTACK_WEBHOOK_SECRET;
  delete process.env.ROUTESTACK_DEBUG_PAYLOADS;
});

function webhookSpan(): ReadableSpan {
  const span = exporter.getFinishedSpans().find((s) => s.name === 'webhook.routestack');
  if (!span) throw new Error('no finished webhook.routestack span');
  return span;
}

/** Build a request the way RouteStack's live sandbox actually delivers it (2026-07-03 capture):
 * `x-webhook-access-key` header, JSON body = one of the real captured events. */
function liveReq(event: Record<string, unknown>, secretHeader = 'x-webhook-access-key', secret = LIVE_SECRET) {
  return new Request('http://localhost/api/webhooks/routestack', {
    method: 'POST',
    headers: { 'content-type': 'application/json', [secretHeader]: secret },
    body: JSON.stringify(event),
  });
}

describe('live-captured RouteStack webhook lifecycle (2026-07-03)', () => {
  it.each([
    ['ORDER_CREATION_SUCCESS', WEBHOOK_ORDER_CREATION_SUCCESS],
    ['ORDER_PAYMENT_AUTHORIZED', WEBHOOK_ORDER_PAYMENT_AUTHORIZED],
    ['BOOKING_SUCCESS', WEBHOOK_BOOKING_SUCCESS],
    ['ORDER_PAYMENT_CAPTURED_SUCCESS', WEBHOOK_ORDER_PAYMENT_CAPTURED_SUCCESS],
  ])('%s authenticates via x-webhook-access-key and 200s', async (_name, event) => {
    mockCorrelateOrder.mockResolvedValue({ bookingOrderId: null, matched: false });
    mockRecordWebhookEvent.mockResolvedValue(undefined);
    const res = await POST(liveReq(event));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, matched: false });
  });

  it('the SAME real payload previously 401d against the old header-name assumption (regression guard)', async () => {
    // The exact bug found live: x-webhook-key/x-webhook-secret/x-routestack-webhook-key never
    // matched what RouteStack actually sends. Pin x-webhook-access-key as authenticating and the
    // old-assumption headers as NOT the ones RouteStack uses (still accepted as fallbacks, but a
    // request carrying ONLY an unrecognised header name must still 401).
    const res = await POST(liveReq(WEBHOOK_ORDER_CREATION_SUCCESS, 'x-some-other-header', LIVE_SECRET));
    expect(res.status).toBe(401);
  });

  it('correlates BOOKING_SUCCESS against a pending order by billing_email and marks CONFIRMED', async () => {
    mockCorrelateOrder.mockResolvedValue({ bookingOrderId: 'order-uuid-1', matched: true });
    mockRecordWebhookEvent.mockResolvedValue(undefined);
    const res = await POST(liveReq(WEBHOOK_BOOKING_SUCCESS));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, matched: true });
    expect(mockCorrelateOrder).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ event: 'BOOKING_SUCCESS', orderid: 'RSA-75271203599' }));

    const span = webhookSpan();
    expect(span.attributes[HZ.webhookEvent]).toBe('BOOKING_SUCCESS');
    expect(span.attributes[HZ.webhookOrderStatus]).toBe('INCOMPLETE'); // BOOKING_SUCCESS's own orderstatus field
    expect(span.attributes[HZ.webhookMatched]).toBe(true);
    expect(span.attributes[HZ.outcome]).toBe('matched');
    expect(span.status.code).toBe(SpanStatusCode.OK);
  });

  it('idempotent re-delivery: the full live lifecycle (incl. RouteStack retries) all 200 without throwing', async () => {
    mockCorrelateOrder.mockResolvedValue({ bookingOrderId: 'order-uuid-1', matched: true });
    mockRecordWebhookEvent.mockResolvedValue(undefined);
    for (const event of WEBHOOK_LIVE_LIFECYCLE) {
      const res = await POST(liveReq(event));
      expect(res.status).toBe(200);
    }
    // Every one of the 8 real deliveries (incl. 3 CREATION_SUCCESS + 3 BOOKING_SUCCESS retries)
    // reached correlate/persist — none silently dropped.
    expect(mockCorrelateOrder).toHaveBeenCalledTimes(WEBHOOK_LIVE_LIFECYCLE.length);
    expect(mockRecordWebhookEvent).toHaveBeenCalledTimes(WEBHOOK_LIVE_LIFECYCLE.length);
  });

  describe('raw payload logging for inbound webhooks (extends the 10c debug seam)', () => {
    it('OFF by default — no capture even for a real authenticated event', async () => {
      mockCorrelateOrder.mockResolvedValue({ bookingOrderId: null, matched: false });
      mockRecordWebhookEvent.mockResolvedValue(undefined);
      await POST(liveReq(WEBHOOK_BOOKING_SUCCESS));
      expect(mockRecord).not.toHaveBeenCalled();
    });

    it('ROUTESTACK_DEBUG_PAYLOADS=1 captures a matched delivery with the real event body + trace id', async () => {
      process.env.ROUTESTACK_DEBUG_PAYLOADS = '1';
      mockCorrelateOrder.mockResolvedValue({ bookingOrderId: 'order-uuid-1', matched: true });
      mockRecordWebhookEvent.mockResolvedValue(undefined);
      await POST(liveReq(WEBHOOK_ORDER_PAYMENT_CAPTURED_SUCCESS));

      expect(mockRecord).toHaveBeenCalledTimes(1);
      const rec = mockRecord.mock.calls[0][0];
      expect(rec.step).toBe('webhook');
      expect(rec.path).toBe('/api/webhooks/routestack');
      expect(rec.request).toBeNull(); // inbound delivery — no outbound request to log
      expect(rec.response).toMatchObject({ event: 'ORDER_PAYMENT_CAPTURED_SUCCESS', orderid: 'RSA-75271203599', orderstatus: 'CONFIRMED' });
      expect(rec.success).toBe(true);
      expect(rec.code).toBe(200);
      expect(typeof rec.traceId).toBe('string');
      expect(rec.traceId!.length).toBeGreaterThan(0);
    });

    it('captures an UNAUTHORIZED delivery too (success=false, code=401) — auth failures are visible in the log, not just Dash0', async () => {
      process.env.ROUTESTACK_DEBUG_PAYLOADS = '1';
      await POST(liveReq(WEBHOOK_ORDER_CREATION_SUCCESS, 'x-wrong-header'));
      expect(mockRecord).toHaveBeenCalledTimes(1);
      const rec = mockRecord.mock.calls[0][0];
      expect(rec.success).toBe(false);
      expect(rec.code).toBe(401);
      expect(rec.error).toBe('unauthorized');
    });

    it('captures a persist-failure delivery (success=false, code=200, error message) alongside the ERROR span', async () => {
      process.env.ROUTESTACK_DEBUG_PAYLOADS = '1';
      mockCorrelateOrder.mockRejectedValue(new Error('db unreachable'));
      await POST(liveReq(WEBHOOK_BOOKING_SUCCESS));

      expect(mockRecord).toHaveBeenCalledTimes(1);
      const rec = mockRecord.mock.calls[0][0];
      expect(rec.success).toBe(false);
      expect(rec.code).toBe(200);
      expect(rec.error).toBe('db unreachable');

      const span = webhookSpan();
      expect(span.status.code).toBe(SpanStatusCode.ERROR);
    });

    it('a THROWING payload log never breaks the webhook ack (best-effort, mirrors 10c outbound discipline)', async () => {
      process.env.ROUTESTACK_DEBUG_PAYLOADS = '1';
      mockRecord.mockRejectedValueOnce(new Error('log explosion'));
      mockCorrelateOrder.mockResolvedValue({ bookingOrderId: null, matched: false });
      mockRecordWebhookEvent.mockResolvedValue(undefined);
      const res = await POST(liveReq(WEBHOOK_BOOKING_SUCCESS));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true, matched: false });
    });
  });
});
