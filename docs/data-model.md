# Data Model

> Derived from Notion **07 · Data Model** (canonical single source of truth). **Hard rule:** never contradict 07 in any spec or code. If a schema change is needed, update Notion 07 **first**, then `/specs/07-data-model.md`, then code. The canonical migration is also detailed in `/specs/07-data-model.md`.

The core model is **10 tables**. `curation_hotels` is a **staging** table used only by the curation tool and is *not* counted in the core 10.

## Core tables (10)

### `users` — managed by Supabase Auth
| Column | Type | Notes |
|---|---|---|
| id | uuid | Supabase Auth user ID |
| email | text | From Google OAuth |
| created_at | timestamp | |

### `family_profiles` — one per user
| Column | Type | Notes |
|---|---|---|
| id | uuid | |
| user_id | uuid | FK → users |
| name | text | |
| hometown | text | |
| family_members | jsonb | Spouse, kids with ages |
| food_preferences | text[] | e.g. `["vegetarian"]` |
| budget_tier | text | value / comfort / luxury |
| brand_preferences | text[] | e.g. `["Marriott Bonvoy"]` |
| freestyle_notes | text | User's own words |
| created_at | timestamp | |
| updated_at | timestamp | |

### `trip_briefs` — one per trip search
| Column | Type | Notes |
|---|---|---|
| id | uuid | |
| user_id | uuid | FK → users |
| destination | text | Phuket / Hong Kong / Singapore / Maldives / Bali |
| travel_dates | jsonb | start, end, or travel_month |
| trip_type | text | resort-anchored / adventure / relaxing etc. |
| focus_areas | text[] | What the user wants prioritised |
| pre_shortlisted_hotels | text[] | Optional hotel names |
| evaluate_only | boolean | True = evaluate shortlist only |
| created_at | timestamp | |

### `hotels` — master list of 250 (50 × 5 destinations)
Populated via the Hotel Curation Tool (12a) → **Publish to Hotels** (direct upsert; no CSV).
| Column | Type | Notes |
|---|---|---|
| id | uuid | |
| name | text | |
| destination | text | one of the 5 |
| area | text (nullable) | Neighbourhood within destination (e.g. "Karon Beach"); shown on cards; populated during curation |
| star_rating | integer | **3, 4, or 5** |
| brand | text | e.g. Marriott, Hilton, or independent |
| tripadvisor_url | text | For scraping |
| google_place_id | text | For scraping |
| images | text[] | Real hotel image(s); v1 stores the TripAdvisor hero (see 12g) |
| price_tier | text | mid-range / luxury / ultra-luxury |
| created_at | timestamp | |

### `raw_reviews` — permanently accumulated; never deleted
Deduplicated across runs; carries `pipeline_run_id`. The 12-month recency filter applies at *synthesis*, not at storage.
| Column | Type | Notes |
|---|---|---|
| id | uuid | |
| hotel_id | uuid | FK → hotels |
| pipeline_run_id | uuid | FK → pipeline_runs |
| source | text | tripadvisor / google |
| review_date | date | |
| reviewer_name | text | |
| review_text | text | |
| rating | integer | |
| is_family | boolean | Tagged by pipeline |
| is_indian | boolean | Tagged by pipeline |
| scraped_at | timestamp | |

Dedup index: `UNIQUE (hotel_id, source, reviewer_name, review_date)`.

### `hotel_intelligence` — Claude-synthesised; replaced per pipeline run
| Column | Type | Notes |
|---|---|---|
| id | uuid | |
| hotel_id | uuid | FK → hotels |
| rooms_summary | text | |
| facilities_summary | text | |
| food_summary | text | |
| location_summary | text | |
| hard_flags | jsonb | Array of flag objects (description + severity) |
| conflicting_signals | jsonb | Category → percentage breakdown |
| family_signal_strength | jsonb | Per category: strong / thin / none |
| supporting_phrases | jsonb | Per category: array of reviewer phrases |
| indian_food_signal | text | Indian / vegetarian food signal |
| review_count_family | integer | |
| review_count_total | integer | |
| last_refreshed | timestamp | |
| low_confidence | boolean | default false; true → suppress from Conversation Agent recommendations |

