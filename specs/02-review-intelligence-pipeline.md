# 02 · Review Intelligence Pipeline

- **Notion:** 08a-5 — https://app.notion.com/p/3754958429ac811a9ccedce100f6fd3a
- **Phase:** 6 (full pipeline) · **Status:** specced
- **Filename note:** Notion 16 keys 08a-5 to `/specs/02-review-intelligence-pipeline.md`.

> **Scope for this Phase 0–3 plan:** only the **consumption contract** (read side) is in scope — Phase 2 must implement it in `/lib/review-intelligence/query.ts`. The full pipeline (scrape → tag → synthesise → store, the worker, the admin UI) is **built at Phase 6** and documented here for reference.

## Consumption contract (read side) — PHASE 2 MUST HONOUR

When a trip brief is complete (destination + trip type), the Conversation Agent:
1. Queries `hotel_intelligence` joined to `hotels` for the destination.
2. **Excludes** `review_count_total = 0` **and** `low_confidence = true`.
3. Branches on `trip_briefs.evaluate_only`:
   - `true` → restrict to `pre_shortlisted_hotels` (normalised name match).
   - `false` → apply the pre-filter below.

**Pre-filter (`evaluate_only = false`):**
- **Budget:** map `family_profiles.budget_tier` → `hotels.price_tier`: `value` → {mid-range}; `comfort` → {mid-range, luxury}; `luxury` → {luxury, ultra-luxury}.
- **Family signal:** drop hotels whose `family_signal_strength` is `none` across **all four** categories.
- **Sort:** `review_count_family` descending.
- **Take:** top **15** candidates → assembly prompt.

**Hard rules:**
- The Conversation Agent reads `hotel_intelligence` only — never `raw_reviews`.
- `low_confidence = true` hotels are excluded (never surfaced).
- `hard_flags` pass through the consumption contract and appear in recommendations — never filtered, always surfaced prominently.

## Phase 2 action items (in scope now)

1. Implement `/lib/review-intelligence/query.ts` to the consumption contract above.
2. Unit + integration tests: low_confidence excluded, review_count_total=0 excluded, evaluate_only branch, budget map, all-`none` family-signal drop, top-15 sort/limit, hard_flags passthrough.

## Full pipeline action items (Phase 6 — reference only)

1. Migration: `pipeline_runs`, `pipeline_run_hotels`; `raw_reviews.pipeline_run_id` + dedup index + `one_active_run` index. *(Schema created in Phase 1 per 07; worker built Phase 6.)*
2. `/lib/review-intelligence/`: `apify.ts`, `tagging.ts`, `format.ts`, `synthesis.ts` (→ `/prompts/review-intelligence-agent/synthesis.md`), `query.ts`.
3. Admin UI: `/app/admin/review-intelligence/` + `/app/api/admin/pipeline/{run,status,retry}/route.ts`.
4. Worker: Node/TS entrypoint consuming `pipeline_runs`, per-hotel status, OTEL-instrumented independently.
5. Env: `APIFY_TRIPADVISOR_REVIEWS_ACTOR_ID`, `APIFY_GOOGLE_REVIEWS_ACTOR_ID`.
6. Tests per 08a-6 + Phase 6 in 15.
