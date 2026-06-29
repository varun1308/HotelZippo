# 07 · Data Model

- **Notion:** https://app.notion.com/p/3754958429ac81e98e81f645ade28f0a
- **Phase:** 1 · **Status:** specced
- **Canonical reference:** this page is authoritative. The full table-by-table schema + RLS plan lives in [`docs/data-model.md`](../docs/data-model.md). This contract restates the build obligations.

**Hard rule:** never contradict 07 in any spec or code. Schema change → update Notion 07 first, then this file, then code.

## Scope

10 core tables: `users`, `family_profiles`, `trip_briefs`, `hotels`, `raw_reviews`, `hotel_intelligence`, `sessions`, `shortlists`, `pipeline_runs`, `pipeline_run_hotels`. Plus `curation_hotels` staging (not in the core 10), `raw_review_payloads` (migration 0009 — original untouched Apify actor items, for re-mapping without a re-scrape), the RouteStack id-cache tables `routestack_destinations` + `routestack_hotels` (migration 0011 — cache the stable RouteStack destination/hotel ids for the booking flow), and `apify_runs` (migration 0012 — the Apify run ledger: one row per actor run, so an expensive run is recoverable/re-pullable/refreshable; see 12h).

Authoritative details (columns, types, indexes, SQL for pipeline + curation tables) are in `docs/data-model.md` and must match Notion 07 exactly.

## Key invariants

- `hotels.star_rating` ∈ {3, 4, 5}.
- `hotels.price_tier` ∈ {mid-range, luxury, ultra-luxury}.
- `hotels.source` ∈ {curated, preview} (migration `0013`, default `curated`). `curated` = Apify-curated + review-intelligence-backed (showcase tier); `preview` = Claude-proposed + RouteStack-verified, **no `hotel_intelligence` row**, surfaced with an honest "preview" label. See **12i · Preview Destinations**.
- `hotels.area` is nullable (card shows destination only when null).
- `raw_reviews` is permanently accumulated; deduped via `UNIQUE (hotel_id, source, reviewer_name, review_date)`; carries `pipeline_run_id`.
- `hotel_intelligence.low_confidence` defaults `false`; `true` suppresses the hotel from recommendations.
- Only one active pipeline run: `one_active_run` partial unique index.

## RLS plan

- Owner-only (`auth.uid() = user_id`): `family_profiles`, `trip_briefs`, `sessions`, `shortlists`.
- Read-only for authenticated users: `hotels`, `hotel_intelligence`.
- Service-role/admin only: `raw_reviews`, `raw_review_payloads`, `pipeline_runs`, `pipeline_run_hotels`, `curation_hotels`, `routestack_destinations`, `routestack_hotels`, `apify_runs`. (RLS enabled with **no** client policies — the service role bypasses RLS; authenticated/anon clients get zero rows.)

## Action items (from Notion)

1. Generate the canonical migration from this model into Supabase migration files (see `docs/data-model.md` → Migration plan: `0001`–`0005`).
2. Treat Notion 07 as authoritative; schema change → Notion first.
3. Each table ships a Zod schema (`/lib/db/schemas/`) + a contract test.
4. Implement + verify RLS: **user A cannot read user B's data** (Phase 1 acceptance).

## Migrations (Phase 1) — BUILT (phase-1-schema)

`0001_core_tables.sql` · `0002_pipeline_tables.sql` · `0003_curation_staging.sql` · `0004_rls_policies.sql` · `0005_storage.sql` (hotel-images bucket per 12g) — live in `supabase/migrations/`. The pipeline tables' **schema** is created in Phase 1 (so the model is complete + validatable); the **worker** that writes them is built in Phase 6.

Zod schemas per table: `lib/db/schemas.ts`. Client factories: `lib/db/client.ts` (browser, anon, RLS-enforced) + `lib/db/server.ts` (service role, `server-only`-guarded). Gate tests: `tests/integration/rls.test.ts` (cross-user isolation) + `tests/integration/schema.test.ts` (all 10 tables + Zod contract), run against local Supabase via the CLI.

## Later-phase tables (additive migrations — service-role only)

These extend the model in later phases. All are **service-role only** (RLS enabled, no client policies — mirrors `raw_reviews`). Columns mirror the migrations; see `docs/data-model.md` + Notion 07 for full detail.

- **`raw_review_payloads`** (migration `0009_raw_review_payloads.sql`, Phase 6 / review pipeline) — permanently-accumulated **original untouched Apify actor dataset items**, so review mappings can be re-run without a (paid) re-scrape (`npm run pipeline:remap`). Columns: `id` (uuid PK), `hotel_id` (→ `hotels`, cascade), `pipeline_run_id` (→ `pipeline_runs`, set null), `source` (`tripadvisor` | `google`), `external_id` (nullable, actor item id for dedup), `payload` (jsonb, the untouched item), `scraped_at`. Dedup: `UNIQUE (hotel_id, source, external_id)`.
- **`routestack_destinations`** (migration `0011_routestack_id_cache.sql`, Phase 7 / booking) — caches the **stable** RouteStack destination handle per HotelZippo destination enum value, so a repeat booking skips the paid `search-destinations` call. Columns: `destination` (text PK, `check in ('Phuket','Singapore','Tokyo','Orlando','Bali')`), `rs_destination_id` (text), `rs_destination_type` (text, nullable), `lat` / `long` (double precision), `resolved_at`.
- **`routestack_hotels`** (migration `0011_routestack_id_cache.sql`, Phase 7 / booking) — maps a RouteStack hotel id ↔ our `hotels` row for **deterministic** matching (instead of fuzzy name-matching). Columns: `hotel_id` (uuid → `hotels`, cascade), `provider` (text, default `'routestack'`), `rs_hotel_id` (text), `rs_hotel_name` (text, nullable, for audit/drift), `resolved_at`. PK `(hotel_id, provider)`; index on `rs_hotel_id`. See **10c · Booking Agent & RouteStack** for the id-cache seam (`lib/booking/id-cache.ts`).
- **`apify_runs`** (migration `0012_apify_runs.sql`, Launch / curation hardening) — the **Apify run ledger**: one row per actor invocation, decoupling "the actor ran" from "we ingested it" so an expensive run is never lost, can be re-pulled free, has history, and is refreshable. Columns: `id` (uuid PK), `actor_id`, `purpose` (`curation_search` | `ta_reviews` | `google_reviews`), `scope_type` (`destination` | `hotel`), `scope_value`, `input` (jsonb), `apify_run_id` (nullable), `apify_dataset_id` (nullable, the re-pullable handle), `status` (`pending` | `running` | `succeeded` | `failed` | `ingested`), `item_count`, `ingested_at`, `error`, `cost_estimate`, `started_at`, `finished_at`. Indexes on `(purpose, scope_value, started_at desc)` + `status`. See **12h · Apify Run Ledger**.