### `sessions` — conversation snapshots for memory
| Column | Type | Notes |
|---|---|---|
| id | uuid | |
| user_id | uuid | FK → users |
| session_summary | text | Compressed context for resumption |
| last_active | timestamp | |
| trip_brief_id | uuid | FK → trip_briefs if in progress |

### `shortlists` — saved hotel shortlists
| Column | Type | Notes |
|---|---|---|
| id | uuid | |
| user_id | uuid | FK → users |
| trip_brief_id | uuid | FK → trip_briefs |
| hotel_ids | uuid[] | |
| share_token | text | For share link generation |
| created_at | timestamp | |

### `pipeline_runs` (Phase 6)
```sql
CREATE TABLE pipeline_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_type text NOT NULL,                 -- 'destination' | 'hotel'
  scope_value text NOT NULL,
  status text NOT NULL DEFAULT 'running',   -- running | complete | failed
  hotels_total int, hotels_complete int DEFAULT 0, hotels_failed int DEFAULT 0,
  started_at timestamptz DEFAULT now(), finished_at timestamptz
);
CREATE UNIQUE INDEX one_active_run ON pipeline_runs ((status='running')) WHERE status='running';
```

### `pipeline_run_hotels` (Phase 6)
```sql
CREATE TABLE pipeline_run_hotels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid REFERENCES pipeline_runs(id),
  hotel_id uuid REFERENCES hotels(id),
  status text NOT NULL DEFAULT 'pending',   -- pending|scraping|processing|synthesising|complete|failed
  error_reason text, reviews_scraped int,
  started_at timestamptz, finished_at timestamptz
);
```

## Staging table (NOT part of the core 10)

### `curation_hotels` — used only by the Curation Tool (12a)
Stages fetched + curated candidates until **Publish to Hotels** upserts approved rows into `hotels`. Keeps the live `hotels` table clean during in-progress curation.
```sql
curation_hotels (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  destination       text not null,
  tripadvisor_url   text,
  tripadvisor_rank  integer,
  review_count      integer,
  google_place_id   text,
  brand             text,
  price_tier        text,
  star_rating       integer,
  images            text[],
  status            text not null default 'pending',  -- pending | approved | rejected
  fetch_source      text,                              -- apify | playwright | manual
  fetched_at        timestamptz default now(),
  updated_at        timestamptz default now()
)
```

## Row-Level Security plan

| Table | Policy |
|---|---|
| `family_profiles`, `trip_briefs`, `sessions`, `shortlists` | Owner-only: `auth.uid() = user_id`. Each user reads/writes only their own rows. |
| `hotels`, `hotel_intelligence` | Read-only reference data for **authenticated** users. No client writes. |
| `raw_reviews`, `pipeline_runs`, `pipeline_run_hotels`, `curation_hotels` | **Service-role / admin only** — never client-readable. |

RLS verification (Phase 1 acceptance, 15): **user A cannot read user B's data** in any owner-scoped table — tested in `db-migrator`'s isolation test.

## Migration plan (Phase 1)

1. `0001_core_tables.sql` — `users`, `family_profiles`, `trip_briefs`, `hotels` (incl. `area`), `hotel_intelligence` (incl. `low_confidence`), `sessions`, `shortlists`.
2. `0002_pipeline_tables.sql` — `pipeline_runs`, `pipeline_run_hotels`, `raw_reviews` (incl. `pipeline_run_id`), dedup + `one_active_run` indexes. *(Schema created in Phase 1 so the model is complete and Zod-validatable; the worker that uses them is built at Phase 6.)*
3. `0003_curation_staging.sql` — `curation_hotels`.
4. `0004_rls_policies.sql` — enable RLS + policies per the table above.
5. `0005_storage.sql` / dashboard — `hotel-images` Storage bucket (public-read) per 12g.

Each table ships a Zod schema in `/lib/db/schemas/` and a contract test (Phase 1 acceptance: all 10 tables schema-valid).
