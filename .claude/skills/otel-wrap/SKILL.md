---
name: otel-wrap
description: Wrap a server operation (Anthropic / Supabase / Apify / RouteStack) in OTEL tracing with the standard attributes from 14. Use whenever adding a server-side external call or DB query that must be observable in Dash0. Trigger - "instrument this call", "add a span", "wire OTEL for <op>".
---

# otel-wrap

One consistent way to make every server-side operation observable in Dash0, per `specs/14-error-handling.md` (Notion 14).

## When to use
Adding or reviewing any server-side Anthropic call, Supabase query, Apify run (Phase 6), or RouteStack call (Phase 7).

## Prerequisite
OTEL is initialised **once** in `instrumentation.ts` (Phase 0) — not per route/component. The worker process (Phase 6) initialises OTEL independently. All traces carry `service.name = "hotelzippo"`, `environment` (`development`/`production`), and `user_id` where available.

## Procedure
1. Wrap the operation in a span named for it (e.g. `anthropic.assemble_recommendations`, `supabase.hotel_intelligence.query`).
2. Set the standard attributes for the operation type:
   - **Anthropic:** `duration`, `model`, token counts, `success`/`failure`.
   - **Supabase:** `table`, `operation`, `duration`, `success`/`failure`.
   - **Apify:** `hotel_id`, `duration`, review count, `success`/`failure`.
   - **RouteStack:** `hotel_id`, `duration`, `success`/`failure`.
3. On error: record the exception on the span, attach a **trace ID**, set span status = error, and rethrow so the caller can produce a **warm** user-facing message (per 14) — never leak the raw error to the client, never log to the client console in production.
4. Ensure the span ends in a `finally` so duration is always recorded.

## Hard rules
- Server-side only. Dash0 credentials come from env vars (`DASH0_API_KEY`, `OTEL_EXPORTER_OTLP_ENDPOINT`) — never hardcoded.
- This is the only logging/tracing path (CLAUDE.md rule 6) — no other logging framework.

## Output
Confirm the span name, attributes set, error handling, and that the trace ID is surfaced for cross-referencing.
