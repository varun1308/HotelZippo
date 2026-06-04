-- 0001_core_tables.sql
-- HotelZippo core schema — canonical source: Notion 07 · Data Model / docs/data-model.md.
-- Hard rule: never contradict 07. Schema change → Notion first, then /specs, then here.
-- This migration creates the user-facing + reference tables. Pipeline tables (0002),
-- curation staging (0003), RLS (0004), and storage (0005) follow.

-- ---------------------------------------------------------------------------
-- users — extends Supabase Auth (auth.users). One profile row per auth user.
-- ---------------------------------------------------------------------------
create table public.users (
  id         uuid primary key references auth.users (id) on delete cascade,
  email      text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- family_profiles — one per user; collected at onboarding.
-- ---------------------------------------------------------------------------
create table public.family_profiles (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references public.users (id) on delete cascade,
  name              text,
  hometown          text,
  family_members    jsonb,                       -- spouse, kids with ages
  food_preferences  text[],                      -- e.g. {vegetarian}
  budget_tier       text check (budget_tier in ('value', 'comfort', 'luxury')),
  brand_preferences text[],                      -- e.g. {Marriott Bonvoy}
  freestyle_notes   text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index family_profiles_user_id_idx on public.family_profiles (user_id);

-- ---------------------------------------------------------------------------
-- trip_briefs — one per trip search.
-- ---------------------------------------------------------------------------
create table public.trip_briefs (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid not null references public.users (id) on delete cascade,
  destination            text check (destination in ('Phuket', 'Hong Kong', 'Singapore', 'Maldives', 'Bali')),
  travel_dates           jsonb,                  -- start, end, or travel_month
  trip_type              text,                   -- resort-anchored / city-activity / multi-city
  focus_areas            text[],
  pre_shortlisted_hotels text[],
  evaluate_only          boolean not null default false,
  created_at             timestamptz not null default now()
);
create index trip_briefs_user_id_idx on public.trip_briefs (user_id);

-- ---------------------------------------------------------------------------
-- hotels — master list of 250 (50 × 5 destinations). Populated via Publish-to-Hotels.
-- ---------------------------------------------------------------------------
create table public.hotels (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  destination     text not null check (destination in ('Phuket', 'Hong Kong', 'Singapore', 'Maldives', 'Bali')),
  area            text,                           -- neighbourhood; nullable; shown on cards
  star_rating     integer check (star_rating in (3, 4, 5)),
  brand           text,
  tripadvisor_url text,
  google_place_id text,
  images          text[],                         -- Supabase Storage hero URL(s) — see 12g
  price_tier      text check (price_tier in ('mid-range', 'luxury', 'ultra-luxury')),
  created_at      timestamptz not null default now(),
  unique (name, destination)                      -- Publish-to-Hotels upsert target
);
create index hotels_destination_idx on public.hotels (destination);

-- ---------------------------------------------------------------------------
-- hotel_intelligence — Claude-synthesised, replaced per pipeline run.
-- ---------------------------------------------------------------------------
create table public.hotel_intelligence (
  id                     uuid primary key default gen_random_uuid(),
  hotel_id               uuid not null references public.hotels (id) on delete cascade,
  rooms_summary          text,
  facilities_summary     text,
  food_summary           text,
  location_summary       text,
  hard_flags             jsonb not null default '[]'::jsonb,   -- array of {category, description, severity}
  conflicting_signals    jsonb,
  family_signal_strength jsonb,                   -- per category: strong | thin | none
  supporting_phrases     jsonb,
  indian_food_signal     text,
  review_count_family    integer not null default 0,
  review_count_total     integer not null default 0,
  last_refreshed         timestamptz,
  low_confidence         boolean not null default false,
  unique (hotel_id)                               -- seed/pipeline upsert target
);

-- ---------------------------------------------------------------------------
-- sessions — conversation snapshots for memory (Phase 5).
-- ---------------------------------------------------------------------------
create table public.sessions (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.users (id) on delete cascade,
  session_summary text,
  last_active     timestamptz not null default now(),
  trip_brief_id   uuid references public.trip_briefs (id) on delete set null
);
create index sessions_user_id_idx on public.sessions (user_id);

-- ---------------------------------------------------------------------------
-- shortlists — saved hotel shortlists.
-- ---------------------------------------------------------------------------
create table public.shortlists (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.users (id) on delete cascade,
  trip_brief_id uuid references public.trip_briefs (id) on delete set null,
  hotel_ids     uuid[] not null default '{}',
  share_token   text unique,
  created_at    timestamptz not null default now()
);
create index shortlists_user_id_idx on public.shortlists (user_id);

-- ---------------------------------------------------------------------------
-- Keep family_profiles.updated_at fresh.
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger family_profiles_set_updated_at
  before update on public.family_profiles
  for each row execute function public.set_updated_at();
