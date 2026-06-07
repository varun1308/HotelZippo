# 08b-2 · Recommendation Assembly Prompt

- **Notion:** https://app.notion.com/p/3754958429ac81c080e1c9551ee80592
- **Phase:** 2–3 · **Status:** specced (v1.0.0)
- **Prompt artifact:** `/prompts/conversation-agent/recommendation-assembly.md`
- **Model:** `claude-sonnet-4-6`

The assembly engine receives `family_profile`, `trip_brief`, and ≤15 `hotel_intelligence` records; selects + ranks 2–3 hotels; outputs **structured JSON only** (no prose). Primary obligation: **hard flags must appear in output regardless of match quality.** Always commit to a clear top pick.

## Step 1 — Filter
1. Remove any hotel where `low_confidence = true`.
2. If `evaluate_only = true`, restrict to hotels in `pre_shortlisted_hotels` only.
3. If `evaluate_only = false`, evaluate all candidates.
If filtering removes all candidates → `{ "error": "no_eligible_hotels", "reason": "..." }`.

## Step 2 — Parameter weighting by trip type

| Parameter | Resort-Anchored | City/Activity | Multi-City |
|---|---|---|---|
| Room size & configuration | High | Medium | Medium |
| Breakfast & kids menu | High | High | High |
| Vegetarian food (if applicable) | High | High | High |
| Location & safety | Medium | High | High |
| Public transport proximity | Low | High | Medium |
| Recent family reviews | High | High | High |
| Budget | Medium | High | Medium |

**Budget matching:** `value` → mid-range only; `comfort` → mid-range or luxury; `luxury` → all tiers. No match → budget mismatch signal.
**Brand preference:** tiebreaker only; stronger signals beat a preferred brand with weaker signals; IHG lower-preference unless exceptional.
**Kids age awareness:** <2 → crib, in-room kettle, restaurant flexibility; 5–10 → kids club, pool; grandparents → vegetarian food, accessibility.

## Step 3 — Selection
Score eligible hotels holistically across weighted parameters → strongest = top pick → 1–2 alternatives → 2–3 total. Top pick unambiguous. Tie → brand preference, then `review_count_family` desc.

## Step 4 — Output construction

**Verdict:** references specific family context (not generic); first person, warm, direct; ≤3 sentences; if hard flag present, acknowledge ("There is one thing to be aware of before booking…").
**Family signal language:** `strong` → "Families consistently report…"; `thin` → "Fewer family reviews on this, but guests generally note…"; `none` → "No family reviews found for this category — based on general guest feedback…".
**Indian food signal:** if `food_preferences` includes vegetarian, food summary + verdict must explicitly reference `indian_food_signal`; if "No reviews from Indian guests found", state it (do not substitute general food signal).
**Conflicting signals:** express as proportions ("72% praised room size; 28% flagged noise").

### Output schema (verbatim)
```json
{
  "top_pick": {
    "hotel_id": "uuid",
    "hotel_name": "string",
    "verdict": "2–3 sentences. Personalised to this specific family. Warm, direct, specific. If hard flags exist, acknowledge: 'There is one thing to be aware of before booking...'",
    "category_summaries": {
      "rooms": "1–2 sentences from intelligence, personalised where possible. Apply family signal language rules.",
      "facilities": "1–2 sentences. Apply family signal language rules.",
      "food": "1–2 sentences. Must reference indian_food_signal if family is vegetarian.",
      "location": "1–2 sentences. Apply family signal language rules."
    },
    "hard_flags": [
      { "category": "string — from intelligence record", "description": "string — from intelligence record", "severity": "moderate | severe", "review_evidence_count": 0 }
    ],
    "brand_note": "string | null — e.g. 'Marriott Bonvoy property — eligible for points'. null if no match.",
    "supporting_phrases": { "rooms": [], "facilities": [], "food": [], "location": [] },
    "why_top_pick": "1 sentence. Specific reason this hotel was chosen over the others, tied to this family's profile. Not generic."
  },
  "other_picks": [
    {
      "hotel_id": "uuid",
      "hotel_name": "string",
      "summary": "1–2 sentences on why this hotel is worth considering for this family.",
      "hard_flags": [ { "category": "string", "description": "string", "severity": "moderate | severe", "review_evidence_count": 0 } ],
      "brand_note": "string | null"
    }
  ],
  "recommendation_notes": "string | null — overall caveats or landscape context. null if no caveats needed.",
  "evaluate_only_applied": "boolean — true if evaluate_only was true in the trip brief",
  "alternatives_introduced": "boolean — true if hotels not on the pre-shortlist were introduced"
}
```

## Step 5 — Edge cases
- **Budget mismatch:** `{ "error": "budget_mismatch", "reason": "...", "available_tiers": [...] }`.
- **All hotels have hard flags:** recommend best; `recommendation_notes` = "All available hotels for this destination have structural flags worth reviewing. Recommendations are based on the strongest overall match despite these issues."
- **Pre-shortlisted hotel not in records:** note in `recommendation_notes`.
- **Only one eligible hotel:** `other_picks = []`; note in `recommendation_notes`.
- **Vegetarian family, no Indian food signal on top pick:** food summary includes "Note: no reviews from Indian guests found for this property — the vegetarian food situation is unconfirmed."

## Decision rules (apply in order)
1. Filter `low_confidence`. 2. Apply `evaluate_only`. 3. Check budget tier (flag before proceeding). 4. Weight by trip type. 5. Kids/grandparent awareness. 6. Score + rank. 7. Brand preference as tiebreaker only. 8. Construct output — hard flags first, then summaries, then verdict. 9. Verify every source hard flag is present. 10. Verify verdict references specific family context. 11. Verify `indian_food_signal` referenced if vegetarian. 12. Output JSON — nothing else.

## Action items

- ✅ Author the prompt at `/prompts/conversation-agent/recommendation-assembly.md`. **BUILT (phase-2-assemble).**
- ✅ Encode the output schema as a Zod schema (`lib/contracts/recommendation-assembly.ts` — union of success + `no_eligible_hotels`/`budget_mismatch`); contract-test against 08b-4 RA-01…RA-05 (`tests/contract/recommendation-assembly.test.ts`, fixtures in `tests/fixtures/recommendation-assembly.ts`).
- ✅ `hard-flag-audit`: every source hard flag survives into output (asserted for RA-01 + RA-05).
- Assembler: `lib/recommendations/assemble.ts` — injectable `callModel` (default = Anthropic `claude-sonnet-4-6`, ANTHROPIC_API_KEY server-side only); malformed output → `AssemblyError`, never a partial (spec 14). Tests inject a fake model so CI runs with no key.
