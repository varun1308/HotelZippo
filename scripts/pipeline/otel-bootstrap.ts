/* Side-effecting OTEL bootstrap for the pipeline worker — a SEPARATE Node/tsx process from the
 * Next.js server. Importing this FIRST (before any module that creates spans) guarantees the tracer
 * provider is registered ahead of the worker chain's tracers; without it every pipeline span is made
 * against a no-op tracer and silently dropped.
 *
 * Why NOT @vercel/otel here: its bundled Node build fails to load under tsx ("Cannot access 'require'
 * before initialization") — it targets the Next.js/Vercel runtime, not a raw Node process. So the
 * worker uses the vanilla OpenTelemetry Node SDK, which loads cleanly under tsx. We keep PARITY with
 * the web app's @vercel/otel setup: same service.name 'hotelzippo', same deployment.environment, and
 * the same DASH0_API_KEY → OTLP Authorization header mapping (lib/otel/dash0-headers).
 *
 * Graceful no-op: with OTEL_EXPORTER_OTLP_ENDPOINT unset (local dev without Dash0), the OTLP exporter
 * has nowhere to send and spans are simply dropped — no throw, no noise. */
import { NodeTracerProvider, BatchSpanProcessor } from '@opentelemetry/sdk-trace-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';
import { Resource } from '@opentelemetry/resources';
import {
  ATTR_SERVICE_NAME,
  SEMRESATTRS_DEPLOYMENT_ENVIRONMENT,
} from '@opentelemetry/semantic-conventions';
import { applyDash0Headers } from '@/lib/otel/dash0-headers';

// Map DASH0_API_KEY → OTEL_EXPORTER_OTLP_HEADERS before the exporter reads env (same as the web app).
applyDash0Headers();

const provider = new NodeTracerProvider({
  resource: new Resource({
    [ATTR_SERVICE_NAME]: 'hotelzippo',
    [SEMRESATTRS_DEPLOYMENT_ENVIRONMENT]: process.env.NODE_ENV ?? 'development',
  }),
  // OTLPTraceExporter reads OTEL_EXPORTER_OTLP_ENDPOINT / _HEADERS / _PROTOCOL from env, exactly like
  // the web app's @vercel/otel exporter — so one set of env vars configures both processes.
  spanProcessors: [new BatchSpanProcessor(new OTLPTraceExporter())],
});

provider.register();

// Flush the batch on exit so a short single-poll run still ships its spans before the process ends.
async function shutdown(): Promise<void> {
  try {
    await provider.shutdown();
  } catch {
    /* best-effort flush — never block exit on the exporter */
  }
}
process.once('beforeExit', () => {
  void shutdown();
});
