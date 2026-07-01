# 14 · Error Handling & Observability

- **Notion:** https://app.notion.com/p/3744958429ac81ff958adee431a77b48
- **Phase:** all (initialised Phase 0) · **Status:** specced

## Principles

- **Warm, human errors** — never a raw error to the user.
- **Never lose data silently** — if a save fails, tell the user.
- **Never a partial recommendation** — if intelligence is insufficient, say so explicitly.
- **Always a clear next action** after an error.
- **Server-side logging via OTEL only** (CLAUDE.md hard rule 6) — never client console in production.
- Every server-side error includes a **trace ID** for cross-referencing in Dash0.

## OTEL instrumentation

**What gets instrumented:**
- All Anthropic API calls — duration, model, token count, success/failure.
- All Supabase queries — table, operation, duration, success/failure.
- All Apify actor runs (Phase 6) — hotel_id, duration, review count, success/failure.
- All RouteStack API calls (Phase 7) — hotel_id, duration, success/failure.
- All server-side errors — full stack trace + request context.
- Conversation Agent sessions — session start, profile completion, trip-brief completion, recommendation delivery.

**Rules for Claude Code:**
1. Initialise OTEL at the app's instrumentation layer (`instrumentation.ts`) — **not** per-route/per-component.
2. All traces include `service.name = "hotelzippo"`, environment (`development`/`production`), and `user_id` where available.
3. The review pipeline worker (Phase 6) initialises OTEL **independently** in its own process.
4. Dash0 credentials are env vars — never hardcoded.
5. Every spec involving a server-side operation references this page for error + observability handling.

### Span helper, attribute convention, and conversation correlation

- **One helper.** All spans go through `withSpan(name, { attrs }, fn)` in `lib/otel/trace.ts` (or `startManagedSpan` for spans that outlive the handler, e.g. streaming routes). Never hand-roll `startActiveSpan` + duration/status/`recordException`/`end` — the helper owns that. It records `hz.duration_ms`, sets OK/ERROR, records the exception on throw, and always ends the span.
- **`hz.*` attribute namespace.** Attribute keys come from the `HZ` constants in `lib/otel/trace.ts` — one stable, discoverable vocabulary in Dash0: `hz.conversation_id`, `hz.user_id`, `hz.turn_index`, `hz.model`, `hz.tokens.input/output`, `hz.stop_reason`, `hz.tool.name`, `hz.db.table/op/rows`, `hz.job_id`, `hz.hotel_id`, `hz.destination`, `hz.outcome`.
- **Conversation correlation.** The client mints one `conversationId` (UUID v4) per chat session and sends it with each `/api/chat` turn + `/api/assembly/:jobId` poll. The server validates it and binds `conversation_id` + `user_id` into OTEL baggage (`withCorrelation`) so **every** child span (model, tool, DB) inherits `hz.conversation_id`/`hz.user_id`. A whole conversation — turns, tool calls, LLM calls, the assembly job, its polls, any booking — is filterable as one view in Dash0 by `hz.conversation_id`.
- **Decision points as span events.** Narrated branch points (async-dispatched vs. inline assembly, no-eligible-hotels, profile persisted, snapshot over token ceiling, webhook matched/unmatched) are emitted as span `addEvent` calls so a turn's control flow is legible.
- **Span names:** `<area>.<operation>` — `chat.turn`, `chat.tool`, `anthropic.assemble`, `anthropic.session_snapshot`, `anthropic.review_synthesis`, `db.query`, `routestack.<step>`, `booking.rates`, `booking.payment_url`, `webhook.routestack`, `assembly.run`, `assembly.poll`, `apify.*`, `google.places.*`.
- **No PII in spans.** Never record conversation content, prompts, or profile fields as attributes/events. The AI SDK model call sets `experimental_telemetry.recordInputs/recordOutputs = false` — token counts + outcomes only.

## Warm error states (Phase 3 UI; see 05 / Interaction States.html)

- **Inline chat error** — concierge voice ("Hmm — I lost my footing for a second… That's on me, not you. Give me another go?") + Try-again.
- **Card-level error** — "I couldn't load this one." + Retry + Skip.
- No codes, no stack traces, no dead ends. Skeletons over spinners for cards.
- Failure scenarios covered: Anthropic (timeout / rate-limit / malformed → fail, never partial), Supabase (save failure / empty intelligence / snapshot failure / auth), Apify (zero/partial/timeout), RouteStack (unreachable / mid-flow / invalid), general UI (network loss / page load / unknown).

## Action items

- Initialise OTEL in `instrumentation.ts` (Phase 0) with the standard attributes above.
- Provide warm error components for chat + card (Phase 3).
- Anthropic/Supabase/Apify/RouteStack operations are wrapped in OTEL spans with the attributes above (use the `otel-wrap` skill).
- Malformed assembly JSON fails the request — never render a partial recommendation.
