-- 0011_routestack_id_cache.sql
-- WHAT: Two new tables that cache stable RouteStack ids:
--   public.routestack_destinations — one row per HotelZippo destination enum value, holding the
--     RouteStack destination id + geo resolved once.
--   public.routestack_hotels — maps a RouteStack hotel id to our hotels row (provider-agnostic).
-- WHY: Repeat booking flows currently re-call RouteStack's (paid) search-destinations endpoint and
--   re-match hotels every time. Caching the stable RouteStack ids lets the server-side booking flow
--   skip that call and match hotels deterministically. Service-role only, like the other pipeline
--   tables — these are written exclusively by the server-side booking flow and never client-read.
-- Canonical: Notion 07 · Data Model (needs routestack_destinations + routestack_hotels added there —
--   see handoff note).

-- ---------------------------------------------------------------------------
-- routestack_destinations — one row per HotelZippo destination enum value.
-- ---------------------------------------------------------------------------
create table public.routestack_destinations (
  -- Rollout destination set updated by 0017_rollout_destinations (fresh resets get the new list here;
  -- 0017 covers already-applied DBs). Old set was Phuket/Hong Kong/Singapore/Maldives/Bali.
  destination        text primary key
                       check (destination in ('Phuket','Singapore','Tokyo','Orlando','Bali')),
  rs_destination_id   text not null,
  rs_destination_type text,                         -- e.g. 'State' | 'City'; nullable
  lat                 double precision not null,
  long                double precision not null,
  resolved_at         timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- routestack_hotels — maps a RouteStack hotel id to our hotels row.
-- provider is part of the PK so a future multi-provider world can cache more than one mapping.
-- ---------------------------------------------------------------------------
create table public.routestack_hotels (
  hotel_id      uuid not null references public.hotels (id) on delete cascade,
  provider      text not null default 'routestack',
  rs_hotel_id   text not null,
  rs_hotel_name text,                               -- the name RouteStack matched, for audit/drift; nullable
  resolved_at   timestamptz not null default now(),
  primary key (hotel_id, provider)
);
create index routestack_hotels_rs_id_idx on public.routestack_hotels (rs_hotel_id);

-- ---------------------------------------------------------------------------
-- RLS: service-role only. Enable RLS with NO client policies (the service role
-- bypasses RLS; authenticated/anon clients get zero rows). Mirrors raw_reviews
-- in 0004_rls_policies.sql and raw_review_payloads in 0009.
-- ---------------------------------------------------------------------------
alter table public.routestack_destinations enable row level security;
alter table public.routestack_hotels enable row level security;
