-- 0018_recommendation_jobs.sql
-- WHAT: New table public.recommendation_jobs — a durable ledger of recommendation-assembly jobs.
--   One row per assembly. Status lifecycle: pending → running → succeeded | failed.
-- WHY: Recommendation assembly is a slow LLM call (~14-34s) that today runs INLINE inside the
--   /api/chat turn, which on Vercel Hobby has a hard 60s wall-clock cap. A slow assembly rides that
--   cap → "Task timed out after 60 seconds", the stream drops, and the user gets nothing (no cards,
--   no error, no recovery). Persisting the assembly as a JOB lets the chat turn return immediately,
--   a worker route run the model on its OWN budget, and the client poll for staged progress + the
--   result — durable across reloads, with a reuse guard to avoid double-spend. See specs/03c-async-assembly.md.
-- Canonical: Notion 03c · Async Recommendation Assembly (+ 07 · Data Model needs this table added).

-- ---------------------------------------------------------------------------
-- recommendation_jobs — one row per assembly. The `result` jsonb holds the HYDRATED
-- recommendation-set props on success (so the client renders cards straight from the job).
-- ---------------------------------------------------------------------------
create table public.recommendation_jobs (
  id              uuid primary key default gen_random_uuid(),          -- the jobId the client polls
  user_id         uuid references public.users(id) on delete set null, -- nullable: anon/dev turns. owner-read RLS keys on this.
  trip_brief_id   uuid references public.trip_briefs(id) on delete set null,  -- nullable: links the turn's brief when available
  destination     text not null,                                       -- for display + the reuse key
  input_hash      text not null,                                       -- stable hash of {dest,trip_type,budget,food,candidate-key} → reuse/idempotency
  input           jsonb not null,                                      -- the RunAssemblyInput (family_profile + trip_brief) the worker runs — mirrors apify_runs.input
  status          text not null default 'pending'
                    check (status in ('pending','running','succeeded','failed')),
  stage           text not null default 'queued'
                    check (stage in ('queued','finding_hotels','checking_intelligence','writing','done')),
  result          jsonb,                                               -- the hydrated recommendation-set props on success
  error_kind      text                                                 -- warm error kind on failure (spec 14)
                    check (error_kind is null or error_kind in ('no_eligible_hotels','model_failed','timeout','unknown')),
  attempts        integer not null default 0,                          -- worker retry/reclaim guard (cap ~2)
  created_at      timestamptz not null default now(),
  started_at      timestamptz,                                         -- when a worker claimed it (→ running)
  finished_at     timestamptz                                          -- terminal stamp (succeeded|failed)
);

-- Reuse lookup ("a recent job for this exact input") + owner history, newest first.
create index recommendation_jobs_reuse_idx on public.recommendation_jobs (input_hash, created_at desc);
create index recommendation_jobs_user_idx on public.recommendation_jobs (user_id, created_at desc);
create index recommendation_jobs_status_idx on public.recommendation_jobs (status);

-- ---------------------------------------------------------------------------
-- RLS: OWNER-READ. The worker writes via the service role (which bypasses RLS); the client poll
-- reads its OWN job via the cookie/anon client under this policy. Mirrors the owner-only
-- auth.uid() = user_id pattern from booking_orders (0016) / 0004. No client INSERT/UPDATE/DELETE.
-- ---------------------------------------------------------------------------
alter table public.recommendation_jobs enable row level security;

create policy recommendation_jobs_owner_select on public.recommendation_jobs
  for select to authenticated using (auth.uid() = user_id);
