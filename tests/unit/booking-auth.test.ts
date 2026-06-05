/* Phase 7 · RouteStack HMAC signing + JWT mint/cache. auth.ts imports 'server-only' →
 * alias to a no-op for the jsdom project. */
jest.mock('server-only', () => ({}));

import crypto from 'node:crypto';
import { signPartnerToken, getPartnerToken, readEnv, _clearTokenCache, BookingError } from '@/lib/booking';
import { makeMockFetch, FIXED_NOW, FIXED_NONCE, TOKEN_RESPONSE } from '@/tests/fixtures/routestack';

const ENV = { ROUTESTACK_API_KEY: 'rs_test_key', ROUTESTACK_API_SECRET: 'shhh-secret', ROUTESTACK_API_URL: 'https://evolvemcp.routestack.ai' };

describe('signPartnerToken', () => {
  it('signs apiKey:timestamp:nonce with HMAC-SHA256 base64url, timestamp in seconds', () => {
    const now = 1_700_000_000_000;
    const out = signPartnerToken('rs_test_key', 'shhh-secret', now, 'nonce-1');
    expect(out.timestamp).toBe(1_700_000_000); // ms → s
    expect(out.apiKey).toBe('rs_test_key');
    expect(out.nonce).toBe('nonce-1');
    const expected = crypto.createHmac('sha256', 'shhh-secret').update('rs_test_key:1700000000:nonce-1').digest('base64url');
    expect(out.hmac).toBe(expected);
    expect(out.hmac).not.toMatch(/[+/=]/); // base64url, not base64
  });
});

describe('readEnv', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });
  it('throws a config BookingError when any var is missing', () => {
    delete process.env.ROUTESTACK_API_SECRET;
    expect(() => readEnv()).toThrow(BookingError);
    try {
      readEnv();
    } catch (e) {
      expect((e as BookingError).kind).toBe('config');
    }
  });
});

describe('getPartnerToken caching', () => {
  const saved = { ...process.env };
  beforeEach(() => {
    Object.assign(process.env, ENV);
    _clearTokenCache();
  });
  afterEach(() => {
    process.env = { ...saved };
    _clearTokenCache();
  });

  it('mints once and reuses within TTL', async () => {
    const { fetchImpl, calls } = makeMockFetch();
    const t1 = await getPartnerToken(fetchImpl, { now: FIXED_NOW, nonce: FIXED_NONCE });
    const t2 = await getPartnerToken(fetchImpl, { now: FIXED_NOW, nonce: FIXED_NONCE });
    expect(t1).toBe(TOKEN_RESPONSE.token);
    expect(t2).toBe(t1);
    const tokenCalls = calls.filter((c) => c.path === '/mcp/auth/partner-token');
    expect(tokenCalls).toHaveLength(1); // cached on the second call
  });

  it('re-mints after the TTL lapses', async () => {
    const { fetchImpl, calls } = makeMockFetch();
    let clock = 1_700_000_000_000;
    const now = () => clock;
    await getPartnerToken(fetchImpl, { now, nonce: FIXED_NONCE, ttlMs: 1000 });
    clock += 2000; // past TTL
    await getPartnerToken(fetchImpl, { now, nonce: FIXED_NONCE, ttlMs: 1000 });
    expect(calls.filter((c) => c.path === '/mcp/auth/partner-token')).toHaveLength(2);
  });

  it('wraps a transport failure as a BookingError', async () => {
    const fetchImpl = async () => {
      throw new Error('network down');
    };
    await expect(getPartnerToken(fetchImpl, { now: FIXED_NOW, nonce: FIXED_NONCE })).rejects.toMatchObject({
      kind: 'transport',
    });
  });
});
