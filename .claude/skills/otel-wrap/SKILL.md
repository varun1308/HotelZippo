---
name: otel-wrap
description: Wrap a server operation (Anthropic / Supabase / Apify / RouteStack) in OTEL tracing with the standard attributes from 14. Use whenever adding a server-side external call or DB query that must be observable in Dash0. Trigger - "instrument this call", "add a span", "wire OTEL for <op>".
---

# otel-wrap

One consistent way to make every server-side operation observable in Dash0, per `specs/14-error-handling.md` (Notion 14).

## When to use
Adding or reviewing any server-side Anthropic call, Supabase query, Apify run (Phase 6), or RouteStack call (Phase 7).

## Prerequisite
OTEL is initialised **once** in `instrumentation.ts` (Phase 0) — not per route/component. The worker process (Phase 6) initialises OTEL independently. All traces carry `service.name = "hotelzippo"`, `environment` (`development`/`production`), and — for anything on the chat/recommendation path — `hz.conversation_id` + `hz.user_id` (propagated via baggage; see below).

## Use the shared helper — do NOT hand-roll `startActiveSpan`
`lib/otel/trace.ts` is the single implementation. Never re-create the duration/status/`recordException`/`end` boilerplate inline.

```ts
import { withSpan, HZ } from '@/lib/otel/trace';

await withSpan('db.query', { attrs: { [HZ.dbTable]: 'hotels', [HZ.dbOp]: 'select' } }, async (span) => {
  const res = await supabase.from('hotels').select('*').in('id', ids);
  if (!res.error) span.setAttribute(HZ.dbRows, res.data?.length ?? 0);
  return res;
});
```

`withSpan` sets attrs, stamps the active correlation baggage, records `hz.duration_ms`, sets OK/ERROR, `recordException` on throw, and always ends the span. Add outcome attributes / decision-point events on the `span` it hands you.

## Attribute keys: always the `HZ.*` constants
Never inline string keys — use `HZ.*` from `lib/otel/trace.ts` so Dash0 has one stable, filterable vocabulary (`hz.model`, `hz.tokens.input/output`, `hz.stop_reason`, `hz.tool.name`, `hz.db.table/op/rows`, `hz.hotel_id`, `hz.destination`, `hz.outcome`, …). If you need a key that doesn't exist yet, add it to `HZ` rather than inlining.

## Span names (convention)
`<area>.<operation>` — e.g. `anthropic.assemble`, `chat.turn`, `chat.tool`, `db.query`, `routestack.<step>`, `booking.rates`, `webhook.routestack`, `assembly.poll`.

## Correlation
- A request handler that starts a conversation-path operation binds ids once: `withCorrelation({ conversationId, userId }, () => …)`. Every `withSpan` inside inherits `hz.conversation_id` + `hz.user_id` — no arg-threading.
- For a span whose lifetime crosses an async boundary the scoped `withSpan` can't cover (e.g. a streaming route where work happens in a `ReadableStream` callback after the handler returns), use `startManagedSpan` and end it yourself in the stream's `finally`.
- The AI SDK model call: set `experimental_telemetry: { isEnabled: true, recordInputs: false, recordOutputs: false, metadata: { [HZ.conversationId]: id } }` so the SDK emits token-usage spans **without** recording prompt/PII.

## Hard rules
- Server-side only. Dash0 credentials come from env vars (`DASH0_API_KEY`, `OTEL_EXPORTER_OTLP_ENDPOINT`) — never hardcoded.
- This is the only logging/tracing path (CLAUDE.md rule 6) — no other logging framework.
- Never record conversation content, prompts, or profile PII as span attributes/events. Token counts + outcomes only.

## Output
Confirm the span name, `HZ.*` attributes set, correlation, error handling, and that the trace ID is surfaced for cross-referencing.
