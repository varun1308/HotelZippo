-- 0006_users_auth_trigger.sql
-- Populate public.users on first sign-in via a trigger on auth.users (Phase 4 · 04-auth-persistence).
-- A public.users row must exist before any owner-scoped insert (family_profiles/trip_briefs/sessions/shortlists FK to it).

-- security definer + a fixed search_path: the trigger fires in the auth schema context, so it must run
-- with the function owner's privileges to insert into public.users (clients have no insert policy on it).
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.users (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;          -- idempotent: re-sign-in must not error; created_at uses its default
  return new;
end;
$$;

-- A trigger cannot be create-or-replace, so drop-if-exists keeps this migration safe to re-run.
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
