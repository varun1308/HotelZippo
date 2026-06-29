# 12i · Preview Destinations (Claude-seeded, RouteStack-verified)

- **Notion:** https://app.notion.com/p/3814958429ac81b1a32cf1e8b5b79b5d (12i · Preview Destinations)
- **Phase:** Launch / live-testing completeness · **Status:** SPEC (proposed 2026-06-16) — not yet built
- **Companion:** [12a · Curation Tool](12a-curation-tool.md), [12h · Apify Run Ledger](12h-apify-run-ledger.md), [10c · RouteStack Integration](10c-booking-routestack.md), [02 · Review-Intelligence Pipeline](02-review-intelligence-pipeline.md), [07 · Data Model](07-data-model.md), [14 · Error Handling](14-error-handling.md).

## Why

Only **Phuket** is fully curated (Apify → `hotel_intelligence`). The other four destinations
(Singapore, Tokyo, Orlando, Bali) have no hotels, which (a) blocks live RouteStack
booking-flow testing outside Phuket, and (b) makes the product look incomplete. Running the full
Apify pipeline per destination is the eventual answer but is paid + operator-heavy.

**Preview seeding** gives multi-destination completeness fast, *without Apify and without fabricating
review intelligence*: Claude proposes candidate hotel **names**, RouteStack is the **ground truth**
that verifies they exist + are bookable, and the survivors are stored as a clearly-labeled
**preview tier** — surfaced to users but never dressed up as review-intelligence-backed.

## Flow (RouteStack-FIRST, no-Claude — the DEFAULT, 2026-06-17)

The original design asked Claude to propose names → RouteStack verified them. In practice (live Bali
seed) Claude proposes famous resorts that aren't in RouteStack's (sparse, sandbox) inventory → **0
verified**. **Inverted flow (now the default):** take the hotels **RouteStack actually returns** for a
destination and stage *those* — real + bookable by construction, with RouteStack's **own grounded hero
images** (`result.content.heroImage` / `content.images[].links[].url`). **No LLM at all** in the
default path:
- An LLM proposing names yields poor verification against real inventory.
- An LLM proposing **image URLs hallucinates** broken/wrong links — never trust it for images. Images
  come from RouteStack (grounded) or fall back to the card placeholder (12g), never fabricated.

`seedPreviewFromRouteStack(client, destination, deps, {limit})` = `listPreviewHotelsFromRouteStack`
(search → top N → per-hotel `get-hotel-details-and-rates` for the hero image) → upsert `source='preview'`
with `images:[heroImage]`. Route: `POST /api/admin/preview/seed { destination, limit? }` → `{ found, staged, hotels[] }`.

> The Claude-proposes path (`proposeHotels` + `verifyAndStage`) is **kept** for a future enrichment
> option, but is NOT wired into the route. Cost note: the RouteStack-first flow makes 1 `search-hotels`
> + N `get-hotel-details-and-rates` calls per seed (one-time, bounded by `limit`).

## The honest contract (the spine — do not compromise)

- **No LLM in the default path** — every staged hotel is a real RouteStack-returned, bookable property
  with a real RouteStack hero image. No fabricated names, facts, or image URLs.
