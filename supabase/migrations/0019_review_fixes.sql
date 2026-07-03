-- 0019_review_fixes.sql
-- Verified code-review fixes (2026-07-03). Four independent hardenings:
--   (1) recommendation_jobs: conversation correlation + honest failure variants + no-double-spend.
--   (2) sessions / shortlists: enforce the documented "one row per user" invariant with unique
--       indexes (the racy select-then-insert made duplicate rows possible; duplicates make saved
--       data permanently invisible because both save and load pick a single row).
--   (3) users auth trigger: propagate auth.users email changes into public.users.
-- Canonical: Notion 07 · Data Model / specs/03c / specs/14 (needs a 07 sync — see PR notes).

-- ---------------------------------------------------------------------------
-- (1a) recommendation_jobs.conversation_id — the client-minted per-conversation correlation id
--      (specs/14). Stored at dispatch so the WORKER (a separate HTTP request with empty baggage)
--      can stamp hz.conversation_id on assembly.run and its children.
-- ---------------------------------------------------------------------------
alter table public.recommendation_jobs
  add column if not exists conversation_id text;

-- (1b) error_kind gains 'budget_mismatch' so the worker can persist the REAL assembly error
--      variant (specs/08b-2 Step 1) instead of collapsing everything into no_eligible_hotels.
--      The variant payload (reason + available_tiers) is persisted in `result` on failure.
alter table public.recommendation_jobs
  drop constraint if exists recommendation_jobs_error_kind_check;
alter table public.recommendation_jobs
  add constraint recommendation_jobs_error_kind_check
  check (error_kind is null or error_kind in ('no_eligible_hotels','budget_mismatch','model_failed','timeout','unknown'));

-- (1c) No double-spend under concurrency (03c AC5): at most ONE in-flight job per (user, input).
--      The findReusable→createJob window is a TOCTOU race; this partial unique index closes it —
--      the losing insert gets a unique violation and the code re-attaches to the winner's job.
--      NULL user_id rows are exempt (NULLs are distinct), but dispatch no longer creates those
--      (an anon job is unreadable under owner-read RLS anyway — see lib/chat/agent.ts).
create unique index if not exists recommendation_jobs_inflight_key
  on public.recommendation_jobs (user_id, input_hash)
  where status in ('pending','running');

-- ---------------------------------------------------------------------------
-- (2a) sessions — ONE rolling session per user (specs/08b-3 locked v1).
--      Dedupe first: reads pick the row with the LATEST last_active (order by last_active desc
--      limit 1), so keep that row and drop the rest.
-- ---------------------------------------------------------------------------
delete from public.sessions
where id in (
  select id from (
    select id, row_number() over (partition by user_id order by last_active desc, id) as rn
    from public.sessions
  ) ranked
  where rn > 1
);
create unique index if not exists sessions_user_id_key on public.sessions (user_id);
drop index if exists sessions_user_id_idx;  -- covered by the unique index (same single column)

-- ---------------------------------------------------------------------------
-- (2b) shortlists — ONE working shortlist per user (specs/04 Stage 4 v1).
--      Reads pick the OLDEST row (order by created_at asc limit 1), so keep that one.
-- ---------------------------------------------------------------------------
delete from public.shortlists
where id in (
  select id from (
    select id, row_number() over (partition by user_id order by created_at asc, id) as rn
    from public.shortlists
  ) ranked
  where rn > 1
);
create unique index if not exists shortlists_user_id_key on public.shortlists (user_id);
drop index if exists shortlists_user_id_idx;  -- covered by the unique index

-- ---------------------------------------------------------------------------
-- (3) users auth trigger — an email CHANGE in auth.users must propagate to public.users.
--     0006's `on conflict (id) do nothing` + INSERT-only trigger never updated the email.
--     Same security-definer + pinned search_path pattern as 0006.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.users (id, email)
  values (new.id, new.email)
  on conflict (id) do update set email = excluded.email;  -- idempotent AND email-propagating
  return new;
end;
$$;

-- Fire the same function when the auth email changes (0006 only covered INSERT).
drop trigger if exists on_auth_user_email_updated on auth.users;
create trigger on_auth_user_email_updated
  after update of email on auth.users
  for each row execute function public.handle_new_user();
