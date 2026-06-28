/* RouteStack payload debug log (Phase 7 debugging · specs/10c-booking-routestack.md).
 *
 * WHAT: a best-effort, flag-gated capture of RouteStack request/response payloads into the
 * service-role-only `raw_routestack_payloads` table, for debugging + replay. The orchestrator's
 * `tracedCall` calls `record(...)` after every RouteStack call when (and only when) a PayloadLog is
 * injected — which the route does ONLY if ROUTESTACK_DEBUG_PAYLOADS=1.
 *
 * WHY a separate seam (not OTEL span attributes): RouteStack responses are large (the rates payload
 * is ~650 KB) and span attributes are the wrong place for blobs. Full payloads live in our own
 * access-controlled DB; a redacted summary goes to OTEL logs LATER (deferred — see the payload-logging
 * plan). For now this is the DB half only.
 *
 * PRIVACY: even the DB rows are REDACTED before insert — the session `token`, `correlationId`, the
 * deep-link payment `url` (it embeds the whole session), any `Authorization`, and guest PII fields are
 * stripped/masked. The table is for inspecting request/response SHAPE + business codes, not for hoarding
 * secrets. Redaction is applied unconditionally here so it can never be forgotten at a call site.
 *
 * Best-effort by construction: any failure to redact or persist is swallowed — logging MUST NEVER
 * break a booking. NOT `'use client'`: server-side (service client); reached from the booking routes
 * and tsx scripts; never imported by a client component. */
import type { SupabaseClient } from '@supabase/supabase-js';

/** One captured RouteStack call. `request`/`response` are the RAW (un-redacted) values as seen by the
 * orchestrator; redaction happens inside `record` before anything is persisted. */
export interface PayloadRecord {
  step: string;
  path: string;
  request: unknown;
  response: unknown;
  success: boolean | null;
  code: number | null;
  durationMs: number | null;
  error: string | null;
  hotelId: string | null;
  traceId: string | null;
}

/** The debug-log surface the orchestrator depends on. Injected as `deps.debugLog`; absent in the
 * normal (un-flagged) path so capture is fully off. `record` resolves even on failure (best-effort). */
export interface PayloadLog {
  record(rec: PayloadRecord): Promise<void>;
}

/* ---- redaction ---------------------------------------------------------- */

/** Keys whose values are session secrets or the session-bearing deep link — fully masked. */
const SECRET_KEYS = new Set(['token', 'correlationId', 'correlationid', 'authorization', 'url', 'paymenturl', 'jwt', 'hmac', 'apikey', 'apisecret']);
/** Keys that (now or once booking is live) carry guest PII — masked. Includes the webhook billing
 * fields (10d) so the webhook_events audit log never stores raw billing name/email. */
const PII_KEYS = new Set(['guestnames', 'guestname', 'firstname', 'lastname', 'email', 'billing_email', 'billing_name', 'phone', 'contact', 'childages', 'guests', 'travellers', 'travelers', 'passenger']);

const MASK = '[redacted]';

/** Recursively clone `value`, masking any property whose (lowercased) key is a secret/PII key. Arrays
 * and nested objects are walked. Non-plain values pass through. Defensive against cycles + huge depth. */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 12 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const lk = k.toLowerCase();
    if (SECRET_KEYS.has(lk) || PII_KEYS.has(lk)) {
      out[k] = MASK;
    } else {
      out[k] = redact(v, depth + 1);
    }
  }
  return out;
}

/* ---- persistence -------------------------------------------------------- */

interface PayloadInsert {
  step: string;
  path: string;
  request: unknown;
  response: unknown;
  success: boolean | null;
  code: number | null;
  duration_ms: number | null;
  error: string | null;
  hotel_id: string | null;
  trace_id: string | null;
}

/** Build the real Supabase-backed payload log. `client` MUST be the service client (the table is
 * service-role only). Every write is tolerant — a DB error resolves to a no-op so the orchestrator's
 * best-effort call simply proceeds. Redaction is applied here, not at the call site. */
export function makeSupabasePayloadLog(client: SupabaseClient): PayloadLog {
  return {
    async record(rec) {
      try {
        const row: PayloadInsert = {
          step: rec.step,
          path: rec.path,
          request: redact(rec.request),
          response: redact(rec.response),
          success: rec.success,
          code: rec.code,
          duration_ms: rec.durationMs,
          error: rec.error,
          hotel_id: rec.hotelId,
          trace_id: rec.traceId,
        };
        await client.from('raw_routestack_payloads').insert(row);
      } catch {
        // best-effort: never break a booking because debug logging failed.
      }
    },
  };
}

/** Whether RouteStack payload capture is enabled. OFF unless ROUTESTACK_DEBUG_PAYLOADS=1
 * (read lazily so it can be toggled per environment without code change). */
export function payloadLoggingEnabled(): boolean {
  return process.env.ROUTESTACK_DEBUG_PAYLOADS === '1';
}
