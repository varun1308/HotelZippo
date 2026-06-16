# 12h · Apify Run Ledger (durable, reusable, refreshable actor runs)

- **Notion:** https://app.notion.com/p/3814958429ac81209261c90c31c62f27 (12h · Apify Run Ledger)
- **Phase:** Launch / post-v1 hardening · **Status:** specced (authored 2026-06-16)
- **Companion:** [12a · Curation Tool](12a-curation-tool.md), [10b · Apify](10b-apify.md), [02 · Review-Intelligence Pipeline](02-review-intelligence-pipeline.md), [14 · Error Handling](14-error-handling.md).

## Problem

An Apify actor run is the **expensive, slow, externally-stateful** part of curation + review intelligence.
Today it is **fire-and-forget**: `lib/apify/client.ts` calls the synchronous
`run-sync-get-dataset-items` endpoint, which **blocks ~5 min** for the actor to finish and returns the
items **once**. Then the items are mapped into `curation_hotels` and the run itself is **forgotten** —
no run id, no dataset id, no record it happened.

Consequences:
1. **Any failure AFTER Apify finishes loses paid data** (dropped HTTP connection, a serverless function
   timeout, a mapper throw, a DB write error) → re-fetching means **paying again**.
2. **No history** — can't answer "when did we last curate Phuket, and what did it cost?"
3. **No reuse** — a run Apify already completed but we never ingested is unrecoverable without re-running.
4. **No refresh** — no first-class "re-pull this destination's data" action.
5. The ~5-min blocking call **exceeds Vercel's serverless function limit** (10–60s Hobby; 300s Pro max),
   so the admin "Fetch" button can't run reliably on a deployed app.

The dev `lib/dev/actor-cache.ts` solves *replay in dev only* (file cache, off in prod). This spec is the
**production-grade equivalent**: a durable DB-backed ledger that **decouples "the actor ran" from
"we ingested it."**

## Core idea — separate RUNNING from INGESTING

Apify's REST API supports an async lifecycle we currently bypass:

```
POST /v2/actors/<id>/runs            → starts a run, returns { id (runId), defaultDatasetId } immediately
GET  /v2/actor-runs/<runId>          → poll status: READY|RUNNING|SUCCEEDED|FAILED|TIMED-OUT|ABORTED
GET  /v2/datasets/<datasetId>/items  → pull results, repeatedly + free, any time after SUCCEEDED
```

Key fact: **once a run succeeds, its dataset persists on Apify's servers** (within Apify's retention) and
can be pulled repeatedly at no extra actor cost. So if we persist `runId` + `datasetId` the moment a run
starts, we can **always recover the data without re-running** — even days later, even if ingestion crashed.

## Schema — migration `0012_apify_runs.sql`

One row per actor invocation. Service-role only (RLS enabled, NO policies — like `pipeline_runs` /
`raw_review_payloads`). Never client-read.

```sql
create table public.apify_runs (
  id                uuid primary key default gen_random_uuid(),
  actor_id          text not null,              -- e.g. maxcopell~tripadvisor
  purpose           text not null,              -- curation_search | ta_reviews | google_reviews
  scope_type        text not null check (scope_type in ('destination','hotel')),
  scope_value       text not null,              -- 'Phuket' | a hotels.id uuid (as text)
  input             jsonb not null,             -- the exact actor input (audit + re-run parity)
  apify_run_id      text,                       -- Apify run id (null until started)
  apify_dataset_id  text,                       -- Apify dataset id → re-pullable result handle
  status            text not null default 'pending'
                    check (status in ('pending','running','succeeded','failed','ingested')),
  item_count        integer,                    -- dataset row count once known
  ingested_at       timestamptz,                -- when WE consumed it downstream
  error             text,                       -- truncated failure detail
  cost_estimate     numeric,                    -- optional Apify-reported run cost (audit)
  started_at        timestamptz not null default now(),
  finished_at       timestamptz
);
create index apify_runs_purpose_scope_idx on public.apify_runs (purpose, scope_value, started_at desc);
create index apify_runs_status_idx on public.apify_runs (status);
alter table public.apify_runs enable row level security;  -- no policies; service-role only
```

**Status lifecycle (the whole design):**

```
pending → running → succeeded → ingested
                 ↘ failed
```

- `succeeded` AND `ingested_at IS NULL` = **"paid-for, completed, never consumed"** → the reuse case.
  The dataset id is on the row; ingest replays it for **free**. Also the crash-recovery case.

## How each requirement maps to the design

1. **Seamless running** → async **start + poll**, no blocking. The request that *starts* a run returns
   in <1s (writes a `running` ledger row with `apify_run_id` + `apify_dataset_id`). The UI polls OUR
   ledger (cheap DB reads), not Apify. Solves the Vercel timeout entirely.
