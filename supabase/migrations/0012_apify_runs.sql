-- 0012_apify_runs.sql
-- WHAT: New table public.apify_runs — a durable ledger of Apify actor runs. One row per run.
-- WHY: An Apify run is the expensive, slow, externally-stateful part of curation + review
--   intelligence. Today runs are fire-and-forget (sync run-sync-get-dataset-items): a failure
--   AFTER Apify finishes loses paid data, there is no history, no reuse of an already-completed
--   run, and no refresh. Persisting the Apify run id + dataset id the moment a run starts lets us
--   re-pull a succeeded run's dataset for free (it persists on Apify), recover crashed ingestions,
--   show run history, and refresh deliberately. See specs/12h-apify-run-ledger.md.
-- Canonical: Notion 12h · Apify Run Ledger (+ 07 · Data Model needs this table added).

-- ---------------------------------------------------------------------------
-- apify_runs — one row per actor invocation. Status lifecycle:
--   pending → running → succeeded → ingested   (or → failed)
-- "succeeded AND ingested_at IS NULL" = a paid run we can re-pull for free (reuse + crash recovery).
-- ---------------------------------------------------------------------------
create table public.apify_runs (
  id                uuid primary key default gen_random_uuid(),
  actor_id          text not null,                       -- e.g. maxcopell~tripadvisor
  purpose           text not null
                      check (purpose in ('curation_search','ta_reviews','google_reviews')),
  scope_type        text not null check (scope_type in ('destination','hotel')),
  scope_value       text not null,                       -- 'Phuket' | a hotels.id uuid (as text)
  input             jsonb not null,                      -- the exact actor input (audit + re-run parity)
  apify_run_id      text,                                -- Apify run id (null until started)
  apify_dataset_id  text,                                -- Apify dataset id → re-pullable result handle
  status            text not null default 'pending'
                      check (status in ('pending','running','succeeded','failed','ingested')),
  item_count        integer,                             -- dataset row count once known
  ingested_at       timestamptz,                         -- when WE consumed the dataset downstream
  error             text,                                -- truncated failure detail
  cost_estimate     numeric,                             -- optional Apify-reported run cost (audit)
  started_at        timestamptz not null default now(),
  finished_at       timestamptz
);

-- History + reuse queries: "runs for this purpose+scope, newest first" and "un-ingested succeeded".
create index apify_runs_purpose_scope_idx on public.apify_runs (purpose, scope_value, started_at desc);
create index apify_runs_status_idx on public.apify_runs (status);

-- ---------------------------------------------------------------------------
-- RLS: service-role only. Enable RLS with NO client policies (the service role bypasses RLS;
-- authenticated/anon clients get zero rows). Mirrors pipeline_runs / raw_review_payloads.
-- ---------------------------------------------------------------------------
alter table public.apify_runs enable row level security;
