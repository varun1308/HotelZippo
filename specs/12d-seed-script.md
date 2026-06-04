# 12d · Seed Script (Demo Intelligence Seeding)

- **Notion:** https://app.notion.com/p/3754958429ac81d39d5ee28ca7b33a63
- **Phase:** 1 · **Status:** BUILT (phase-1-seed) — plumbing + Zod + fail-loud wired; awaits founder-authored records.

**Not a Python/CSV script.** A Next.js API route reads 10 hand-crafted demo intelligence JSON files and upserts to `hotel_intelligence`. Triggered by the **Seed Demo Intelligence** button on `/admin/curation`.

> Built: route `app/api/admin/seed-intelligence/route.ts` (POST); lib `lib/seed/{types,seed-intelligence}.ts`. Records dir `scripts/seed/demo_intelligence/` (`.gitkeep` + `README.md`; **founder authors the 10 JSON files** — see ⚠️ below). Tests: `tests/unit/seed-intelligence.test.ts` + `tests/integration/seed-intelligence.test.ts`. Button already present in `/admin/curation`. Fail-loud is all-or-nothing: a missing hotel → HTTP 409 (no rows written) with per-file diagnostics; bad JSON / schema → 422; empty dir → 404.

## Files

```
/app/api/admin/seed-intelligence/route.ts
/scripts/seed/demo_intelligence/*.json     (10 files: 5 Phuket, 5 Bali)
```

## Route behaviour (POST)

1. Load + validate JSON files from `/scripts/seed/demo_intelligence/` (Zod).
2. Look up `hotel_id` by matching `hotel_name` + `destination` in `hotels`.
3. Upsert into `hotel_intelligence` on `hotel_id`; set `low_confidence = false`.
4. Return `{ written, skipped, details[] }`.
- **Idempotent** — re-running produces no duplicates.
- **Prerequisite:** `hotels` must be populated via Publish-to-Hotels first.
- `SUPABASE_SERVICE_ROLE_KEY` server-side only.

## Demo record JSON structure (per file)

```json
{
  "hotel_name": "string",
  "destination": "string",
  "rooms_summary": "string",
  "facilities_summary": "string",
  "food_summary": "string",
  "location_summary": "string",
  "hard_flags": [
    { "category": "string", "description": "string", "severity": "moderate | severe", "review_evidence_count": 0 }
  ],
  "conflicting_signals": { "rooms": "string", "facilities": "string", "food": "string", "location": "string" },
  "family_signal_strength": { "rooms": "strong | thin | none", "facilities": "...", "food": "...", "location": "..." },
  "supporting_phrases": { "rooms": [], "facilities": [], "food": [], "location": [] },
  "indian_food_signal": "string",
  "review_count_family": 0,
  "review_count_total": 0
}
```

## Selection rules for the 10 records

≥1 with populated `hard_flags`; ≥1 Marriott/Hilton; ≥1 independent; ≥1 with rich `indian_food_signal`; ≥1 with `family_signal_strength` = thin/none in one+ category.

> ✅ **Resolved (2026-06-05):** the founder reassigned authoring to Claude. Claude drafted all 10 records as **fabricated demo placeholders** (invented summaries/flags/counts — NOT synthesised from real reviews, since none have been curated). They anchor the canonical reference scenario (JW Marriott Phuket amber refurb; Angsana Laguna clean; Holiday Inn Karon red severe refurb) and hit every selection rule. **The founder still owns the final content** and may revise/replace these wholesale. Files live in `scripts/seed/demo_intelligence/` (5 Phuket, 5 Bali); the fixtures in `scripts/seed/fixtures/{phuket,bali}.json` were expanded to 5+5 publishable hotels so the named hotels publish before seeding. Verified end-to-end on local Supabase: publish → seed = 10 written, 0 skipped, idempotent. Fail-loud behaviour (missing hotel → 409, no writes) is unchanged.

## Action items (from Notion)

1. Create `/api/admin/seed-intelligence` route (POST).
2. Load + validate JSON files from `/scripts/seed/demo_intelligence/`.
3. Look up `hotel_id` by `hotel_name` + `destination`.
4. Upsert into `hotel_intelligence` on `hotel_id`.
5. Return `{ written, skipped, details }`.
6. Add "Seed Demo Intelligence" button to `/admin/curation` header.
7. Implement idempotency.
8. `SUPABASE_SERVICE_ROLE_KEY` server-side only.
9. Hotels table must be populated first.

## Tests (12e)

8 acceptance criteria + 5 scenarios: happy path (10→10), idempotency (run twice → no dupes), hotels-not-published, invalid JSON, no files found. Zod validation for all 10 files.
