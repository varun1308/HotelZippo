# Spec Coverage (Phases 0–3)

> Mirrors Notion **16 · Spec Index** for the Phase 0–3 build. Maps each spec page → its `/specs` file → phase → status. `status` here tracks the **in-repo `/specs` contract**, not the Notion page.
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
| 08a-5 · Pipeline Spec (consumption contract only) | `specs/02-review-intelligence-pipeline.md` | generated (consumption contract; full pipeline deferred to Phase 6) |
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

## Out of scope for this plan (Phases 4–8)

Generated as reference where they share a page with a 0–3 contract (e.g. `02-review-intelligence-pipeline.md` carries the Phase 6 pipeline). Not built now: 08a (full), 08a-1/2/3, 08b-3 (session snapshot, Phase 5), 08c (booking, Phase 7), 10b (Apify, Phase 6), 10c (RouteStack, Phase 7).
