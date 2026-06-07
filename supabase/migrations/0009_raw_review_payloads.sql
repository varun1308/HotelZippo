-- 0009_raw_review_payloads.sql
-- WHAT: New table public.raw_review_payloads — persists the ORIGINAL, untouched Apify actor
--   dataset items (the full review-scrape payloads), one row per actor item.
-- WHY: The review pipeline's mapper currently keeps only 5 mapped fields per review (→ raw_reviews)
--   and DISCARDS the rich actor payload. Storing the raw items lets us re-run review mappings later
--   WITHOUT a (paid) re-scrape. Founder decision: a SEPARATE lean table (not a jsonb column on
--   raw_reviews, not Storage), so raw_reviews stays slim. Service-role only, like raw_reviews.
-- Canonical: Notion 07 · Data Model (needs raw_review_payloads added there — see handoff note).

-- ---------------------------------------------------------------------------
-- raw_review_payloads — permanently accumulated original actor dataset items.
-- ---------------------------------------------------------------------------
create table public.raw_review_payloads (
  id              uuid primary key default gen_random_uuid(),
  hotel_id        uuid not null references public.hotels (id) on delete cascade,
  pipeline_run_id uuid references public.pipeline_runs (id) on delete set null,
  source          text not null,                 -- tripadvisor | google
  external_id     text,                          -- actor item's own id (e.g. TripAdvisor review id) for dedup; nullable
  payload         jsonb not null,                -- the untouched actor dataset item
  scraped_at      timestamptz not null default now()
);
-- Dedup: one row per (hotel, source, external_id) so re-running a hotel doesn't bloat the table.
-- NULL external_id rows do NOT dedup — Postgres treats NULLs as distinct in a unique index — which
-- is acceptable (mirrors the raw_reviews_dedup NULL behavior documented in lib/review-intelligence/store.ts).
create unique index raw_review_payloads_dedup on public.raw_review_payloads (hotel_id, source, external_id);
create index raw_review_payloads_hotel_id_idx on public.raw_review_payloads (hotel_id);
create index raw_review_payloads_pipeline_run_id_idx on public.raw_review_payloads (pipeline_run_id);

-- ---------------------------------------------------------------------------
-- RLS: service-role only. Enable RLS with NO client policies (the service role
-- bypasses RLS; authenticated/anon clients get zero rows). Mirrors raw_reviews
-- in 0004_rls_policies.sql.
-- ---------------------------------------------------------------------------
alter table public.raw_review_payloads enable row level security;