2. **Pull un-ingested runs to reuse** → ledger query `status='succeeded' AND ingested_at IS NULL`. UI
   shows them as **"Ready to ingest (already paid)"** with a one-click **Ingest** (pulls the persisted
   dataset by id → maps → marks `ingested`). Zero new Apify cost; recovers crashed ingestions.
3. **Track past runs** → the ledger IS the history. Admin **Runs panel** per destination: timestamp,
   actor, status, item count, ingested?, cost.
4. **Refresh in the future** → **Refresh** button = start a NEW run for the same scope. Old `ingested`
   rows stay as history; the new run supersedes on ingest. The existing `curation_hotels`
   upsert-on-(name,destination) **preserves approve/reject decisions** across re-fetches
   (see `app/api/admin/fetch-hotels/route.ts`), so refresh re-pulls live data without losing curation state.

## Reuse / cost guard — WARN, never auto-reuse (locked decision)

Before starting a run, query the ledger for a `succeeded`/`ingested` run of the same
`(purpose, scope_value, normalised input)` within a freshness window (default 7 days). If found, the UI
**warns** — "Phuket was curated 3 days ago (cost ~$X). Re-pull that dataset free, or force a fresh run?"
— but **never silently skips a run**. Every paid run is an explicit operator decision. (Generalises the
dev cache's intent to production; input normalisation reuses the volatile-key stripping idea from
`lib/dev/actor-cache.ts`.)

## Code

### `lib/apify/client.ts` — extend (do NOT remove the sync path)
- Keep `runActorGetItems` (sync `run-sync-get-dataset-items`) for the **laptop/CLI worker** path where
  there is no function timeout (the documented right tool there).
- ADD the async primitives: `startRun(opts) → { apifyRunId, apifyDatasetId }`,
  `getRunStatus(apifyRunId) → { status, itemCount?, costEstimate? }`,
  `pullDatasetItems(apifyDatasetId, { limit }) → unknown[]`. Same auth header + OTEL + error model as
  the existing client (`ApifyError` kinds).

### `lib/apify/run-ledger.ts` (new) — the ledger module
Injectable Supabase client (like `lib/db/persistence/*`):
`createRun`, `markRunning`, `markStatus`, `markIngested`, `loadRun`, `listRuns({purpose,scopeValue})`,
`findReusable({purpose, scopeValue, input, withinDays})`. Best-effort writes never break a run.

### Routes (serverless-safe — locked decision: works on Vercel OR laptop)
- `POST /api/admin/curation/run/start`   — start an actor run, create the `running` ledger row, return its id. (<1s)
- `GET  /api/admin/curation/run/status`  — poll Apify for a run, update the ledger row, return status.
- `POST /api/admin/curation/run/ingest`  — pull the dataset by id → map → upsert `curation_hotels` → mark `ingested`.
- `GET  /api/admin/curation/runs`        — list runs for a scope (history + the un-ingested reuse list).
- The existing `fetch-hotels` route is reworked to call `run/start` (or is superseded by it).

### `/admin/curation` UI
- **Fetch Hotels → Start Fetch** (non-blocking) + a live **run-status row** that polls to completion,
  then auto-offers **Ingest**.
- New **Runs history** section per destination + the **"un-ingested, ready to reuse (already paid)"** callout.
- **Refresh** button per destination.
- Reuse-guard warning before a fresh run when a recent one exists.

## Phasing (separate PRs)

| PR | Contents |
|---|---|
| **PR 1** | migration `0012`, `lib/apify/run-ledger.ts`, async primitives in `client.ts`. No UI. Unit + integration tests (ledger round-trip, status transitions, reuse query). |
| **PR 2** | wire curation to the ledger: `run/start` + `run/status` + `run/ingest` routes; UI Start/poll/Ingest + un-ingested reuse list. |
| **PR 3** | Runs history panel + Refresh + reuse-guard warning. |
| **later** | extend the ledger to the review-intelligence actors (the `purpose` column already generalises). |

## Out of scope (stated, not silently dropped)
- **Not** removing the sync `run-sync-get-dataset-items` path — correct for the laptop/CLI worker.
- **Not** caching volatile data (availability/prices) — only durable scrape datasets (same principle as
  the RouteStack id-cache decision).
- **Not** scheduled auto-refresh — refresh stays a deliberate, cost-aware admin action.
- **Not** `/admin` authentication — tracked separately as a launch risk (both admin pages are unauthenticated in v1).

## Verification
- `tsc` · `eslint` · jsdom + integration green (`supabase db reset` first for the new table).
- Ledger round-trip + status transitions + `findReusable` window tested as service role.
- Async client primitives unit-tested with an injected `fetchImpl` (network-free).
- One live cold→reuse check (founder-gated, ~1 run): start → succeeded → ingest; then a second
  ingest of the SAME run pulls the persisted dataset with no new actor run.
