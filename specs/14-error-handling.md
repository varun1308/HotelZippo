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
