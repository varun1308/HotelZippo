/* Live OTEL → Dash0 smoke (dev-only). Boots the REAL worker OTEL bootstrap, emits one span through
 * the SAME `trace.getTracer('hotelzippo')` API the app uses, flushes, and prints the trace id to
 * look up in Dash0. Proves the full path (bootstrap → OTLP proto exporter → Dash0) end-to-end.
 *   npm run dev:otel-smoke
 * Needs DASH0_API_KEY + OTEL_EXPORTER_OTLP_ENDPOINT (+ optional DASH0_DATASET) in .env.local. */
import { flushOtel } from '../pipeline/otel-bootstrap';
import { trace, SpanStatusCode } from '@opentelemetry/api';

async function main() {
  if (!process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
    console.error('[otel-smoke] OTEL_EXPORTER_OTLP_ENDPOINT not set — nothing to export. Set it in .env.local.');
    process.exit(1);
  }
  const tracer = trace.getTracer('hotelzippo');
  await tracer.startActiveSpan('hotelzippo.smoke.app', async (span) => {
    span.setAttribute('smoke.source', 'claude-app-path-verify');
    const ctx = span.spanContext();
    console.log(`[otel-smoke] emitted span — traceId=${ctx.traceId} spanId=${ctx.spanId}`);
    span.setStatus({ code: SpanStatusCode.OK });
    span.end();
    console.log(`[otel-smoke] dataset=${process.env.DASH0_DATASET ?? '(default)'} → look up traceId ${ctx.traceId} in Dash0`);
  });
  // Deterministic flush — ship the batched span before the process exits.
  await flushOtel();
  console.log('[otel-smoke] flushed — span shipped to Dash0.');
}

main().catch((e) => {
  console.error('[otel-smoke]', e instanceof Error ? e.message : e);
  process.exit(1);
});
