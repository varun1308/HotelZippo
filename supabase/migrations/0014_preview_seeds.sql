-- 0014_preview_seeds.sql
-- Per-destination latch for ON-THE-FLY preview seeding from chat (12i-C). One row per HotelZippo
-- destination that has been (or is being) runtime-seeded. Purpose:
--   * seed-once: status='done' → NEVER re-seed at runtime (cost capped to ~5 seeds, ever).
--   * concurrency guard: status='running' → a second concurrent request gets "in_progress", not a
--     second paid seed.
-- This is a lightweight latch, NOT a run ledger (cf. apify_runs 0012). Service-role only — written
-- exclusively by the server-side runtime-seed path, never client-read. Canonical: Notion 07 + 12i.

create table public.preview_seeds (
  -- Rollout destination set updated by 0017_rollout_destinations (fresh resets get the new list here;
  -- 0017 covers already-applied DBs). Old set was Phuket/Hong Kong/Singapore/Maldives/Bali.
  destination   text primary key
                  check (destination in ('Phuket', 'Singapore', 'Tokyo', 'Orlando', 'Bali')),
  status        text not null default 'running'
                  check (status in ('running', 'done', 'failed')),
  hotel_count   integer,
  error         text,
  started_at    timestamptz not null default now(),
  finished_at   timestamptz
);

alter table public.preview_seeds enable row level security;  -- no policies; service-role only
