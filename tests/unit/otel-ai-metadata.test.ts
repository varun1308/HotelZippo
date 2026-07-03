/* AiMetadataSpanProcessor (lib/otel/ai-metadata.ts).
 *
 * The Vercel AI SDK prefixes experimental_telemetry metadata as
 * `ai.telemetry.metadata.<key>`, so `hz.conversation_id` lands as
 * `ai.telemetry.metadata.hz.conversation_id` and drops out of the spec-14 Dash0 filter.
 * The processor copies those back to bare `hz.*` on span end, before export. Proven here
 * against a fake ReadableSpan AND end-to-end through a real in-memory tracer pipeline. */
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
  type ReadableSpan,
} from '@opentelemetry/sdk-trace-base';
import { AiMetadataSpanProcessor } from '@/lib/otel/ai-metadata';
import { HZ } from '@/lib/otel/trace';

function fakeSpan(attributes: Record<string, unknown>): ReadableSpan {
  return { attributes } as unknown as ReadableSpan;
}

describe('AiMetadataSpanProcessor.onEnd', () => {
  const processor = new AiMetadataSpanProcessor();

  it('copies ai.telemetry.metadata.hz.* attributes onto their bare hz.* keys', () => {
    const span = fakeSpan({
      'ai.telemetry.metadata.hz.conversation_id': 'conv-abc',
      'ai.usage.completionTokens': 42,
    });
    processor.onEnd(span);
    expect(span.attributes[HZ.conversationId]).toBe('conv-abc');
    // The prefixed original stays (harmless; the exporter ships both).
    expect(span.attributes['ai.telemetry.metadata.hz.conversation_id']).toBe('conv-abc');
  });

  it('never overwrites an existing bare hz.* attribute', () => {
    const span = fakeSpan({
      [HZ.conversationId]: 'already-set',
      'ai.telemetry.metadata.hz.conversation_id': 'metadata-copy',
    });
    processor.onEnd(span);
    expect(span.attributes[HZ.conversationId]).toBe('already-set');
  });

  it('ignores non-hz metadata and unrelated attributes', () => {
    const span = fakeSpan({
      'ai.telemetry.metadata.someOtherKey': 'x',
      'ai.operationId': 'ai.streamText',
    });
    processor.onEnd(span);
    expect(Object.keys(span.attributes)).toEqual(['ai.telemetry.metadata.someOtherKey', 'ai.operationId']);
  });

  it('forceFlush/shutdown resolve (safe in any processor chain)', async () => {
    await expect(processor.forceFlush()).resolves.toBeUndefined();
    await expect(processor.shutdown()).resolves.toBeUndefined();
  });
});

describe('AiMetadataSpanProcessor in a real pipeline', () => {
  it('exported spans carry the bare hz.* key when registered ahead of the exporter', () => {
    const exporter = new InMemorySpanExporter();
    // Same ordering as lib/otel/register.ts / the worker bootstrap: our processor FIRST,
    // then the exporting processor — onEnd runs in registration order.
    const provider = new BasicTracerProvider({
      spanProcessors: [new AiMetadataSpanProcessor(), new SimpleSpanProcessor(exporter)],
    });
    const span = provider.getTracer('test').startSpan('ai.streamText', {
      attributes: { 'ai.telemetry.metadata.hz.conversation_id': 'conv-e2e' },
    });
    span.end();
    const finished = exporter.getFinishedSpans().find((s) => s.name === 'ai.streamText');
    expect(finished?.attributes[HZ.conversationId]).toBe('conv-e2e');
  });
});
