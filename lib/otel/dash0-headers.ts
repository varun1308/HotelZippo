/* Dash0 OTLP auth-header mapping (split out from register.ts so it is pure and unit-testable
 * WITHOUT importing the server-only @vercel/otel module). @vercel/otel's default OTLP exporter reads
 * OTEL_EXPORTER_OTLP_HEADERS from env; Dash0 ingress needs `Authorization: Bearer <key>`, so we map
 * DASH0_API_KEY → that header here (before registerOTel), unless the operator set the header already. */

/** Env shape we touch — a subset of process.env (string-or-undefined values). */
type EnvLike = Record<string, string | undefined>;

/** Map DASH0_API_KEY → OTEL_EXPORTER_OTLP_HEADERS (`Authorization=Bearer <key>`), unless the operator
 * already provided OTEL_EXPORTER_OTLP_HEADERS (then theirs wins). Returns the header string that was
 * set, or null when nothing was applied (no key, or already set). Mutates `env` in place. */
export function applyDash0Headers(env: EnvLike = process.env): string | null {
  if (env.OTEL_EXPORTER_OTLP_HEADERS) return null; // operator-provided value wins — don't clobber
  const key = env.DASH0_API_KEY;
  if (!key) return null; // no key → nothing to authenticate with (exporter may still no-op)
  const headers = `Authorization=Bearer ${key}`;
  env.OTEL_EXPORTER_OTLP_HEADERS = headers;
  return headers;
}
