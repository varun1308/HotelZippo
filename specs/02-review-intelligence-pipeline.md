# 02 · Review Intelligence Pipeline

- **Notion:** 08a-5 — https://app.notion.com/p/3754958429ac811a9ccedce100f6fd3a (briefing/contract)
- **Phase:** 6 (full producer pipeline) · **Status: SPECCED (producer) + BUILT (consumption query)**
- **Filename note:** Notion 16 keys 08a-5 to `/specs/02-review-intelligence-pipeline.md`.
- **Reconciled from:** 08a-1 (synthesis prompt, https://app.notion.com/p/3754958429ac810db443eb8b21ad6dd3), 08a-2 (design decisions, https://app.notion.com/p/3754958429ac81c3a3b1f705b14ac44d), 08a-3 (synthesis test cases, https://app.notion.com/p/3754958429ac8101ae88f1890acd057a), 08a-6 (pipeline test cases, https://app.notion.com/p/3754958429ac81ad86b9e2fdb271af90).
- **Canonical cross-refs:** 07 (data model), 13 (env), 14 (error handling/OTEL), 15 (test strategy), 12a (curation tool — Apify/Playwright/mock pattern reused).

> Full Review Intelligence Pipeline contract: producer (scrape → store → tag → synthesise → write) **and** consumer (the read-side candidate query). The read side is **already built** (Phase 2, `lib/review-intelligence/query.ts`); the producer is **Phase 6 work**. The synthesis prompt itself is canonical in 08a-1; synthesis-side decisions are canonical in 08a-2 — where the original pipeline handoff conflicts with 08a-1/08a-2, **08a-1/08a-2 win**.

## What is built vs what is Phase 6

| Piece | State |
|---|---|
| Schema (`pipeline_runs`, `pipeline_run_hotels`, `raw_reviews` + 3 canonical indexes, `hotel_intelligence.low_confidence`) | **BUILT** — migration `supabase/migrations/0002_pipeline_tables.sql` (Phase 1). No new migration needed. |
| Consumption query (`lib/review-intelligence/query.ts`) | **BUILT** — Phase 2 (`phase-2-recommend`). |
| `apify.ts`, `tagging.ts`, `format.ts`, `synthesis.ts` | **Phase 6 — NEW.** |
| `/prompts/review-intelligence-agent/synthesis.md` | **Phase 6 — NEW** (does not exist yet; author verbatim from 08a-1). |
| Admin UI + pipeline API routes | **Phase 6 — NEW.** |
| Separate Node/TS worker | **Phase 6 — NEW.** |
| `APIFY_*_REVIEWS_ACTOR_ID` env vars | **Already present** in `.env.example` (added Phase 1). |

## Status & position

- **Build phase:** Phase 6 (producer). Specced now; built after the recommendation engine + conversational UI are proven on the 10 seeded `hotel_intelligence` records (vertical-slice, seeded-demo-first).
- **Trigger:** Manual only, via the admin UI, for v1. Automated monthly cron is **deferred to post-v1**.
- **Reconciliation rule:** where the original pipeline handoff conflicts with 08a-1/08a-2, **08a-1/08a-2 win.** Specifically: synthesis input uses the 500-review cap / per-segment model (not pass-family-in-full + truncate-general); family tagging uses the 08a-2 canonical keyword list; the consumption contract suppresses `low_confidence` hotels.

## Schema (already built — verify, do not re-create)

The full pipeline schema is already in `supabase/migrations/0002_pipeline_tables.sql` (created Phase 1 so the data model is complete + Zod-validatable). **08a-5 Action Item #1 (migration) is DONE** — Phase 6 must **verify the indexes match** rather than write a new migration. `hotel_intelligence.low_confidence boolean default false` also already exists.

Three canonical indexes are present and match 08a-5:
- `raw_reviews_dedup` — `unique (hotel_id, source, reviewer_name, review_date)` (dedup-append).
- `one_active_run` — `unique ((status = 'running')) where status = 'running'` (single active run, DB-enforced).
- `pipeline_run_hotels_run_id_idx`, `raw_reviews_hotel_id_idx` — performance indexes (additive; not in 08a-5).

**Divergences from the 08a-5 SQL (deliberate, additive — do not "fix" toward 08a-5):**
- `raw_reviews.pipeline_run_id` — migration adds `on delete set null` (08a-5 has a plain reference). Permanent-retention-friendly: raw reviews outlive their run row.
- `pipeline_run_hotels.run_id` / `hotel_id` and `raw_reviews.hotel_id` — migration adds `on delete cascade` (08a-5 plain reference).
- Migration adds two performance indexes not in 08a-5 (above).
- All column names, types, status enums, and the three canonical indexes match 08a-5 exactly.

Canonical data model: 07. The schema is documented there too.

## Stage 1 — Admin UI

**Route:** `/app/admin/review-intelligence/` (mirrors `/app/admin/curation/` — see 12a). API routes under `/app/api/admin/pipeline/*`; pipeline logic in `/lib/review-intelligence/`.

**Access:** No auth for v1 — internal founder tool, not linked from any public page (consistent with the curation tool). No `is_admin` column; auth can be added post-launch.

**Mode A — Full destination run:**
- Destination dropdown: Phuket / Hong Kong / Singapore / Maldives / Bali.
- Shows processed-vs-unprocessed hotel count for that destination.
- "Run full destination" inserts a `pipeline_runs` row and processes all hotels **sequentially**.
- Blocked if any run is already `running`.

**Mode B — Single hotel run:**
- Search/select a seeded hotel.
- Shows last-processed date + current status.
- "Run this hotel" — single-hotel run; used to re-run changed hotels or recover failures.

**Status display (both modes):**
- Live feed — UI polls `pipeline_runs` + `pipeline_run_hotels` **~every 2s**: current hotel, completed, remaining.
- Per-hotel status enum: `pending | scraping | processing | synthesising | complete | failed`.
- Failed hotels show `error_reason` with an individual **Retry**.
- Run history: list of past `pipeline_runs` (timestamp, scope, totals/outcome).

**Hard rules:**
- Exactly one active run at a time — enforced at the **DB level** via `one_active_run` (not just client-side).
- A run **cannot be cancelled mid-flight** — it completes or fails naturally.
- Hotels processed strictly **sequentially**.

## Stage 2 — Apify scraping (per hotel)

Reuse the curation pattern: **Apify primary → Playwright fallback → mock fixtures**, wrapped in `/lib/review-intelligence/apify.ts`.

**Actors (IDs via env, see 13):**
- `APIFY_TRIPADVISOR_REVIEWS_ACTOR_ID` — TripAdvisor Reviews Scraper.
- `APIFY_GOOGLE_REVIEWS_ACTOR_ID` — Google Maps Reviews Scraper.
- Auth: existing `APIFY_API_TOKEN`. If absent → Playwright fallback → mock fixtures (dev/test).

**Input per hotel:**
- `tripadvisor_url` and `google_place_id` from the `hotels` row.
- Date range: **last 12 months** from the run date.
- Language: English (+ Indian languages where the actor supports it).
- Max-results cap per actor run.
- Pagination: follow the actor's offset/cursor until the 12-month boundary is crossed.

**Sequencing & limits:**
- Strictly **sequential** — one hotel fully completes before the next begins.
- Configurable inter-hotel delay, **default 2s**.
- Per-actor timeout (configurable max wait).

**Failure handling (reconciled with 14):**
- **Actor timeout** → mark the hotel `failed` (`error_reason`), **continue** the run; founder retries from the UI. No mid-run 30-minute auto-retry (the 14 behaviour is superseded for the manual model).
- **Zero reviews returned** → set `review_count_total = 0`, **skip synthesis**, mark `failed` with reason, continue.
- **Partial failure** (one source ok, one not) → proceed with what was scraped; **record the gap**.
- All Apify runs traced via OTEL → Dash0 (hotel_id, duration, review count, success/failure), per 14.

## Stage 3 — Raw review storage

**Table:** `raw_reviews`. Insert each scraped review with its `pipeline_run_id`.
- **Deduplication:** the `raw_reviews_dedup` unique index on `(hotel_id, source, reviewer_name, review_date)` means re-runs insert only genuinely new reviews — **insert … on conflict do nothing**.
- **Retention: permanent** — raw reviews are **never deleted**. They accumulate across runs as a growing data asset (trend analysis, re-synthesis without re-scraping, future personalised lens).
- The **12-month recency filter applies only at synthesis (Stage 5), not at storage** — every scraped review is stored regardless of age.

## Stage 4 — Filter, segment & tag (in place)

**Family (`is_family = true`)** — canonical 08a-2 keyword list (case-insensitive), **do not expand for v1** (M3):

```
kids, children, family, toddler, baby, infant, little ones, child, daughter, son, grandchildren
```

The original handoff's broader amenity/age-pattern terms (playground, pram, cot, "5-year-old", etc.) are parked as a v1.1 candidate in 08a-7, **not adopted now**.

**Indian (`is_indian = true`)** — optional stage **O1**:
- Reviewer-name signals (curated Indian-name list) and/or text signals: Indian city mentions (Mumbai, Delhi, Bengaluru, Chennai, Hyderabad…), Hindi terms, vegetarian/Jain/paneer/dal/roti references, festival markers (Diwali, Holi).
- **If O1 is unbuilt**, `indian_food_signal` returns the canonical `"No reviews from Indian guests found for this hotel."` — the pipeline still produces valid output.

(Optional O2 review-dedup and O3 language-filter from 08a-2 are not required for MVP — minor double-counting / non-English passthrough is acceptable; the prompt handles it gracefully.)

## Stage 5 — Synthesis + write

**Producer prep (per 08a-2):**
1. Exclude reviews older than 12 months from the run date; **drop review text < 20 chars**.
2. Per-segment caps, **most-recent-first, NO redistribution**, **500 total hard cap**:

   | Segment | Cap | Selection |
   |---|---|---|
   | Family | ≤ 150 | most-recent-first (highest trust — preserve volume) |
   | Indian | ≤ 100 | most-recent-first (sparse; ceiling not target) |
   | General | ≤ 250 | most-recent-first (fallback — capped harder) |

   If a segment is under its cap, the remaining budget is **NOT** redistributed.
3. Format each review as a single line: `[YYYY-MM-DD] [rating/5] {text}`; **strip reviewer name, management responses, and HTML**. Date ISO `YYYY-MM-DD`, rating integer 1–5.

**Call:** the 08a-1 synthesis prompt, model `claude-sonnet-4-6`, **server-side only**. Parse JSON; on malformed output, **fail the hotel (no partial write)** and log the full response via OTEL (per 14).

**Confidence gate (08a-2):**
- `high` → publish immediately.
- `medium` → publish + flag for the human review queue (log to monitoring dashboard).
- `low` → publish with `low_confidence = true`, raise a **Dash0 alert**; suppressed downstream by the consumption contract until reviewed/re-run.

**Write:** **upsert `hotel_intelligence` on `hotel_id`** (replaces prior intelligence entirely); set `last_refreshed`; set `low_confidence` per the gate; mark the hotel `complete`.

### Family signal tiers (canonical, 08a-2)

Per category (rooms, facilities, food, location):

| Tier | Family reviews mentioning the category | Behaviour |
|---|---|---|
| `strong` | 10 or more | Synthesise from family reviews. High confidence. |
| `thin` | 3 to 9 | Synthesise from family reviews; declare thin signal explicitly. |
| `none` | 0 to 2 | Synthesise from general reviews; declare absence of family signal explicitly. |

General reviews are always treated as sufficient fallback — no tier threshold.

**Overall confidence (08a-1 Step 1):** `high` = `strong` for ≥3 of 4 categories; `medium` = `strong`/`thin` for ≥2 of 4; `low` = `none` for ≥3 categories **OR** total reviews < 10.

## Orchestration / runtime

A full destination scrape runs for many minutes, exceeding Vercel serverless timeouts, so it does **not** run inside a single API route.
- The admin UI triggers a run by **inserting a `pipeline_runs` row** (or hitting an enqueue endpoint).
- A **separate worker** (Node/TypeScript, so it reuses `/lib/review-intelligence/*`) picks up the run, processes hotels sequentially, and writes per-hotel status to `pipeline_run_hotels`.
- The admin UI **polls** the run + run-hotel tables for the live feed.
- The worker **initialises OTEL independently** (per 14 — "the pipeline is a separate process").
- Worker host for the pilot (local box vs deployed worker) is a **Phase-6 infra detail**.

## Consumption contract (read side) — BUILT, Phase 2

> This section is the read side and is **already implemented** in `lib/review-intelligence/query.ts`. Preserve it. The Conversation Agent (08b) honours it; it **NEVER reads `raw_reviews`**.

When a trip brief is complete (destination + trip type), the Conversation Agent:
1. Queries `hotel_intelligence` joined to `hotels` for the destination.
2. **Excludes** `review_count_total = 0` **and** `low_confidence = true`.
3. Branches on `trip_briefs.evaluate_only`:
   - `true` → restrict to `pre_shortlisted_hotels` (normalised name match — no budget/family pre-filter, no sort/take).
   - `false` → apply the pre-filter below.

**Pre-filter (`evaluate_only = false`):**
- **Budget:** map `family_profiles.budget_tier` → `hotels.price_tier`: `value` → {mid-range}; `comfort` → {mid-range, luxury}; `luxury` → {luxury, ultra-luxury}.
- **Family signal:** drop hotels whose `family_signal_strength` is `none` across **all four** categories (rooms, facilities, food, location).
- **Sort:** `review_count_family` descending.
- **Take:** top **15** candidates → recommendation-assembly prompt (08b-2).

*Note:* 15 is a focus cap, not a context limit (~10–14k tokens). Adjustable.

**Hard rules:**
- The Conversation Agent reads `hotel_intelligence` only — **never** `raw_reviews`.
- `low_confidence = true` hotels are excluded (never surfaced).
- `hard_flags` pass through the consumption contract and appear in recommendations — never filtered, always surfaced prominently.

## Acceptance criteria

### Pipeline behaviour (08a-5 → updates Phase 6 in spec 15)
- Pipeline runs end-to-end for 5 test hotels without error.
- Raw reviews written to `raw_reviews` with `pipeline_run_id`.
- **Idempotent dedup-append:** re-running a hotel inserts no duplicate raw reviews and deletes nothing; `hotel_intelligence` is upserted/replaced.
- Family + Indian tagging correct on a labelled test dataset.
- Synthesised intelligence matches the `hotel_intelligence` schema exactly.
- Hard flags detected correctly on a labelled test dataset (incl. the Holiday Inn Karon case).
- Admin UI enforces a single active run (DB-level) and supports per-hotel retry.
- `low_confidence` hotels are excluded by the consumption contract.

### Pipeline test cases (08a-6 · TC-P1…TC-P22, grouped by stage)

**Scraping (Stage 2):**
- **TC-P1 — Zero reviews:** Apify returns nothing → `review_count_total = 0`, synthesis skipped, hotel `failed` with reason, run continues.
- **TC-P2 — Actor timeout:** hotel `failed` with reason, run continues, retry from UI; no 30-minute mid-run stall.
- **TC-P3 — Partial source failure:** TripAdvisor OK, Google down → proceed with the scraped source; gap recorded.
- **TC-P4 — Fallback chain:** no `APIFY_API_TOKEN` → Playwright; Playwright unavailable → mock fixtures (dev/test only).

**Storage & dedup (Stage 3):**
- **TC-P5 — Re-run idempotency:** re-running a hotel inserts no duplicate `raw_reviews` (dedup index); only genuinely new reviews are added.
- **TC-P6 — Permanent retention:** reviews older than 12 months remain in `raw_reviews` after a run (never deleted).
- **TC-P7 — Run linkage:** every inserted row carries the correct `pipeline_run_id`.

**Tagging (Stage 4):**
- **TC-P8 — Family tagging:** on a labelled set, `is_family` matches expectations for the 08a-2 keyword list.
- **TC-P9 — Indian tagging (O1):** on a labelled set, `is_indian` matches expectations; if O1 is disabled, `indian_food_signal` is exactly the canonical no-reviews string.

**Synthesis trigger + write (Stage 5):**
- **TC-P10 — Segment caps:** never exceed 150 family / 100 Indian / 250 general, ≤ 500 total, most-recent-first, no redistribution.
- **TC-P11 — Input format:** each review line is `[YYYY-MM-DD] [rating/5] {text}`; reviewer name, management responses, HTML stripped; text < 20 chars dropped.
- **TC-P12 — Confidence gate:** `low` → `low_confidence = true` + Dash0 alert; `medium` → review queue; `high` → publish.
- **TC-P13 — Upsert:** `hotel_intelligence` replaced on `hotel_id`; `last_refreshed` updated.
- **TC-P14 — Malformed JSON:** hotel `failed`, no partial write, full response logged via OTEL.

**Consumption contract (read side — already built):**
- **TC-P15 — Exclusion:** hotels with `review_count_total = 0` or `low_confidence = true` never appear as candidates.
- **TC-P16 — evaluate_only:** when `true`, only `pre_shortlisted_hotels` are considered.
- **TC-P17 — Pre-filter:** budget map applied; all-`none` family-signal hotels dropped; sorted by `review_count_family` desc; top 15 returned.
- **TC-P18 — Isolation:** the Conversation Agent never queries `raw_reviews` (verified via query trace).

**Admin UI (Stage 1):**
- **TC-P19 — Single active run:** starting a second run while one is `running` is rejected at the DB level.
- **TC-P20 — Status feed:** per-hotel status transitions are reflected live.
- **TC-P21 — Individual retry:** retrying a failed hotel re-processes only that hotel.
- **TC-P22 — Run history:** past runs listed with timestamp, scope, totals/outcome.

### Synthesis-prompt test cases (08a-3 · 7 cases — pointer)

Synthesis correctness is owned by 08a-3 (https://app.notion.com/p/3754958429ac8101ae88f1890acd057a). Run all 7 against `claude-sonnet-4-6` before the full pipeline run:
1. Normal hotel, strong family signal (Anantara Mai Khao) — `high`, all `strong`, no flags.
2. **Hard flags (Holiday Inn Resort Phuket Karon Beach)** — ≥3 hard flags (Active Refurbishment severe, Facility Closure / kids club, Room Quality Deterioration, optional Pest Reports) present **despite a positive rating mix**; `medium`. **This is the load-bearing hard-flag case.**
3. Thin family signal (The Fullerton Singapore) — `thin`, "Based on general guest reviews (family signal: thin) —" prefix.
4. No Indian reviews (Four Seasons Bali at Sayan) — `indian_food_signal` is exactly the canonical string; no inference.
5. Conflicting signals (Intercontinental Hong Kong) — quantified noise split (~55/45); noise as `moderate` hard flag if 3+ structural mentions.
6. Very low review count (Patina Maldives, 7 total) — every summary begins "Based on limited reviews (7 total) — treat with caution."; `low`.
7. Zero family + zero Indian (Hotel ICON Hong Kong) — all `none`; "No family reviews found — based on general guest reviews." prefix; `low`.

## Claude Code Action Items (Phase 6 codebase handoff)

> Corrected against the repo: the schema and the consumption query are **already built**.

1. **Migration — ALREADY DONE.** Schema is in `supabase/migrations/0002_pipeline_tables.sql` (Phase 1). **No new migration.** Verify the three canonical indexes (`raw_reviews_dedup`, `one_active_run`, plus the per-table perf indexes) match this spec. Note the deliberate `on delete` additions vs 08a-5 above.
2. **`/lib/review-intelligence/` producer libs (NEW):**
   - `apify.ts` — two review actors (`APIFY_TRIPADVISOR_REVIEWS_ACTOR_ID` + `APIFY_GOOGLE_REVIEWS_ACTOR_ID`) + Playwright/mock fallback (curation pattern, 12a).
   - `tagging.ts` — family (canonical 08a-2 keyword list, case-insensitive, do-not-expand) + optional Indian (O1).
   - `format.ts` — 12-month + <20-char filters, per-segment caps (150/100/250, ≤500 total, most-recent-first, no redistribution), `[YYYY-MM-DD] [rating/5] {text}` line format, strip name/mgmt-responses/HTML.
   - `synthesis.ts` — calls `/prompts/review-intelligence-agent/synthesis.md` via `claude-sonnet-4-6` server-side, parses JSON (malformed → fail hotel, no partial write, OTEL log), applies the confidence gate, upserts `hotel_intelligence` on `hotel_id` + sets `last_refreshed`.
   - `query.ts` — **ALREADY BUILT** (Phase 2; consumption contract above).
3. **Prompt (NEW):** author `/prompts/review-intelligence-agent/synthesis.md` **verbatim from 08a-1** (directory does not exist yet).
4. **Admin UI (NEW):** `/app/admin/review-intelligence/` page + `/app/api/admin/pipeline/{run,status,retry}/route.ts`.
5. **Worker (NEW):** Node/TS entrypoint consuming `pipeline_runs`, writing per-hotel status to `pipeline_run_hotels`, OTEL-instrumented independently.
6. **Env — ALREADY PRESENT.** `APIFY_TRIPADVISOR_REVIEWS_ACTOR_ID` + `APIFY_GOOGLE_REVIEWS_ACTOR_ID` are already in `.env.example` (Phase 1). Verify values are supplied for the run.
7. **Tests (NEW):** per 08a-6 (TC-P1…TC-P22) + 08a-3 (7 synthesis cases) + updated Phase 6 in spec 15. Read-side tests (`tests/unit/review-query.test.ts` + `tests/integration/review-query.test.ts`) already cover TC-P15…P18.
