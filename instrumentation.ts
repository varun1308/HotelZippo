/* OpenTelemetry initialisation — the single instrumentation layer for the app.
 *
 * Per specs/14-error-handling.md (Notion 14):
 *  - OTEL is initialised here, NOT per-route/per-component.
 *  - All traces carry service.name = "hotelzippo" + environment.
 *  - Export goes to Dash0 via OTLP (OTEL_EXPORTER_OTLP_ENDPOINT, DASH0_API_KEY).
 *  - The Phase 6 review-pipeline worker initialises OTEL independently.
 *
 * This file is invoked by Next.js once per server process (instrumentationHook).
 * @vercel/otel wires the OTLP exporter from standard OTEL_* env vars; when those
 * are unset (e.g. local dev without Dash0), it no-ops gracefully.
 */
import { registerOTel } from '@vercel/otel';

export function register() {
  registerOTel({
    serviceName: 'hotelzippo',
    attributes: {
      'deployment.environment': process.env.NODE_ENV ?? 'development',
    },
  });
}
