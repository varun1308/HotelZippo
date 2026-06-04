-- 0003_curation_staging.sql
-- curation_hotels — staging table used only by the Hotel Curation Tool (12a).
-- NOT part of the core 10. Stages fetched/curated candidates until
-- Publish-to-Hotels upserts approved rows into public.hotels. Canonical: Notion 07.

create table public.curation_hotels (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  destination      text not null,
  tripadvisor_url  text,
  tripadvisor_rank integer,
  review_count     integer,
  google_place_id  text,
  brand            text,
  price_tier       text,
  star_rating      integer,
  images           text[],
  status           text not null default 'pending',  -- pending | approved | rejected
  fetch_source     text,                              -- apify | playwright | manual
  fetched_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index curation_hotels_destination_idx on public.curation_hotels (destination);
create index curation_hotels_status_idx on public.curation_hotels (status);

create trigger curation_hotels_set_updated_at
  before update on public.curation_hotels
  for each row execute function public.set_updated_at();
