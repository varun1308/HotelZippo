-- 0013_hotel_source_tier.sql
-- Provenance tier on public.hotels (12i · Preview Destinations). Distinguishes:
--   'curated' (default) = Apify-curated + review-intelligence-backed (the showcase tier, Phuket today)
--   'preview'           = Claude-proposed + RouteStack-VERIFIED, with NO hotel_intelligence row,
--                         surfaced with an honest "preview — bookable now, review intelligence
--                         coming soon" label. Gives multi-destination completeness without Apify and
--                         without fabricating review intelligence.
-- The recommendation consumption query (lib/review-intelligence/query.ts) keeps excluding
-- low_confidence; preview hotels are NOT hidden — they're distinguished by `source` and simply have
-- no hotel_intelligence joined. Existing rows default to 'curated' (no backfill needed).
-- Canonical: Notion 07 · Data Model + Notion 12i. No RLS change (hotels is already read-only-for-auth).

alter table public.hotels
  add column source text not null default 'curated'
    check (source in ('curated', 'preview'));
