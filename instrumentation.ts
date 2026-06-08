/* OpenTelemetry initialisation for the Next.js server process.
 *
 * Per specs/14-error-handling.md (Notion 14):
 *  - OTEL is initialised here, NOT per-route/per-component.
 *  - All traces carry service.name = "hotelzippo" + environment.
 *  - Export goes to Dash0 via OTLP (OTEL_EXPORTER_OTLP_ENDPOINT, DASH0_API_KEY).
 *  - The Phase 6 review-pipeline worker initialises OTEL independently — it imports the SAME
 *    bootstrap (lib/otel/register) so both processes share one config and never drift.
 *
 * This file is invoked by Next.js once per server process (instrumentationHook). The shared
 * bootstrap wires the OTLP exporter from standard OTEL_* env vars (+ maps DASH0_API_KEY into the
 * auth header); when no endpoint is configured (e.g. local dev without Dash0), it no-ops gracefully.
 */
import { registerHotelZippoOtel } from '@/lib/otel/register';

export function register() {
  registerHotelZippoOtel();
}
