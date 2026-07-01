/* Shared tracing helper + attribute convention (specs/14-error-handling.md).
 *
 * ONE way to make a span, so every trace in Dash0 is consistent and filterable:
 *   - `withSpan(name, { attrs }, fn)` runs `fn` inside an active span, sets the given
 *     attributes, records `hz.duration_ms` in `finally`, marks OK / ERROR, records the
 *     exception + attaches the trace id on throw, and always ends the span. This is the
 *     proven lib/booking/routestack.ts::tracedCall pattern lifted out so the chat / LLM /
 *     tool / DB paths get the same treatment (they were previously untraced or opaque).
 *   - The `HZ` namespace fixes attribute keys (`hz.*`) so a conversation is filterable
 *     end-to-end and the keys are discoverable in Dash0 (before this, spans carried zero
 *     app-specific keys).
 *   - Correlation baggage: `withCorrelation` stamps conversation/user ids into OTEL baggage
 *     so EVERY child span (LLM call, tool, DB query) inherits `hz.conversation_id` +
 *     `hz.user_id` without threading args through every function. `stampCorrelation` copies
 *     the active baggage onto a span.
 *
 * Server-side only (OTEL is a server concern per specs/14 + CLAUDE.md rule 6). Graceful
 * no-op when OTEL isn't wired: the global tracer is a no-op tracer, so spans are free. */
import {
  trace,
  context,
  propagation,
  SpanStatusCode,
  SpanKind,
  type Span,
  type Attributes,
} from '@opentelemetry/api';

const TRACER = 'hotelzippo';

/** Canonical `hz.*` span attribute keys. Use these constants — never inline string keys —
 * so Dash0 filters/dashboards have one stable vocabulary across every flow. */
export const HZ = {
  /* correlation (propagated via baggage to every child span) */
  conversationId: 'hz.conversation_id',
  userId: 'hz.user_id',
  authenticated: 'hz.authenticated',
  turnIndex: 'hz.turn_index',
  /* timing / outcome (set by withSpan / call sites) */
  durationMs: 'hz.duration_ms',
  success: 'hz.success',
  outcome: 'hz.outcome',
  code: 'hz.code',
  mock: 'hz.mock',
  /* LLM */
  model: 'hz.model',
  tokensInput: 'hz.tokens.input',
  tokensOutput: 'hz.tokens.output',
  stopReason: 'hz.stop_reason',
  /* chat tools */
  toolName: 'hz.tool.name',
  /* DB */
  dbTable: 'hz.db.table',
  dbOp: 'hz.db.op',
  dbRows: 'hz.db.rows',
  /* domain entities */
  jobId: 'hz.job_id',
  hotelId: 'hz.hotel_id',
  hotelCount: 'hz.hotel_count',
  destination: 'hz.destination',
} as const;

/** Baggage keys used to carry correlation ids across span boundaries. */
const BAGGAGE_CONVERSATION = 'hz.conversation_id';
const BAGGAGE_USER = 'hz.user_id';

export interface WithSpanOptions {
  /** Attributes to set on the span up front. */
  attrs?: Attributes;
  /** Span kind — INTERNAL by default (most of our spans are in-process operations). */
  kind?: SpanKind;
}

/**
 * Run `fn` inside an active span named `name`. Sets `attrs`, stamps the active correlation
 * baggage (`hz.conversation_id` / `hz.user_id`), records `hz.duration_ms`, sets OK / ERROR
 * status, records the exception on throw, and always ends the span. Returns whatever `fn`
 * returns; rethrows what it throws (with the trace id available on the span context).
 *
 * `fn` receives the live `Span` so a call site can add outcome attributes (`span.setAttribute`)
 * or decision-point events (`span.addEvent`) as they become known.
 */
export function withSpan<T>(
  name: string,
  opts: WithSpanOptions,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  const tracer = trace.getTracer(TRACER);
  return tracer.startActiveSpan(name, { kind: opts.kind ?? SpanKind.INTERNAL }, async (span) => {
    if (opts.attrs) span.setAttributes(opts.attrs);
    stampCorrelation(span);
    const start = Date.now();
    try {
      const out = await fn(span);
      // Only default to OK if the call site didn't already set a status (e.g. a soft error).
      span.setStatus({ code: SpanStatusCode.OK });
      return out;
    } catch (e) {
      span.recordException(e as Error);
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw e;
    } finally {
      span.setAttribute(HZ.durationMs, Date.now() - start);
      span.end();
    }
  });
}

/**
 * Run `fn` with `conversationId` / `userId` placed in OTEL baggage so every span created
 * inside `fn` (directly or in nested async calls that stay on the context) inherits the
 * correlation ids via `stampCorrelation`. Undefined ids are simply not set. Wrap the top of
 * a request handler in this once; downstream `withSpan` calls pick the ids up for free.
 */
export function withCorrelation<T>(
  ids: { conversationId?: string | null; userId?: string | null },
  fn: () => T,
): T {
  let bag = propagation.getActiveBaggage() ?? propagation.createBaggage();
  if (ids.conversationId) bag = bag.setEntry(BAGGAGE_CONVERSATION, { value: ids.conversationId });
  if (ids.userId) bag = bag.setEntry(BAGGAGE_USER, { value: ids.userId });
  const ctx = propagation.setBaggage(context.active(), bag);
  return context.with(ctx, fn);
}

/** Copy the active correlation baggage (`hz.conversation_id` / `hz.user_id`) onto `span`. */
export function stampCorrelation(span: Span): void {
  const bag = propagation.getActiveBaggage();
  if (!bag) return;
  const conv = bag.getEntry(BAGGAGE_CONVERSATION)?.value;
  if (conv) span.setAttribute(HZ.conversationId, conv);
  const user = bag.getEntry(BAGGAGE_USER)?.value;
  if (user) span.setAttribute(HZ.userId, user);
}

/**
 * Start a span whose lifetime spans an async boundary the `withSpan` scoped form can't cover —
 * e.g. a streaming route handler where the work happens inside a ReadableStream callback that
 * runs AFTER the handler returns. Returns the live `span` plus a `runInContext` that executes a
 * function with this span active (so child spans nest + inherit correlation) and an `end` that
 * records `hz.duration_ms` and closes the span. The CALLER owns ending it (in the stream's
 * `finally`). Attributes + active correlation baggage are set up front.
 */
export function startManagedSpan(
  name: string,
  opts: WithSpanOptions = {},
): {
  span: Span;
  runInContext: <T>(fn: () => T) => T;
  end: (status?: SpanStatusCode) => void;
} {
  const tracer = trace.getTracer(TRACER);
  const span = tracer.startSpan(name, { kind: opts.kind ?? SpanKind.INTERNAL });
  if (opts.attrs) span.setAttributes(opts.attrs);
  stampCorrelation(span);
  const start = Date.now();
  const ctx = trace.setSpan(context.active(), span);
  return {
    span,
    runInContext: (fn) => context.with(ctx, fn),
    end: (status = SpanStatusCode.OK) => {
      span.setAttribute(HZ.durationMs, Date.now() - start);
      span.setStatus({ code: status });
      span.end();
    },
  };
}

/** The trace id of the currently-active span, or null when nothing is being traced. Handy for
 * surfacing a Dash0 reference on a warm error (specs/14). */
export function currentTraceId(): string | null {
  return trace.getActiveSpan()?.spanContext().traceId ?? null;
}

/** A safe UUID guard for correlation ids arriving from the client (body / query). Rejects
 * anything that isn't a v4-shaped UUID so a hostile value can't poison the trace attribute. */
export function isValidConversationId(v: unknown): v is string {
  return typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}
