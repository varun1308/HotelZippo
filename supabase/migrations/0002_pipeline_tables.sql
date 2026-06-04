-- 0002_pipeline_tables.sql
-- Review Intelligence pipeline tables. SCHEMA created now (Phase 1) so the data
-- model is complete + Zod-validatable; the WORKER that writes them is built at
-- Phase 6 (specs/02-review-intelligence-pipeline.md). Canonical: Notion 07.

-- ---------------------------------------------------------------------------
-- pipeline_runs — run tracking for the Review Intelligence pipeline.
-- ---------------------------------------------------------------------------
create table public.pipeline_runs (
  id              uuid primary key default gen_random_uuid(),
  scope_type      text not null,                 -- 'destination' | 'hotel'
  scope_value     text not null,
  status          text not null default 'running', -- running | complete | failed
  hotels_total    integer,
  hotels_complete integer not null default 0,
  hotels_failed   integer not null default 0,
  started_at      timestamptz not null default now(),
  finished_at     timestamptz
);
-- At most one active run at a time.
create unique index one_active_run on public.pipeline_runs ((status = 'running')) where status = 'running';

-- ---------------------------------------------------------------------------
-- pipeline_run_hotels — per-hotel status within a run.
-- ---------------------------------------------------------------------------
create table public.pipeline_run_hotels (
  id              uuid primary key default gen_random_uuid(),
  run_id          uuid references public.pipeline_runs (id) on delete cascade,
  hotel_id        uuid references public.hotels (id) on delete cascade,
  status          text not null default 'pending', -- pending|scraping|processing|synthesising|complete|failed
  error_reason    text,
  reviews_scraped integer,
  started_at      timestamptz,
  finished_at     timestamptz
);
create index pipeline_run_hotels_run_id_idx on public.pipeline_run_hotels (run_id);

-- ---------------------------------------------------------------------------
-- raw_reviews — permanently accumulated; never deleted; deduped across runs.
-- The 12-month recency filter applies at synthesis, not at storage.
-- ---------------------------------------------------------------------------
create table public.raw_reviews (
  id              uuid primary key default gen_random_uuid(),
  hotel_id        uuid not null references public.hotels (id) on delete cascade,
  pipeline_run_id uuid references public.pipeline_runs (id) on delete set null,
  source          text not null,                 -- tripadvisor | google
  review_date     date,
  reviewer_name   text,
  review_text     text,
  rating          integer,
  is_family       boolean,
  is_indian       boolean,
  scraped_at      timestamptz not null default now()
);
-- Dedup: one row per (hotel, source, reviewer, date).
create unique index raw_reviews_dedup on public.raw_reviews (hotel_id, source, reviewer_name, review_date);
create index raw_reviews_hotel_id_idx on public.raw_reviews (hotel_id);
