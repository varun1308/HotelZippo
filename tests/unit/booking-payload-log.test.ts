/* RouteStack payload debug log (lib/booking/payload-log) — the redaction rules + the
 * Supabase-backed writer's best-effort behaviour, plus payloadLoggingEnabled's flag read. No network. */
jest.mock('server-only', () => ({}));

import { redact, makeSupabasePayloadLog, payloadLoggingEnabled, type PayloadRecord } from '@/lib/booking/payload-log';
import type { SupabaseClient } from '@supabase/supabase-js';

const baseRec: PayloadRecord = {
  step: 'get_payment_url',
  path: '/mcp/hotel/get-payment-url',
  request: {},
  response: {},
  success: true,
  code: null,
  durationMs: 12,
  error: null,
  hotelId: '39610223',
  traceId: 'abc123',
};

describe('redact', () => {
  it('masks session secrets and the payment URL at any depth', () => {
    const out = redact({
      hotelId: '39610223',
      token: 'd0cf4062-secret',
      correlationId: 'corr-123',
      url: 'https://alpha.routestack.ai/hotel/guests?query=...',
      nested: { jwt: 'ey...', innocent: 'keep-me' },
    }) as Record<string, any>;
    expect(out.hotelId).toBe('39610223'); // non-secret kept
    expect(out.token).toBe('[redacted]');
    expect(out.correlationId).toBe('[redacted]');
    expect(out.url).toBe('[redacted]');
    expect(out.nested.jwt).toBe('[redacted]');
    expect(out.nested.innocent).toBe('keep-me');
  });

  it('masks guest PII fields', () => {
    const out = redact({ guestNames: ['Raj Mehta'], childAges: [7], contact: '555', rooms: 2 }) as Record<string, any>;
    expect(out.guestNames).toBe('[redacted]');
    expect(out.childAges).toBe('[redacted]');
    expect(out.contact).toBe('[redacted]');
    expect(out.rooms).toBe(2); // non-PII kept
  });

  it('walks arrays and is case-insensitive on keys', () => {
    const out = redact([{ Token: 'x' }, { CorrelationID: 'y' }]) as Array<Record<string, any>>;
    expect(out[0].Token).toBe('[redacted]');
    expect(out[1].CorrelationID).toBe('[redacted]');
  });

  it('passes scalars and null through unchanged', () => {
    expect(redact(null)).toBeNull();
    expect(redact('plain')).toBe('plain');
    expect(redact(42)).toBe(42);
  });
});

describe('makeSupabasePayloadLog', () => {
  it('inserts a REDACTED row into raw_routestack_payloads', async () => {
    const inserted: any[] = [];
    const client = {
      from: (table: string) => ({
        insert: (row: any) => {
          expect(table).toBe('raw_routestack_payloads');
          inserted.push(row);
          return Promise.resolve({ error: null });
        },
      }),
    } as unknown as SupabaseClient;

    const log = makeSupabasePayloadLog(client);
    await log.record({ ...baseRec, request: { token: 'secret', hotelId: '1' }, response: { url: 'https://pay', ok: true } });

    expect(inserted).toHaveLength(1);
    const row = inserted[0];
    expect(row.step).toBe('get_payment_url');
    expect(row.hotel_id).toBe('39610223');
    expect(row.trace_id).toBe('abc123');
    expect(row.duration_ms).toBe(12);
    // redaction applied before persist
    expect(row.request.token).toBe('[redacted]');
    expect(row.request.hotelId).toBe('1');
    expect(row.response.url).toBe('[redacted]');
    expect(row.response.ok).toBe(true);
  });

  it('swallows DB errors (best-effort, never throws)', async () => {
    const client = {
      from: () => ({ insert: () => Promise.reject(new Error('db down')) }),
    } as unknown as SupabaseClient;
    const log = makeSupabasePayloadLog(client);
    await expect(log.record(baseRec)).resolves.toBeUndefined();
  });
});

describe('payloadLoggingEnabled', () => {
  const ORIG = process.env.ROUTESTACK_DEBUG_PAYLOADS;
  afterEach(() => {
    if (ORIG === undefined) delete process.env.ROUTESTACK_DEBUG_PAYLOADS;
    else process.env.ROUTESTACK_DEBUG_PAYLOADS = ORIG;
  });
  it('off by default, on with =1', () => {
    delete process.env.ROUTESTACK_DEBUG_PAYLOADS;
    expect(payloadLoggingEnabled()).toBe(false);
    process.env.ROUTESTACK_DEBUG_PAYLOADS = '1';
    expect(payloadLoggingEnabled()).toBe(true);
    process.env.ROUTESTACK_DEBUG_PAYLOADS = 'true';
    expect(payloadLoggingEnabled()).toBe(false); // only "1" enables
  });
});
