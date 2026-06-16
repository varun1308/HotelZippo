# 12i · Preview Destinations (Claude-seeded, RouteStack-verified)

- **Notion:** https://app.notion.com/p/3814958429ac81b1a32cf1e8b5b79b5d (12i · Preview Destinations)
- **Phase:** Launch / live-testing completeness · **Status:** SPEC (proposed 2026-06-16) — not yet built
- **Companion:** [12a · Curation Tool](12a-curation-tool.md), [12h · Apify Run Ledger](12h-apify-run-ledger.md), [10c · RouteStack Integration](10c-booking-routestack.md), [02 · Review-Intelligence Pipeline](02-review-intelligence-pipeline.md), [07 · Data Model](07-data-model.md), [14 · Error Handling](14-error-handling.md).

## Why

Only **Phuket** is fully curated (Apify → `hotel_intelligence`). The other four destinations
(Hong Kong, Singapore, Maldives, Bali) have no hotels, which (a) blocks live RouteStack
booking-flow testing outside Phuket, and (b) makes the product look incomplete. Running the full
Apify pipeline per destination is the eventual answer but is paid + operator-heavy.

**Preview seeding** gives multi-destination completeness fast, *without Apify and without fabricating
review intelligence*: Claude proposes candidate hotel **names**, RouteStack is the **ground truth**
that verifies they exist + are bookable, and the survivors are stored as a clearly-labeled
**preview tier** — surfaced to users but never dressed up as review-intelligence-backed.

## The honest contract (the spine — do not compromise)

- Claude proposes **hotel names only** (+ a one-line "why family-friendly"). It NEVER invents review
  counts, hard-flags, review quotes, prices, or star ratings.
- **RouteStack is ground truth.** A proposed hotel is kept **only if `search-hotels` returns it by
  name** in the correctly-resolved destination (real + bookable + real rates).
- Survivors are stored with **`hotels.source = 'preview'`** and surfaced with a neutral **"Preview —
  bookable now, full review intelligence coming soon"** label. No fabricated `hotel_intelligence`
  row; no hard-flags; no review-derived claims; **no amber/red** (reserved for hard-flags per 05).
- **End users never see "hundreds of hotels"** — the agent surfaces ~3/query. Preview is about
  *destination coverage*, not browsing volume. This is fundamentally an operator + completeness
  concern, presented honestly to users.

## Prerequisite — correct destination resolution (see 10c)

⚠️ **Hard dependency.** A live probe (2026-06-16) found `pickDestination` (`lib/booking/routestack.ts`)
picks the **first** geo-valid RouteStack `search-destinations` candidate. For "Bali" that is a Fiji
islet (lat −17.5) → `search-hotels` returned **0** hotels. Forcing the correct Bali State candidate
(lat −8.34) returned **20**. This is a **pre-existing booking bug**, not preview-specific, and it must
be fixed first or preview verification (and live booking) targets the wrong place.

