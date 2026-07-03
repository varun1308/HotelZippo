# Spec Coverage

> Mirrors Notion **16 · Spec Index**. Maps each spec page → its `/specs` file → phase → status. `status` here tracks the **in-repo `/specs` contract**, not the Notion page. *(Originally scoped to Phases 0–3; extended 2026-07-03 through Phase 7 + launch workstreams.)*
>
> **Status key:** `generated` = `/specs` file written from Notion Action Items · `pending` = not yet generated · `n/a` = reference page, no contract file · `deferred` = specced but built in a later phase.

## Naming convention (reconciled)

`/specs/<spine-number><opt-letter>-<kebab-topic>.md`. The spine number is the prefix. Where Notion 16 explicitly assigns a non-obvious filename (it re-keys some pages to the phase they're built in), **Notion wins** — those are honoured below:

- `08b-6` (Recommendation Flow & Card Contract) → **`03b-recommendation-flow.md`** (built Phase 3)
- `12g` (Hotel Image Sourcing) → **`01b-image-sourcing.md`**
- `08a-5` (Pipeline Spec) → **`02-review-intelligence-pipeline.md`** (Phase 6; generated now for reference, built later)

Log pages (`08a-4/7`, `08b-5`, `12c/f`) and pure reference pages (01, 02, 03, 04, 09, 11) get **no** `/specs` file.

## Phase 0 — Scaffold

| Spec page | `/specs` file | Status |
|---|---|---|
| 11 · Build Sequence | — (reference) | n/a |
| 13 · Environment & Secrets Map | `specs/13-environment.md` | generated |
| 14 · Error Handling & Observability | `specs/14-error-handling.md` | generated |
| 05 · UI Component Specs (tokens-wiring part) | `specs/05-ui-component-specs.md` | generated |

## Phase 1 — Data

| Spec page | `/specs` file | Status |
|---|---|---|
| 07 · Data Model | `specs/07-data-model.md` | generated |
| 10a · Supabase | `specs/10a-supabase.md` | generated (starter) |
| 12 · Hotel Seeding Strategy | `specs/12-hotel-seeding.md` | generated |
| 12a · Curation Tool | `specs/12a-curation-tool.md` | generated |
| 12d · Seed Script | `specs/12d-seed-script.md` | generated |
| 12g · Hotel Image Sourcing | `specs/01b-image-sourcing.md` | generated |

## Phase 2 — Recommendation engine

| Spec page | `/specs` file | Status |
|---|---|---|
| 08b-6 · Recommendation Flow & Card Contract | `specs/03b-recommendation-flow.md` | generated |
| 08b-2 · Recommendation Assembly Prompt | `specs/08b-2-recommendation-assembly.md` | generated |
| 08a-5 · Pipeline Spec (consumption contract) | `specs/02-review-intelligence-pipeline.md` | generated — consumption contract BUILT here (Phase 2 `query.ts`); full producer specced under Phase 6 below |
| 07 · Data Model | `specs/07-data-model.md` | generated |

## Phase 3 — Conversational UI

| Spec page | `/specs` file | Status |
|---|---|---|
| 08b · Conversation Agent | `specs/08b-conversation-agent.md` | generated |
| 08b-1 · System Prompt | `specs/08b-1-system-prompt.md` | generated |
| 08b-6 · Recommendation Flow & Card Contract | `specs/03b-recommendation-flow.md` | generated |
| 05 · UI Component Specs | `specs/05-ui-component-specs.md` | generated |
| 04 · UX Principles & Flows | — (reference) | n/a |
| 14 · Error Handling (warm states) | `specs/14-error-handling.md` | generated |
| 08b-4 · Test Fixtures | `specs/08b-4-test-fixtures.md` | generated |

## Cross-phase

| Spec page | `/specs` file | Status |
|---|---|---|
| 15 · Test Strategy | `specs/15-test-strategy.md` | generated |
| 06 · System Overview | — (see `docs/architecture.md`) | n/a |

## Phase 4 — Auth & Persistence

| Spec page | `/specs` file | Status |
|---|---|---|
| 17 · Auth & Persistence Spec | `specs/04-auth-persistence.md` | generated — BUILT |

## Phase 5 — Session Memory

| Spec page | `/specs` file | Status |
|---|---|---|
| 08b-3 · Session Snapshot Prompt | `specs/08b-3-session-snapshot.md` | generated — BUILT |

## Phase 6 — Review Intelligence Pipeline

The full producer pipeline (scrape → store → tag → synthesise → write, the worker, and the admin UI) is now contracted in `specs/02-review-intelligence-pipeline.md`, reconciled from 08a-5 (briefing) + 08a-1/2/3/6. The consumption-side query was built in Phase 2; the producer is Phase 6 work.

| Spec page | `/specs` file | Status |
|---|---|---|
| 08a-5 · Pipeline Spec | `specs/02-review-intelligence-pipeline.md` | generated — **SPECCED (producer) + BUILT (consumption query)** |
| 08a-1 · Synthesis Prompt | (→ `/prompts/review-intelligence-agent/synthesis.md`, Phase 6) | folded into `02` |
| 08a-2 · Pipeline Design Decisions | folded into `02` | folded |
| 08a-3 · Synthesis Test Cases | folded into `02` (pointer; 7 cases owned by Notion) | folded |
| 08a-6 · Pipeline Test Cases (TC-P1…P22) | folded into `02` | folded |

Already built (no Phase 6 action): schema (`supabase/migrations/0002_pipeline_tables.sql`), consumption `query.ts`, and both `APIFY_*_REVIEWS_ACTOR_ID` env vars in `.env.example`.

## Phase 7 — Booking (RouteStack)

| Spec page | `/specs` file | Status |
|---|---|---|
| 10c · RouteStack Integration (+ 08c briefing) | `specs/10c-booking-routestack.md` | generated — BUILT (deep-link + room picker; mock demo mode in prod) |
| — (RouteStack REST ground truth) | `specs/openapi.yaml` | captured from live sandbox — **authoritative API doc** (fixtures: `specs/fixtures/routestack/`) |
| 10c §webhooks (no dedicated Notion page yet) | `specs/10d-booking-webhooks.md` | generated — BUILT (order lifecycle + secret verification) |
| 10c §mock (no dedicated Notion page yet) | `specs/10e-booking-mock.md` | generated — BUILT (`ROUTESTACK_MOCK=1` demo path) |

## Launch / post-v1 workstreams

| Spec page | `/specs` file | Status |
|---|---|---|
| 03c · Async Recommendation Assembly (under 08b) | `specs/03c-async-assembly.md` | generated — BUILT & MERGED (PR #71), `ASYNC_ASSEMBLY=1` gated, off by default |
| 12h · Apify Run Ledger | `specs/12h-apify-run-ledger.md` | generated — BUILT (async fetch → poll → ingest) |
| 12i · Preview Destinations | `specs/12i-preview-seeding.md` | generated — BUILT (12i-B surfacing + 12i-C runtime seed; Claude-proposes path NOT wired) |
| 15a · E2E Test Strategy | `specs/15a-e2e-test-strategy.md` | generated — ACTIVE (journeys J1–J5) |
| 18 · Deployment & Launch Checklist | `specs/18-deployment-runbook.md` | generated — prod deployed (mock demo mode) |
