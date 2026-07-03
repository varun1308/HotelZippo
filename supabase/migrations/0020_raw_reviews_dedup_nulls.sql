-- 0020_raw_reviews_dedup_nulls.sql
-- Fix raw_reviews dedup for NULL key parts (spec 02 TC-P5; review finding M19).
--
-- The original raw_reviews_dedup index on (hotel_id, source, reviewer_name, review_date) was
-- NULLS-DISTINCT (Postgres default), so any review missing reviewer_name and/or review_date
-- re-inserted as a NEW row on every pipeline re-run — unbounded duplicates for undated /
-- anonymous reviews. Simply flipping to NULLS NOT DISTINCT would over-correct the other way:
-- ALL distinct anonymous+undated reviews would collapse into one row.
--
-- Fix (kept in lockstep with lib/review-intelligence/store.ts::rawReviewDedupKey):
--   1. anon_text_hash — a STORED generated column: md5(review_text) ONLY when BOTH
--      reviewer_name and review_date are null, else ''. Plain (non-expression) columns keep
--      the index inferrable by PostgREST's ON CONFLICT (…) DO NOTHING upsert.
--   2. Recreate raw_reviews_dedup as UNIQUE … NULLS NOT DISTINCT (PG15+ syntax; local stack
--      runs PG17 per supabase/config.toml) over the 5 columns.
--   3. Before indexing, delete rows that are duplicates under the NEW key, keeping the
--      earliest-scraped row (ties broken by id) so re-synthesis inputs stay stable.

-- 1) Generated disambiguator for anonymous+undated reviews (immutable expression only).
alter table public.raw_reviews
  add column if not exists anon_text_hash text
    generated always as (
      case
        when reviewer_name is null and review_date is null then md5(coalesce(review_text, ''))
        else ''
      end
    ) stored;

-- 3) Dedupe existing rows under the new key. PARTITION BY groups NULLs together, matching the
--    NULLS NOT DISTINCT semantics of the index created below.
with ranked as (
  select id,
         row_number() over (
           partition by hotel_id, source, reviewer_name, review_date, anon_text_hash
           order by scraped_at asc, id asc
         ) as rn
  from public.raw_reviews
)
delete from public.raw_reviews r
using ranked
where r.id = ranked.id
  and ranked.rn > 1;

-- 2) Replace the dedup index: NULLS NOT DISTINCT so null-keyed reviews dedup across runs.
drop index if exists public.raw_reviews_dedup;
create unique index raw_reviews_dedup
  on public.raw_reviews (hotel_id, source, reviewer_name, review_date, anon_text_hash)
  nulls not distinct;