**Fix (documented in 10c):** resolve the destination's authoritative lat/long via **Google Places
Text Search (New)** (reuse `lib/curation/google-places.ts` + `GOOGLE_PLACES_API_KEY`), then pick the
RouteStack candidate **nearest** that anchor (haversine). RouteStack's own `destinationId` is still
**required** by `search-hotels` (per `openapi.yaml` `HotelSearchRequest.required`), so Google does NOT
replace `search-destinations` — it **disambiguates** which candidate to use. Resolved
`{rsDestinationId, lat, long}` is cached in `routestack_destinations` (PR #42) → one-time cost.

## Data model — migration `0013_hotel_source_tier.sql`

```sql
alter table public.hotels
  add column source text not null default 'curated'
    check (source in ('curated','preview'));
-- existing Apify/Phuket rows stay 'curated' (default). Preview hotels are written with 'preview'.
```

- The recommendation consumption query (`lib/review-intelligence/query.ts`) still excludes
  `low_confidence`; **preview hotels are NOT hidden** — they're distinguished by `source`, not by
  `low_confidence`. (Preview hotels simply have **no** `hotel_intelligence` row.)
- A guard test asserts **no fabricated `hotel_intelligence`** exists for `source='preview'` hotels.

## Code (all injectable / unit-testable, server-side, NOT 'use client')

1. **`lib/preview/propose.ts`** — `proposeHotels(destination, count, { model? })` → calls Claude with
   a tight JSON-only prompt (~200 output tokens): returns `[{ name, oneLineWhy }]`. Injectable model
   (MockLanguageModel in tests → key-free CI), same pattern as `lib/chat/agent.ts`. No prose, capped.
2. **`lib/preview/verify.ts`** — `verifyAndStage(client, destination, proposals, { fetchImpl?, cache? })`
   → for each name: run RouteStack destination-resolve (the fixed path) + `search-hotels` + the existing
   `matchHotelByName`; keep hits; capture RS hotel id + price tier (from rates) + RS-confirmed name;
   upsert into `hotels` as `source='preview'`. Reuses the id-cache (PR #42) so repeat seeds skip
   re-search. Best-effort / warm-fail — a RouteStack error drops that candidate, never crashes the seed.
3. **`app/api/admin/preview/seed/route.ts`** + a **"Seed preview (Claude + RouteStack)"** button on
   `/admin/curation` (reuses the operator-feedback notice UX from PR #50). Reports **proposed → verified
   → kept** counts so the name-match drop-off is visible.

## Recommendation / UI (minimal, honest)

- When a destination has only `preview` hotels, the agent assembles picks framed as **preview** — from
  the name + RouteStack-confirmed facts (destination, price tier from rates) — with **no** review-derived
  claims. A neutral **preview badge** on the card (no hard-flag colors).
- **Phased rollout:** internal/flagged first (operator-only, for live RouteStack testing), flip to
  user-facing preview once the flow is proven live on one destination.

## Cost & posture

- **Claude:** 1 cheap call per destination (~5 names). Negligible tokens.
- **RouteStack:** ~N `search-hotels` calls per seed (verification) — the bounded real cost; cached via
  the id tables so repeat bookings skip re-search.
- **Google Places:** 1 location lookup per *new* destination, then cached. Negligible.

## Known caveats (from the live probe — stated, not hidden)

- **Name-match is exact-then-contains** (`matchHotelByName`). Claude's "The St. Regis Bali" vs RouteStack
  "St Regis Bali Resort" may NOT match → that candidate is **dropped** (safe failure; better than
  mis-booking). Surface "proposed 5, verified 3" so the operator sees yield. Fuzzy matching is a later
  option if yield is too low.
- **RouteStack inventory is date/availability-volatile** (Phuket returned 145 hotels in one capture,
  1 in a later probe with different dates). Use sensible near-future dates at seed time; keep only the
  **durable name↔RS-id identity**, never cache a hotel *list* as stable inventory (per the id-cache
  learnings in 10c / PR #42).

## Out of scope (stated, not silently dropped)

- **No fabricated review intelligence** — the entire point.
- **Not replacing Apify for Phuket** — Phuket stays the curated showcase tier.
- **No bulk auto-seed of all destinations** without an explicit operator click (cost control).
- **No fuzzy name-matching** in v1 (exact-then-contains only; revisit if yield is low).

## Action items

1. **PR-0 (prereq):** fix `pickDestination` via Google-Places-anchored nearest-candidate selection
   (documented in 10c); tests + cache the resolved destination. Land first.
2. Migration `0013` — `hotels.source` tier column.
3. `lib/preview/propose.ts` (Claude, injectable model) + tests.
4. `lib/preview/verify.ts` (RouteStack-verified staging) + tests; guard: no `hotel_intelligence` for preview.
5. Admin route + `/admin/curation` "Seed preview" button (operator-only flag first).
6. Recommendation/UI preview-tier framing + neutral badge; flip to user-facing when proven.

## Tests (15 / 15a)

- `propose` with MockLanguageModel: JSON shape, count cap, no prose.
- `verify` with fake RouteStack transport: hit kept · miss dropped · RouteStack-down → warm-fail.
- Integration: seed → `hotels` rows are `source='preview'`; **guard** — no `hotel_intelligence` row for preview.
- Destination-resolution fix (10c): fake Google + fake candidates → nearest (correct) wins; no-Google → graceful fallback; "Bali" picks −8.34 over −17.5.
