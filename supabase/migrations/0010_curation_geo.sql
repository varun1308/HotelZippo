-- 0010_curation_geo.sql
-- Geo fields on curation_hotels (12a). The TripAdvisor search actor returns latitude/longitude/
-- address per hotel; we persist them so the Google Place-ID resolver can lat/long-bias its
-- Text Search match (strongest matching key) and so the founder can eyeball matches in the admin
-- UI. Curation-time matching inputs only — NOT added to public.hotels (the pipeline needs only
-- google_place_id there). Service-role only (no RLS change). Canonical: Notion 07.

alter table public.curation_hotels
  add column latitude  double precision,
  add column longitude double precision,
  add column address   text;
