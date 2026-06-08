/* Dash0 OTLP header mapping (split out from register.ts so it is pure and unit-testable WITHOUT
 * importing the server-only @vercel/otel module). The OTLP exporters read OTEL_EXPORTER_OTLP_HEADERS
 * from env; Dash0 ingress needs two headers:
 *   - `Authorization: Bearer <key>`  (auth)         ← from DASH0_API_KEY
 *   - `Dash0-Dataset: <dataset>`     (routing)      ← from DASH0_DATASET (optional; Dash0 defaults to
 *                                                     "default" when absent)
 * We build OTEL_EXPORTER_OTLP_HEADERS from those env vars here (before the exporter reads env), unless
 * the operator set OTEL_EXPORTER_OTLP_HEADERS explicitly (then theirs wins entirely). */

/** Env shape we touch — a subset of process.env (string-or-undefined values). */
type EnvLike = Record<string, string | undefined>;

/** Build OTEL_EXPORTER_OTLP_HEADERS for Dash0 from DASH0_API_KEY (+ optional DASH0_DATASET), unless
 * the operator already provided OTEL_EXPORTER_OTLP_HEADERS (then theirs wins). Returns the header
 * string that was set, or null when nothing was applied (no key, or already set). Mutates `env`. */
export function applyDash0Headers(env: EnvLike = process.env): string | null {
  if (env.OTEL_EXPORTER_OTLP_HEADERS) return null; // operator-provided value wins — don't clobber
  const key = env.DASH0_API_KEY;
  if (!key) return null; // no key → nothing to authenticate with (exporter may still no-op)
  // OTLP header syntax: comma-separated key=value pairs.
  const pairs = [`Authorization=Bearer ${key}`];
  if (env.DASH0_DATASET) pairs.push(`Dash0-Dataset=${env.DASH0_DATASET}`);
  const headers = pairs.join(',');
  env.OTEL_EXPORTER_OTLP_HEADERS = headers;
  return headers;
}