- **RouteStack is ground truth.** (Legacy Claude-propose path, if ever used: a name is kept **only if
  `search-hotels` returns it** in the correctly-resolved destination.)
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
5. ✅ Admin route `POST /api/admin/preview/seed` (operator-gated by `PREVIEW_SEEDING_ENABLED=1`) + `/admin/curation` "Seed preview (Claude + RouteStack)" button (reuses the PR #50 notice UX; reports proposed → verified → dropped).
6. ✅ Recommendation preview-tier: `hotels.source` threads through `hydrateHotels` → `HydratedHotel.source` → mapper `isPreview` → a neutral **Preview** badge on the card (no hard-flag colors). Phased rollout via the env gate.

## Tests (15 / 15a)

- `propose` with MockLanguageModel: JSON shape, count cap, no prose.
- `verify` with fake RouteStack transport: hit kept · miss dropped · RouteStack-down → warm-fail.
- Integration: seed → `hotels` rows are `source='preview'`; **guard** — no `hotel_intelligence` row for preview.
- Destination-resolution fix (10c): fake Google + fake candidates → nearest (correct) wins; no-Google → graceful fallback; "Bali" picks −8.34 over −17.5.

---

# 12i-B · Surfacing preview hotels so they BOOK (BUILT — 2026-06-17)

**Problem found in prod:** seeding works, but a preview-only destination (Bali) still tells the user
"not covered." Preview hotels are **invisible to the recommendation engine** — the consumption query
(`lib/review-intelligence/query.ts`) does `from('hotel_intelligence').select('…hotels!inner(*)')`, an
**INNER JOIN on `hotel_intelligence`**; preview hotels have no intelligence row → 0 candidates →
`runAssembly` returns `no_eligible_hotels` → the agent says "no coverage." So nothing ever puts a
preview hotel on a card, and **booking can't start because booking starts from a card.**

**Goal (scoped):** make the **booking flow work for preview hotels**. NOT to fake review-intelligence
recommendations for them.

## What is NOT the gap (verified by trace)

The booking flow needs only `{hotelId, hotelName, destination, party, dates}` and matches RouteStack by
name (`searchAndRates` → `matchHotelByName`). The card→booking wiring
(`ShortlistableRecommendationSet.toBookingHotel`) needs only `hotelId`+`hotelName`+`destination`. The
`PreviewBadge` already renders. `hydrateHotels` already selects `source` and does NOT filter by it.
**So everything downstream of "a preview card exists with its hotelId" already works.** The only gap is
**surfacing** — producing that card.

## The gap (single root cause)

The ONLY path to a card is `assemble_recommendations` → `runAssembly` → `queryCandidates` (intelligence
INNER JOIN) → LLM assembly (which REQUIRES per-hotel intelligence fields: verdict, category_summaries,
hard_flags, supporting_phrases — enforced by the Zod contract `recommendation-assembly.ts`). A preview
hotel can satisfy none of that, by design.

## Chosen approach — a SEPARATE preview path, NO LLM assembly

Do **not** try to make the intelligence-assembly accept null fields (pollutes the contract + the prompt
would fabricate the "family signal" language we forbid). Instead, a **lightweight preview path** that
emits cards directly from `hotels`, bypassing the LLM:

1. **`lib/preview/preview-recommendations.ts` (new)** — `previewRecommendations(client, destination, {budgetTier?})`:
   `select * from hotels where destination=? and source='preview'` (+ optional price_tier pre-filter),
   map to a **card shape directly** (name, destination, star, price tier label, hero image, `isPreview:true`),
   **no verdict / no hard_flags / no category_summaries**. Returns a `RecommendationSet`-compatible
   payload the existing cards render (top pick = first, others = rest), OR a `no_preview_hotels` marker.
2. **`runAssembly` fallback** — when `queryCandidates` yields 0 (the current `no_eligible_hotels` branch),
   check for preview hotels: if present, return a **`preview_recommendations` result variant** instead of
   the error. The agent tool forwards it; `hydrateHotels` already carries `source`.
3. **Card contract** — preview cards omit the intelligence-only fields. `StandardCardProps`/`TopPickCardProps`
   already make verdict/category_summaries OPTIONAL (per the existing 03b note), so a thin card is valid.
   The mapper marks `isPreview` (already wired, PR #54).
4. **System prompt (08b-1)** — add a short rule: *"For a destination with only preview hotels, present
   them honestly as bookable previews — name + 'bookable now, full review intelligence coming soon' — and
   do NOT invent reviews/flags/verdicts. Proceed-to-book still works."* Keeps the no-fabrication guarantee.
5. **Persist RouteStack id on seed (optimization, not a blocker)** — `seedPreviewFromRouteStack` should
   `saveHotelRsId` so the first booking skips the re-search. Booking works without it (name-match), so
   this is P2.

## Why this is the honest, minimal design

- Curated (intelligence-backed) path is **untouched** — the consumption contract 08a-5 stays pure.
- Preview path produces **only what's grounded** (real name/star/price/image from RouteStack) — no LLM,
  so zero fabrication risk; the "Preview" badge makes the tier explicit.
- Booking works the instant a preview card exists, because the booking flow never needed intelligence.

## Gaps → solutions summary

| Gap (file:line) | Blocks booking? | Solution |
|---|---|---|
| `query.ts` intelligence INNER JOIN | YES | New preview query (separate fn, not touching this one) |
| `run-assembly.ts` `no_eligible_hotels` on 0 | YES | Fallback to preview path when preview hotels exist |
| assembly prompt + Zod require intelligence | YES (for that path) | Bypass LLM assembly entirely for preview |
| system prompt "no coverage" framing | INDIRECT | Add preview-presentation rule (08b-1) |
| card render + booking wiring | NO | already preview-ready (PR #54) |
| `verify.ts` no `saveHotelRsId` | NO (optimization) | add saveHotelRsId (P2) |

## Out of scope (this plan)

- No review-intelligence-style verdicts/hard-flags for preview hotels (they have no reviews — that's the point).
- No mixing preview + curated in one recommendation set (a destination is either curated or preview, per current data).
- `/admin` auth gate — tracked separately as a launch risk (still applies before enabling seeding publicly).

## Decisions locked (2026-06-17, founder)

- **No-LLM preview cards** — thin card (name / star / price tier / RouteStack hero image + "Preview"
  badge), NO prose verdict, NO hard-flags, NO category summaries. Zero fabrication surface.
- **A destination is either curated OR preview** in one recommendation set — never mixed (matches the
  data; a destination has intelligence-backed hotels *or* preview hotels, not both).
- **Single PR** — all of the below ships in one PR (not phased), built spec-first.

## Build plan (ONE PR)

1. `lib/preview/preview-recommendations.ts` + unit tests (fake client → cards from preview rows; empty
   → `no_preview_hotels`; budget pre-filter respected).
2. `run-assembly` fallback + result variant + tests (0 intelligence + preview present → preview result;
   neither → existing `no_eligible_hotels` error).
3. Agent tool/result threading + `map-recommendation` handles the preview result variant + tests.
4. System prompt rule (08b-1) + prompt-contract test (preview-presentation; no fabrication).
5. `saveHotelRsId` on seed (the booking-id optimization — folded into the same PR).
6. E2E (15a): preview-only destination → card with Preview badge → Proceed-to-book reaches the stub.

## Tests

- `previewRecommendations`: returns cards for preview rows (no intelligence fields); empty → `no_preview_hotels`; budget pre-filter respected.
- `run-assembly`: destination with 0 intelligence + preview hotels → preview result (not error); 0 of both → `no_eligible_hotels`.
- E2E (15a): a preview-only destination → a card renders with the Preview badge → Proceed-to-book reaches the booking stub. (Closes the loop the prod bug exposed.)

---

# 12i-C · On-the-fly preview seeding from chat (BUILT — 2026-06-17)

**Goal.** When a user asks about one of the five destinations that has **no hotels in the DB**, seed
its preview hotels **at runtime** and surface them — instead of "coming soon." Today preview seeding is
operator-only (`/admin/preview/seed`, `PREVIEW_SEEDING_ENABLED`); this makes it happen automatically on
first user demand.

## Decisions locked (2026-06-17, founder) + architecture resolution (build-time)

- **Seed-once per destination, then cached.** The FIRST user to ask an empty destination triggers the
  seed; everyone after reads the seeded rows (the existing `previewRecommendations` path). Bounds total
  cost to ~5 seeds, ever — not per-request.
- **Five enum destinations only.** No new/arbitrary destinations (the brief enforces the 5-enum). "A
  destination that doesn't exist" = one of the five with zero hotels, not Tokyo.
- **RESOLVED at build (the spec's open question): FAST SEED, INLINE — no async needed.** The 45s seed
  was dominated by the per-hotel `get-hotel-details-and-rates` image loop. A **fast seed** does ONLY the
  single `search-hotels` call (~a few seconds) and stages names/star/price with `images:null` (card
  shows the 12g placeholder — still bookable). That fits inside the chat turn's 60s budget, so the seed
  runs **inline** and the SAME turn returns preview cards — simpler and better UX than async, and
  `unstable_after` isn't available in Next 14.2.35 anyway (verified). Images backfill later via the
  operator `/admin/preview/seed` (full seed) or a future job. So: founder's "async + come back" intent
  is satisfied by an in-turn fast seed instead — no "say show me" round-trip, no background-exec risk.

## Why this is safe (vs. the operator-gated worry)

Runtime seeding means an END USER triggers paid RouteStack/Google calls. The **seed-once + cache** rule
caps that to one seed per destination total; a **concurrency guard** (a single in-flight seed per
destination) prevents a thundering herd; and a **feature flag** (`PREVIEW_RUNTIME_SEED`) gates the whole
behavior so it's off until the founder turns it on. No fabricated data — same RouteStack-first,
grounded-image, honest-preview pipeline as 12i-B.

## Flow

```
user: "beach resort for family in Bali"   (Bali has 0 hotels in DB)
  agent gathers destination + trip type (unchanged)
  → assemble_recommendations tool runs runAssembly
     → queryCandidates = 0 (no intelligence)
     → previewRecommendations = no_preview_hotels (0 preview rows)
     → NEW: if PREVIEW_RUNTIME_SEED on AND no seed in-flight/done for this dest:
          - mark a seed "running" (dedupe), kick seedPreviewFromRouteStack in the BACKGROUND
          - return a `preview_seeding` result → agent says "Give me a moment, gathering bookable
            options for Bali…" (a `researching` pill, no cards yet)
  next turn (user says "ok" / "show me" OR a lightweight client poll):
     → runAssembly runs again → previewRecommendations now finds the seeded rows
       → preview_recommendations → cards render (Preview badge), bookable.
```

## Components

1. **Seed tracker (dedupe + once)** — a tiny `preview_seeds` table (migration `0014`):
   `destination` (PK, the 5-enum) · `status` (`running` | `done` | `failed`) · `started_at` ·
   `finished_at` · `hotel_count` · `error`. Service-role only (RLS, no policies). `running` blocks a
   second concurrent seed; `done` means "already seeded — never re-seed." (Lighter than reusing
   `apify_runs`; this is a per-destination latch, not a run ledger.)
2. **`lib/preview/runtime-seed.ts`** — `ensurePreviewSeed(client, destination, deps)`:
   - read `preview_seeds[destination]`; if `done` → return `already_seeded`; if `running` → return
     `in_progress`; else claim `running` (atomic upsert), and **fire-and-forget**
     `seedPreviewFromRouteStack` → on success mark `done` + `hotel_count`, on error mark `failed`.
   - Returns immediately (`started` | `in_progress` | `already_seeded`) — never blocks the turn.
   - Background work uses `after()` (Next.js `unstable_after`) or a detached promise so the response
     streams while seeding continues server-side. (If the platform kills detached work, fall back to a
     dedicated `/api/preview/seed-bg` the client fire-pings — decide at build time.)
3. **`run-assembly` extension** — when `previewRecommendations` is empty AND `PREVIEW_RUNTIME_SEED` is
   on, call `ensurePreviewSeed`; return a new **`preview_seeding`** result variant
   `{ result:'preview_seeding', destination, state:'started'|'in_progress' }`. Else the existing
   `no_eligible_hotels`.
4. **Agent + prompt (08b-1)** — on `preview_seeding`, the agent emits a brief honest line
   ("Gathering bookable options for {destination} — give me a moment, then say 'show me'") and a
   `researching` pill; NO cards yet. On the next assemble call it gets `preview_recommendations`.
5. **Surfacing the result** — two options (pick at build): (a) **prompt the user to re-ask** ("say
   'show me Bali'") — zero new client plumbing, leans on the existing turn loop; or (b) a **client
   poll** that re-calls assemble every few seconds until cards arrive. (a) is simpler and matches the
   conversational model; start there.

## Honest contract (unchanged)

Runtime seeding uses the **same RouteStack-first, no-LLM, grounded-image** pipeline (12i-B). Preview
cards stay clearly badged; nothing fabricated. The only change is WHO triggers the seed (a user, once)
and WHEN (on first demand) — not WHAT gets stored.

## Cost / abuse controls

- `PREVIEW_RUNTIME_SEED=1` gates the whole feature (off by default).
- Seed-once: `preview_seeds.status='done'` → never re-seed (cost capped at ~5 seeds total).
- Concurrency latch: `status='running'` → a second request gets `in_progress`, not a second seed.
- Bounded `limit` (e.g. 8) per seed — unchanged.
- (Optional later) a global daily seed cap as a backstop.

## Out of scope

- New/arbitrary destinations (still the 5-enum).
- Re-seeding / refreshing a `done` destination at runtime (operator `/admin` re-seed still exists for that).
- Review intelligence for preview hotels (they have none — that's the tier).

## Build plan (ONE PR)

1. migration `0014_preview_seeds.sql` + `lib/preview/runtime-seed.ts` (latch + background seed) + tests.
2. `run-assembly` → `preview_seeding` variant when empty + flag on + `ensurePreviewSeed`; tests
   (empty+flag→started; second call→in_progress; flag off→no_eligible_hotels).
3. Agent/prompt: present `preview_seeding` as a "gathering…" pill + the re-ask nudge; prompt-contract test.
4. map-recommendation / chat: render the seeding state (researching pill, no cards).
5. Integration (real DB, no LLM): empty dest + flag → seed latch claimed; second call sees `running`;
   after seed completes, runAssembly returns preview cards. (Background seed stubbed/awaited in test.)
6. 13 · Environment: document `PREVIEW_RUNTIME_SEED`.

## Open question for build (flag at PR time, not now)

**Background-execution mechanism on Vercel.** `unstable_after` runs work after the response on Vercel,
but its time budget is limited and a ~45s seed may exceed it. If so, the seed must run as its own
request (a `/api/preview/seed-bg` the server kicks, or the existing on-demand worker). The "fast seed,
defer images" idea (one search call, images later) is the natural mitigation if background time is
tight — fold in only if needed. Resolve by measuring `unstable_after`'s real budget during build.
