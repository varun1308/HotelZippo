/* RouteStack partner-token auth (Phase 7 · specs/10c-booking-routestack.md).
 *
 * RouteStack uses HMAC → short-lived JWT: sign `apiKey:timestamp:nonce` with the partner
 * secret (HMAC-SHA256, base64url), POST it to /mcp/auth/partner-token, get back a JWT
 * (expiresIn 24h) that authorises every other call as `Authorization: Bearer <token>`.
 *
 * The JWT is CACHED and reused within its TTL — minting per call would be wasteful and slow
 * the booking flow. Env (ROUTESTACK_API_KEY / _SECRET / _URL) is read LAZILY at call time,
 * never at import, so this module imports cleanly with no env (key-free CI).
 *
 * No `import 'server-only'`: this module is also imported by the standalone schema-capture
 * script (scripts/booking/capture-rates.ts, run via tsx), where that guard throws. It is
 * server-side by construction (uses the HMAC secret) and is never imported by a client
 * component — the client reaches booking only through the /api/booking/* routes. */
import crypto from 'node:crypto';
import { BookingError } from './types';

/** The transport seam: a single function that POSTs JSON to a RouteStack path and returns
 * the parsed JSON. Injected in tests (mock fixtures) and in dev/live (a real fetch client,
 * wired in Slice C). Keeping the seam this thin means the same fixtures serve every step. */
export type RouteStackFetch = (
  path: string,
  body: unknown,
  headers?: Record<string, string>,
) => Promise<unknown>;

interface RouteStackEnv {
  apiKey: string;
  apiSecret: string;
  baseUrl: string;
}

/** Lazy-throw env read — only when a booking call actually runs. Missing creds surface as a
 * graceful BookingError('config'), never an import-time crash. */
export function readEnv(): RouteStackEnv {
  const apiKey = process.env.ROUTESTACK_API_KEY;
  const apiSecret = process.env.ROUTESTACK_API_SECRET;
  const baseUrl = process.env.ROUTESTACK_API_URL;
  if (!apiKey || !apiSecret || !baseUrl) {
    throw new BookingError(
      'config',
      'Missing ROUTESTACK_API_KEY / ROUTESTACK_API_SECRET / ROUTESTACK_API_URL (see specs/13-environment.md).',
    );
  }
  return { apiKey, apiSecret, baseUrl };
}

/** Build the partner-token request body: HMAC-SHA256 of `apiKey:timestamp:nonce`, base64url.
 * `now` is injectable so tests are deterministic (production passes Date.now()). */
export function signPartnerToken(
  apiKey: string,
  apiSecret: string,
  now: number,
  nonce: string,
): { apiKey: string; hmac: string; timestamp: number; nonce: string } {
  const timestamp = Math.floor(now / 1000); // Unix epoch seconds
  const hmac = crypto
    .createHmac('sha256', apiSecret)
    .update(`${apiKey}:${timestamp}:${nonce}`)
    .digest('base64url');
  return { apiKey, hmac, timestamp, nonce };
}

interface CachedToken {
  token: string;
  /** ms epoch after which the token must be re-minted. */
  expiresAt: number;
}

/** Module-level cache — one process-wide JWT, reused across requests within its TTL.
 * Conservative default TTL (1h) well under RouteStack's 24h so we never present a stale
 * token; cleared if a call ever rejects it. */
let cached: CachedToken | null = null;
const DEFAULT_TTL_MS = 60 * 60 * 1000; // 1h safety margin under the 24h JWT

export function _clearTokenCache(): void {
  cached = null;
}

/** Mint (or reuse) a partner JWT. Injectable `deps` keep it testable + deterministic:
 *  - fetchImpl: the transport (mock in tests).
 *  - now / nonce: pinned in tests; default to real clock + random uuid.
 * Caches the result; subsequent calls within TTL skip the network. */
export async function getPartnerToken(
  fetchImpl: RouteStackFetch,
  deps: { now?: () => number; nonce?: () => string; ttlMs?: number } = {},
): Promise<string> {
  const now = deps.now ?? Date.now;
  const current = now();
  if (cached && cached.expiresAt > current) return cached.token;

  const { apiKey, apiSecret } = readEnv();
  const nonce = (deps.nonce ?? (() => crypto.randomUUID()))();
  const body = signPartnerToken(apiKey, apiSecret, current, nonce);

  let res: unknown;
  try {
    res = await fetchImpl('/mcp/auth/partner-token', body);
  } catch (e) {
    throw new BookingError('transport', `partner-token request failed: ${errMsg(e)}`);
  }

  const token = extractToken(res);
  if (!token) {
    throw new BookingError('transport', 'partner-token response did not include a token');
  }
  cached = { token, expiresAt: current + (deps.ttlMs ?? DEFAULT_TTL_MS) };
  return token;
}

function extractToken(res: unknown): string | null {
  if (res && typeof res === 'object') {
    const t = (res as Record<string, unknown>).token;
    if (typeof t === 'string' && t) return t;
  }
  return null;
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
