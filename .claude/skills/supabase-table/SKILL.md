---
name: supabase-table
description: Given a table definition from 07 · Data Model, emit the Supabase migration, the RLS policy, a Zod schema, and a cross-user isolation test. Use when adding or changing a database table. Trigger - "create the <table> migration", "add RLS for <table>", db-migrator work.
---

# supabase-table

Turns one canonical table (from `docs/data-model.md` / Notion 07) into migration + RLS + Zod + isolation test, consistently every time.

## When to use
Creating or modifying a Supabase table for HotelZippo.

## Procedure
1. **Read the canonical definition** from `docs/data-model.md` (mirror of Notion 07). Match column names, types, nullability, and indexes **exactly**. If they disagree, Notion 07 wins — flag the drift.
2. **Migration** (`supabase/migrations/NNNN_<topic>.sql`): `CREATE TABLE`, constraints (`star_rating IN (3,4,5)`, `price_tier` check, etc.), FKs, and indexes (e.g. `raw_reviews` dedup `UNIQUE (hotel_id, source, reviewer_name, review_date)`, `one_active_run` partial unique).
3. **RLS** in the same or a paired migration, per the table's class:
   - Owner-only (`family_profiles`, `trip_briefs`, `sessions`, `shortlists`): `ENABLE ROW LEVEL SECURITY` + policies `USING (auth.uid() = user_id)` for select/insert/update/delete.
   - Read-only authenticated (`hotels`, `hotel_intelligence`): select policy `USING (auth.role() = 'authenticated')`; no client write policy.
   - Service-role only (`raw_reviews`, `pipeline_runs`, `pipeline_run_hotels`, `curation_hotels`): RLS enabled, **no** client policies (service-role bypasses RLS).
4. **Zod schema** in `/lib/db/schemas/<table>.ts` mirroring the columns (the contract-test source).
5. **Isolation test** (`/tests/integration/rls.<table>.test.ts`) for owner-only tables: seed rows for user A and user B; assert A's client cannot read/update/delete B's rows. This is the Phase 1 gate.

## Hard rules
- Service-role key is server-side only; isolation tests use **anon-key clients** authenticated as distinct users (not the service role) so RLS is actually exercised.
- Pipeline-table schema is created in Phase 1; do not build the Phase 6 worker here.

## Output
List the migration, policies, Zod schema, and test files written, and state whether the isolation test passes.
