-- 0004_rls_policies.sql
-- Row-Level Security per docs/data-model.md (canonical: Notion 07).
--   Owner-only      : family_profiles, trip_briefs, sessions, shortlists (auth.uid() = user_id)
--   Read-only auth  : hotels, hotel_intelligence (any authenticated user; no client writes)
--   Service-role    : users, raw_reviews, pipeline_runs, pipeline_run_hotels, curation_hotels
--                     (RLS on, no client policies — the service role bypasses RLS)
-- Phase 1 gate: user A cannot read user B's owner-scoped rows.

-- Enable RLS on every table.
alter table public.users               enable row level security;
alter table public.family_profiles     enable row level security;
alter table public.trip_briefs         enable row level security;
alter table public.hotels              enable row level security;
alter table public.hotel_intelligence  enable row level security;
alter table public.sessions            enable row level security;
alter table public.shortlists          enable row level security;
alter table public.raw_reviews         enable row level security;
alter table public.pipeline_runs       enable row level security;
alter table public.pipeline_run_hotels enable row level security;
alter table public.curation_hotels     enable row level security;

-- ---------------------------------------------------------------------------
-- users — a user may read/update only their own profile row.
-- (Row creation is handled server-side / by an auth trigger, not by clients.)
-- ---------------------------------------------------------------------------
create policy users_select_own on public.users
  for select to authenticated using (auth.uid() = id);
create policy users_update_own on public.users
  for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);

-- ---------------------------------------------------------------------------
-- Owner-only tables: full CRUD scoped to auth.uid() = user_id.
-- ---------------------------------------------------------------------------
create policy family_profiles_owner on public.family_profiles
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy trip_briefs_owner on public.trip_briefs
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy sessions_owner on public.sessions
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy shortlists_owner on public.shortlists
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Reference data: any authenticated user may read; no client write policy.
-- ---------------------------------------------------------------------------
create policy hotels_read on public.hotels
  for select to authenticated using (true);

create policy hotel_intelligence_read on public.hotel_intelligence
  for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- Service-role-only tables: RLS enabled, NO policies for authenticated/anon.
-- The service role bypasses RLS; clients get zero rows. (users handled above;
-- raw_reviews / pipeline_* / curation_hotels intentionally have no client policy.)
-- ---------------------------------------------------------------------------
