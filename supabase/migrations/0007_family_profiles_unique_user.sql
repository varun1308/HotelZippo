-- 0007_family_profiles_unique_user.sql
-- Enforce the documented "one family_profile per user" invariant (Notion 07 / 04-auth-persistence Stage 4),
-- so the persistence layer can upsert(..., { onConflict: 'user_id' }) — ON CONFLICT (user_id) needs this.

-- A unique index satisfies ON CONFLICT (user_id) and is idempotent (if not exists) → safe to re-run.
-- Note: fails if duplicate user_id rows already exist; on a dev DB this should be clean (do not delete data to force it).
create unique index if not exists family_profiles_user_id_key on public.family_profiles (user_id);

-- The non-unique index from 0001 is now redundant (same single column, covered by the unique index above) → drop it.
drop index if exists family_profiles_user_id_idx;
