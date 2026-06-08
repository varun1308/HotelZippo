/* Shared OpenTelemetry bootstrap (specs/14-error-handling.md · Notion 14).
 *
 * ONE config shape for every process that emits traces:
 *   - the Next.js server  → instrumentation.ts calls registerHotelZippoOtel()
 *   - the pipeline worker → scripts/pipeline/run-worker.ts calls it before any span runs
 * so service.name + attributes + the Dash0 export are identical and never drift.
 *
 * Dash0 auth: @vercel/otel's default OTLP exporter reads the endpoint/protocol/headers from the
 * standard OTEL_EXPORTER_OTLP_* env vars. Dash0 ingress needs an `Authorization: Bearer <key>`
 * header, so we map DASH0_API_KEY → OTEL_EXPORTER_OTLP_HEADERS here (once, before registerOTel),
 * UNLESS the operator already set OTEL_EXPORTER_OTLP_HEADERS explicitly (their value wins).
 *
 * Graceful no-op: with no OTLP endpoint configured, @vercel/otel exports nothing and does not throw
 * (local dev without Dash0 stays clean). Safe to call once per process; calling twice is a no-op-ish
 * re-register, so each entrypoint calls it exactly once. */
import { registerOTel } from '@vercel/otel';
import { applyDash0Headers } from './dash0-headers';

export { applyDash0Headers };

/** Initialise OTEL for this process. Idempotent intent: call once per entrypoint. */
export function registerHotelZippoOtel(): void {
  applyDash0Headers();
  registerOTel({
    serviceName: 'hotelzippo',
    attributes: {
      'deployment.environment': process.env.NODE_ENV ?? 'development',
    },
  });
}
