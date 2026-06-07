# 12a · Hotel Curation Tool

- **Notion:** https://app.notion.com/p/3754958429ac81d3afc3db0f1ead3748
- **Phase:** 1 · **Status:** BUILT (phase-1-curation) — mock-mode-first; live Apify path wired but exercised once a token is provided

> Built: `/app/admin/curation/page.tsx` + routes `fetch-hotels`, `hotels` (list/PATCH), `publish-hotels`. Lib: `lib/curation/{types,validator,fetch,images,publish}.ts`. Mock fixtures: `scripts/seed/fixtures/{phuket,bali}.json`. Hero images stored to the `hotel-images` bucket on publish (12g). Tests: `tests/unit/curation-validator.test.ts` + `tests/integration/curation.test.ts`. The `seed-intelligence` route + its button are Phase 1c.

Web-based internal admin tool at `/admin/curation` (Next.js App Router). **No auth in v1.** Fully resumable (state persisted to `curation_hotels`).

## Files

```
/app/admin/curation/page.tsx, layout.tsx
/app/api/admin/fetch-hotels/route.ts
/app/api/admin/hotels/route.ts
/app/api/admin/publish-hotels/route.ts
/app/api/admin/seed-intelligence/route.ts        (see 12d)
/lib/curation/apify.ts, playwright.ts, validator.ts, types.ts
/scripts/seed/fixtures/[destination].json          (mock mode)
```

## Staging table

`curation_hotels` — see `docs/data-model.md`. Columns: name, destination, tripadvisor_url, tripadvisor_rank, review_count, google_place_id, brand, price_tier, star_rating, images[], latitude, longitude, address, status (pending|approved|rejected), fetch_source (apify|playwright|manual), fetched_at, updated_at. (latitude/longitude/address added 2026-06-07, migration 0010 — geo matching inputs for the place-id resolver.)

## Scraping layer

- **Primary:** Apify (TripAdvisor Hotel Search actor — configurable actor-ID env var; see 13).
- **Fallback:** Playwright.
- **Mock mode:** static fixtures at `/scripts/seed/fixtures/[destination].json`.
- `APIFY_API_TOKEN` optional — degrades gracefully to fallback/mock.

## Google Place-ID resolution (added 2026-06-07)

The TripAdvisor search actor returns no `google_place_id` (the Google-reviews half of the pipeline needs it). A separate, re-runnable **"Resolve Place IDs"** step fills it for staged rows:
- `POST /api/admin/curation/resolve-places { destination? }` → `lib/curation/resolve-places.ts` over `curation_hotels` rows with a null `google_place_id`.
- Per row, calls Google Places **Text Search (New)** (`lib/curation/google-places.ts`, ID-only field mask) biased to the hotel's `latitude`/`longitude` (captured from the TA actor) with `includedType: lodging`; takes the top match.
- No match → left null, reported skipped (`no_match`). No lat/long → resolved name-only and flagged **low-confidence** for a founder double-check. `GOOGLE_PLACES_API_KEY` absent → 400 with a clear notice (env-gated; CI key-free).
- The founder can paste/override a `google_place_id` inline per card (PATCH `/api/admin/hotels`, whitelisted fields). Publish then carries `google_place_id` → `hotels` as before.

## UI

Header: destination tabs + count badges, "Fetch Hotels" button per destination, **"Resolve Place IDs"** button, "Publish to Hotels" button, "Seed Demo Intelligence" button. Hotel cards editable inline (incl. a place-id field + resolved status); status badge; Approve/Reject buttons.

## Rules

- Only hotels with **100+ reviews** may be approved.
- Destination / price_tier / star_rating / brand are enforced dropdowns.
- Publish blocked if name / destination / tripadvisor_url missing, **or if the hotel has 0 images** (see 12g).
- Publish upserts approved rows to live `hotels` on `(name, destination)`. Re-fetch preserves prior decisions (upsert).

## Env

`APIFY_API_TOKEN` (optional), `APIFY_TRIPADVISOR_SEARCH_ACTOR_ID`, `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (server-only).

## Action items (from Notion, verbatim)

1. Build the Hotel Curation Tool UI at `/app/admin/curation/`.
2. Integrate Apify scraper (or Playwright fallback).
3. Implement `curation_hotels` staging table + CRUD API routes.
4. Build "Publish to Hotels" endpoint (direct Supabase upsert to `hotels`).
5. Add "Seed Demo Intelligence" button + route (see 12d).
6. Implement mock fixture loading for dev/test.
7. Enforce curation rules (100+ reviews, dropdowns, validation).

## Tests (12b)

10 acceptance criteria: page load, fetch, cards, approve/reject, inline edit, filters, state persistence, publish, rule enforcement, re-fetch upsert. Perf: page load <2s, Apify fetch <30s, Playwright <60s, approve/reject <500ms.
