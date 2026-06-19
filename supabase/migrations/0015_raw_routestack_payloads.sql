-- 0015_raw_routestack_payloads.sql
-- WHAT: New table public.raw_routestack_payloads — an append-only debug log of RouteStack
--   API calls: one row per call, holding the (redacted) request/response bodies, the RouteStack
--   envelope success/code flags, latency, error, the provider-side hotel id, and the OTEL trace id.
-- WHY: The booking flow's RouteStack integration is a multi-step session against a paid provider
--   with an opaque error-code envelope (e.g. 204/5148/5034). When a live flow misbehaves we need to
--   see exactly what we sent and what came back — without re-running (and re-paying for) the call.
--   This table captures that for debugging/replay. Tokens/secrets/PII are stripped at the app layer
--   BEFORE insert, so request/response here are already redacted. The app only writes here when
--   ROUTESTACK_DEBUG_PAYLOADS=1 (off by default). Service-role only, like raw_reviews /
--   raw_review_payloads / the routestack_* cache tables.
-- RETENTION: operator-managed — this migration adds NO automatic cleanup/TTL. The created_at index
--   exists to support manual/operator TTL-cleanup and recent-first reads.
-- NOTE: hotel_id is RouteStack's id STRING, intentionally NOT a uuid FK to public.hotels — these are
--   raw provider-side ids and this debug log must survive even when no hotels row exists.
-- Canonical: Notion 07 · Data Model (needs raw_routestack_payloads added there — see handoff note).

-- ---------------------------------------------------------------------------
-- raw_routestack_payloads — append-only debug log of RouteStack API calls.
-- ---------------------------------------------------------------------------
create table public.raw_routestack_payloads (
  id          uuid primary key default gen_random_uuid(),
  step        text not null,                 -- which call: search_destinations | search_hotels | get_hotel_details_and_rates | revalidate | get_payment_url
  path        text not null,                 -- the RouteStack endpoint path, e.g. '/mcp/hotel/search-hotels'
  request     jsonb,                          -- REDACTED request body (tokens/secrets/PII stripped at app layer); nullable
  response    jsonb,                          -- REDACTED response body; nullable
  success     boolean,                        -- RouteStack envelope success flag; nullable (unknown on transport failure)
  code        integer,                        -- RouteStack envelope error code (e.g. 204/5148/5034); nullable
  duration_ms integer,                        -- call latency in ms; nullable
  error       text,                           -- error message on failure; nullable
  hotel_id    text,                           -- RouteStack hotel id string (NOT a uuid FK); nullable
  trace_id    text,                           -- OTEL trace id to correlate with traces; nullable
  created_at  timestamptz not null default now()
);
-- Append-only: every call is logged and duplicates are expected/fine, so there is NO dedup/unique
-- index (unlike raw_review_payloads). Indexes support TTL/cleanup + recent-first reads, and filtering
-- the log by which RouteStack call it was.
create index raw_routestack_payloads_created_at_idx on public.raw_routestack_payloads (created_at);
create index raw_routestack_payloads_step_idx on public.raw_routestack_payloads (step);

-- ---------------------------------------------------------------------------
-- RLS: service-role only. Enable RLS with NO client policies (the service role
-- bypasses RLS; authenticated/anon clients get zero rows). Mirrors raw_reviews
-- in 0004_rls_policies.sql, raw_review_payloads in 0009, and routestack_* in 0011.
-- ---------------------------------------------------------------------------
alter table public.raw_routestack_payloads enable row level security;
