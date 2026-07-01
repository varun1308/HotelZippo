/* withSpan / correlation helper (lib/otel/trace.ts).
 *
 * Registers a real in-memory tracer provider so we can assert on the spans withSpan emits:
 * attributes, hz.duration_ms, OK/ERROR status + recorded exception on throw, and that
 * withCorrelation baggage propagates hz.conversation_id / hz.user_id onto a CHILD span
 * created inside it. This is the guarantee that a whole conversation shares one id in Dash0. */
import { trace, context, SpanStatusCode } from '@opentelemetry/api';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
  type ReadableSpan,
} from '@opentelemetry/sdk-trace-base';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import {
  withSpan,
  withCorrelation,
  startManagedSpan,
  HZ,
  isValidConversationId,
} from '@/lib/otel/trace';

const exporter = new InMemorySpanExporter();

beforeAll(() => {
  // A real provider + async-hooks context manager so startActiveSpan + baggage propagate
  // across awaits exactly as they do in the Next.js server runtime.
  context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
  const provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
  trace.setGlobalTracerProvider(provider);
});

beforeEach(() => exporter.reset());

function byName(name: string): ReadableSpan {
  const span = exporter.getFinishedSpans().find((s) => s.name === name);
  if (!span) throw new Error(`no finished span named ${name}`);
  return span;
}

describe('withSpan', () => {
  it('sets attrs, records hz.duration_ms, and marks OK on success', async () => {
    const result = await withSpan('test.ok', { attrs: { [HZ.model]: 'claude-haiku-4-5' } }, async () => 42);
    expect(result).toBe(42);
    const span = byName('test.ok');
    expect(span.attributes[HZ.model]).toBe('claude-haiku-4-5');
    expect(typeof span.attributes[HZ.durationMs]).toBe('number');
    expect(span.status.code).toBe(SpanStatusCode.OK);
  });

  it('marks ERROR, records the exception, and rethrows on failure', async () => {
    const boom = new Error('kaboom');
    await expect(withSpan('test.err', {}, async () => { throw boom; })).rejects.toThrow('kaboom');
    const span = byName('test.err');
    expect(span.status.code).toBe(SpanStatusCode.ERROR);
    expect(span.events.some((e) => e.name === 'exception')).toBe(true);
    // duration is still recorded from the finally block even on throw.
    expect(typeof span.attributes[HZ.durationMs]).toBe('number');
  });

  it('lets the call site add outcome attributes on the live span', async () => {
    await withSpan('test.outcome', {}, async (span) => {
      span.setAttribute(HZ.outcome, 'no_eligible_hotels');
    });
    expect(byName('test.outcome').attributes[HZ.outcome]).toBe('no_eligible_hotels');
  });
});

describe('withCorrelation', () => {
  it('propagates conversation/user ids from baggage onto a child span', async () => {
    await withCorrelation({ conversationId: 'conv-abc', userId: 'user-123' }, async () =>
      withSpan('test.child', {}, async () => undefined),
    );
    const span = byName('test.child');
    expect(span.attributes[HZ.conversationId]).toBe('conv-abc');
    expect(span.attributes[HZ.userId]).toBe('user-123');
  });

  it('omits ids that are not provided', async () => {
    await withCorrelation({ conversationId: 'conv-only' }, async () =>
      withSpan('test.partial', {}, async () => undefined),
    );
    const span = byName('test.partial');
    expect(span.attributes[HZ.conversationId]).toBe('conv-only');
    expect(span.attributes[HZ.userId]).toBeUndefined();
  });
});

describe('startManagedSpan', () => {
  it('nests child spans created in its context, propagates correlation, and records duration', async () => {
    // This mirrors the chat.turn pattern: a span opened in the handler, kept active across an
    // async boundary (the stream drain), under which the SDK/tool spans nest.
    await withCorrelation({ conversationId: 'conv-turn', userId: 'user-turn' }, async () => {
      const turn = startManagedSpan('chat.turn', { attrs: { [HZ.turnIndex]: 3 } });
      await turn.runInContext(() => withSpan('chat.tool', {}, async () => undefined));
      turn.end();
    });

    const parent = byName('chat.turn');
    const child = byName('chat.tool');
    // Child's parent is the managed span → they share a trace and the child nests under it.
    // (ReadableSpan exposes the parent id as `parentSpanId` in this SDK version.)
    expect(child.spanContext().traceId).toBe(parent.spanContext().traceId);
    expect((child as unknown as { parentSpanId?: string }).parentSpanId).toBe(parent.spanContext().spanId);
    // Correlation flowed from baggage onto BOTH spans.
    expect(parent.attributes[HZ.conversationId]).toBe('conv-turn');
    expect(child.attributes[HZ.conversationId]).toBe('conv-turn');
    expect(parent.attributes[HZ.turnIndex]).toBe(3);
    expect(typeof parent.attributes[HZ.durationMs]).toBe('number');
    expect(parent.status.code).toBe(SpanStatusCode.OK);
  });

  it('ends with the status the caller passes (ERROR path)', () => {
    const turn = startManagedSpan('chat.turn.err', {});
    turn.end(SpanStatusCode.ERROR);
    expect(byName('chat.turn.err').status.code).toBe(SpanStatusCode.ERROR);
  });
});

describe('isValidConversationId', () => {
  it('accepts a v4-shaped UUID and rejects anything else', () => {
    expect(isValidConversationId('3744958a-29ac-41ff-958a-dee431a77b48')).toBe(true);
    expect(isValidConversationId('not-a-uuid')).toBe(false);
    expect(isValidConversationId('')).toBe(false);
    expect(isValidConversationId(undefined)).toBe(false);
    expect(isValidConversationId(123)).toBe(false);
  });
});
