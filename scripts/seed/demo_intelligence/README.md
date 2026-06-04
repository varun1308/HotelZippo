# Demo Intelligence records (founder-authored)

Drop **10 hand-crafted JSON files** here — 5 Phuket, 5 Bali (one hotel per file).
The **Seed Demo Intelligence** button on `/admin/curation` (POST
`/api/admin/seed-intelligence`) reads every `*.json` in this directory, validates it,
resolves the hotel by `hotel_name` + `destination`, and upserts one
`public.hotel_intelligence` row per file (idempotent, `low_confidence = false`).

> **Owner: founder.** Claude wired the route + Zod validation only; the *content* of
> these records is authored by the founder post-curation. See `specs/12d-seed-script.md`.

## Prerequisite

The named hotels must already exist in `public.hotels` — run **Publish to Hotels**
first. The seed **fails loudly** (HTTP 409, no rows written) if any file names a hotel
that isn't published yet, and tells you exactly which ones.

## File structure (validated by `lib/seed/types.ts` — strict, no extra keys)

```json
{
  "hotel_name": "JW Marriott Phuket Resort & Spa",
  "destination": "Phuket",
  "rooms_summary": "…",
  "facilities_summary": "…",
  "food_summary": "…",
  "location_summary": "…",
  "hard_flags": [
    { "category": "refurbishment", "description": "…", "severity": "moderate", "review_evidence_count": 12 }
  ],
  "conflicting_signals": { "rooms": "…", "facilities": "…", "food": "…", "location": "…" },
  "family_signal_strength": { "rooms": "strong", "facilities": "strong", "food": "thin", "location": "strong" },
  "supporting_phrases": { "rooms": ["…"], "facilities": ["…"], "food": ["…"], "location": ["…"] },
  "indian_food_signal": "…",
  "review_count_family": 0,
  "review_count_total": 0
}
```

- `destination` ∈ Phuket | Hong Kong | Singapore | Maldives | Bali
- `hard_flags[].severity` ∈ `moderate` | `severe` (amber | red); `review_evidence_count` optional
- `family_signal_strength.*` ∈ `strong` | `thin` | `none`
- All four category objects (`conflicting_signals`, `family_signal_strength`,
  `supporting_phrases`) require **all four** keys: `rooms`, `facilities`, `food`, `location`.

## Selection rules for the 10 records (12d)

- ≥1 with populated `hard_flags`
- ≥1 Marriott / Hilton
- ≥1 independent
- ≥1 with a rich `indian_food_signal`
- ≥1 with `family_signal_strength` = `thin`/`none` in one+ category

The Phuket set should anchor the canonical reference scenario:
**JW Marriott Phuket** (amber refurb) · **Angsana Laguna** (clean) ·
**Holiday Inn Resort Phuket Karon Beach** (red severe refurb).
