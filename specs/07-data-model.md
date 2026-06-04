# 07 · Data Model

- **Notion:** https://app.notion.com/p/3754958429ac81e98e81f645ade28f0a
- **Phase:** 1 · **Status:** specced
- **Canonical reference:** this page is authoritative. The full table-by-table schema + RLS plan lives in [`docs/data-model.md`](../docs/data-model.md). This contract restates the build obligations.

**Hard rule:** never contradict 07 in any spec or code. Schema change → update Notion 07 first, then this file, then code.

## Scope

10 core tables: `users`, `family_profiles`, `trip_briefs`, `hotels`, `raw_reviews`, `hotel_intelligence`, `sessions`, `shortlists`, `pipeline_runs`, `pipeline_run_hotels`. Plus `curation_hotels` staging (not in the core 10).

Authoritative details (columns, types, indexes, SQL for pipeline + curation tables) are in `docs/data-model.md` and must match Notion 07 exactly.

## Key invariants

- `hotels.star_rating` ∈ {3, 4, 5}.
- `hotels.price_tier` ∈ {mid-range, luxury, ultra-luxury}.
- `hotels.area` is nullable (card shows destination only when null).
- `raw_reviews` is permanently accumulated; deduped via `UNIQUE (hotel_id, source, reviewer_name, review_date)`; carries `pipeline_run_id`.
- `hotel_intelligence.low_confidence` defaults `false`; `true` suppresses the hotel from recommendations.
- Only one active pipeline run: `one_active_run` partial unique index.

## RLS plan

- Owner-only (`auth.uid() = user_id`): `family_profiles`, `trip_briefs`, `sessions`, `shortlists`.
- Read-only for authenticated users: `hotels`, `hotel_intelligence`.
- Service-role/admin only: `raw_reviews`, `pipeline_runs`, `pipeline_run_hotels`, `curation_hotels`.

## Action items (from Notion)

1. Generate the canonical migration from this model into Supabase migration files (see `docs/data-model.md` → Migration plan: `0001`–`0005`).
2. Treat Notion 07 as authoritative; schema change → Notion first.
3. Each table ships a Zod schema (`/lib/db/schemas/`) + a contract test.
4. Implement + verify RLS: **user A cannot read user B's data** (Phase 1 acceptance).

## Migrations (Phase 1) — BUILT (phase-1-schema)

`0001_core_tables.sql` · `0002_pipeline_tables.sql` · `0003_curation_staging.sql` · `0004_rls_policies.sql` · `0005_storage.sql` (hotel-images bucket per 12g) — live in `supabase/migrations/`. The pipeline tables' **schema** is created in Phase 1 (so the model is complete + validatable); the **worker** that writes them is built in Phase 6.

Zod schemas per table: `lib/db/schemas.ts`. Client factories: `lib/db/client.ts` (browser, anon, RLS-enforced) + `lib/db/server.ts` (service role, `server-only`-guarded). Gate tests: `tests/integration/rls.test.ts` (cross-user isolation) + `tests/integration/schema.test.ts` (all 10 tables + Zod contract), run against local Supabase via the CLI.
