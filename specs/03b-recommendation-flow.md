# 03b · Recommendation Flow & Card Contract

- **Notion:** 08b-6 — https://app.notion.com/p/3754958429ac81e4b31fea8a3eba1d74
- **Phase:** 2–3 · **Status:** specced
- **Filename note:** Notion 16 keys 08b-6 to `/specs/03b-recommendation-flow.md`.

Formalises the end-to-end recommendation runtime and the exact mapping from assembly JSON (08b-2) → UI cards (05). This is the contract that ties Phase 2 (engine) to Phase 3 (UI).

## End-to-end runtime (two-step, server-side only)

1. Conversation Agent (08b-1) confirms **destination + trip type**, then calls the `assemble_recommendations` tool.
2. Tool → `/app/api/recommendations/assemble/route.ts` runs **two steps**:
   - **(a) Candidate query** — consumption contract (08a-5), in `/lib/review-intelligence/query.ts`: query `hotel_intelligence` joined to `hotels` for the destination; exclude `review_count_total = 0` and `low_confidence = true`; branch on `evaluate_only`; apply budget→price_tier map; apply family-signal filter (drop all-`none`); sort by `review_count_family` desc; **take top 15**.
   - **(b) Assembly LLM call** — 08b-2 prompt, invoked server-side with `family_profile`, `trip_brief`, ≤15 candidate intelligence records (each joined to `hotels` metadata). Parse JSON; **malformed → fail per 14, no partial output**.
3. Endpoint returns the assembly JSON to the agent turn.
4. Agent wraps the JSON in **one sentence before and one after** (08b-1) — does not restate card contents.
5. Frontend renders the JSON as inline cards (05 component 2), hydrating display-only hotel metadata by `hotel_id` (single batched query for all picks).

**Why two steps:** the deterministic filter keeps the LLM focused on judgement over a clean ≤15-record set, and keeps `raw_reviews` and `low_confidence` hotels out of the model entirely.

## Card field mapping (assembly JSON → 05 card)

| Card field (05) | Source |
|---|---|
| Hotel name | `top_pick.hotel_name` / `other_picks[].hotel_name` |
| Destination + area | `hotels.destination` • `hotels.area` (hydrate by `hotel_id`; null area → destination only) |
| Price tier label | `hotels.price_tier` |
| Star rating | `hotels.star_rating` |
| Hero image | `hotels.images[0]` (fallback: 05 `.photo-slot` placeholder if empty) — see 01b/12g |
| Verdict (Top Pick) | `top_pick.verdict` |
| 4 category summaries | `top_pick.category_summaries.{rooms,facilities,food,location}` |
| Hard flag alert | `*.hard_flags[]` (category, description, severity → amber/red per 05) |
| Brand + loyalty label | `*.brand_note` (null → hide) |
| Supporting phrases | `top_pick.supporting_phrases.*` (verbatim reviewer phrases) |
| Standard card summary | `other_picks[].summary` |
| "Why top pick" | `top_pick.why_top_pick` |

## Error / edge handling

Assembly prompt can return `{ "error": "no_eligible_hotels" | "budget_mismatch", ... }` (08b-2 Step 5). The endpoint passes it through; the agent renders it conversationally (08b-1 edge cases); the frontend renders **no cards**.

## Action items (from Notion, verbatim)

1. ✅ Implement `/app/api/recommendations/assemble/route.ts`: run the 08a-5 query (`/lib/review-intelligence/query.ts`) → call the 08b-2 prompt → return parsed JSON. **BUILT (phase-2-assemble):** POST {family_profile, trip_brief} → queryCandidates → assembleRecommendations → assembly JSON. Zero candidates → `no_eligible_hotels`; malformed assembly → 502 warm error, no partial (spec 14). Steps 2–5 (agent tool wiring, frontend cards) are Phase 3.
2. Define the `assemble_recommendations` tool in the Conversation Agent's tool set; inputs = resolved `family_profile` + `trip_brief`.
3. Frontend card component hydrates display metadata from `hotels` by `hotel_id` (single batched query); applies the mapping above; honours the 05 placeholder fallback for missing images.
4. Contract-test the assembly JSON **and** the hydrated card props against the 05 required fields (Zod, per 15) — use the `prompt-contract-test` + `hard-flag-audit` skills.
5. (This file generated from the Notion page.)

## Hard-flag survival (CLAUDE.md rule 1, 4)

Every hard flag in a source intelligence record **must** appear in the assembly output and in the rendered card, above the fold, never collapsed/dismissed. Enforce with the `hard-flag-audit` skill in CI for Phases 2–3.
