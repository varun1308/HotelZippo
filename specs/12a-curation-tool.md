# 12a · Hotel Curation Tool

- **Notion:** https://app.notion.com/p/3754958429ac81d3afc3db0f1ead3748
- **Phase:** 1 · **Status:** BUILT (phase-1-curation), live-verified, then **superseded for fetching by the Apify Run Ledger** (12h, 2026-06-16): the synchronous "Fetch Hotels" button is replaced by an async **Start Fetch → poll → Ingest** flow + a Runs history panel. Approve/Resolve-Place-IDs/Publish/Seed unchanged; operator-feedback UX hardened after the live Phuket smoke.

> Built: `/app/admin/curation/page.tsx` + routes `fetch-hotels` (legacy sync, still present), the ledger routes `curation/run/{start,status,ingest}` + `curation/runs` (12h), `hotels` (list/PATCH), `publish-hotels`, `curation/resolve-places`. Lib: `lib/curation/{types,validator,fetch,images,publish,stage,e2e-stub}.ts` + `lib/apify/{client,run-ledger}.ts`. Mock fixtures: `scripts/seed/fixtures/{phuket,bali}.json`. Hero images stored to the `hotel-images` bucket on publish (12g). Tests: `tests/unit/curation-validator.test.ts`, `tests/unit/curation-page.test.tsx`, `tests/integration/curation.test.ts`, the ledger/route tests (12h), and the E2E journey `e2e/curation.spec.ts` (J5, 15a). The `seed-intelligence` route + its button are Phase 1c.

> **Fetching now goes through the Apify Run Ledger — see [12h · Apify Run Ledger](12h-apify-run-ledger.md).** The staging table, Resolve Place IDs, approve/publish rules, and env below are current; the legacy "Fetch Hotels" / Playwright fallback notes describe the original Phase-1 synchronous tool.

Web-based internal admin tool at `/admin/curation` (Next.js App Router). **No auth in v1.** Fully resumable (state persisted to `curation_hotels`).

## Files

```
/app/admin/curation/page.tsx, layout.tsx
/app/api/admin/fetch-hotels/route.ts             (legacy sync fetch — superseded by the ledger routes)
/app/api/admin/curation/run/{start,status,ingest}/route.ts, /app/api/admin/curation/runs/route.ts   (Apify Run Ledger — see 12h)
/app/api/admin/curation/resolve-places/route.ts  (Google place-ID resolution)
/app/api/admin/hotels/route.ts
/app/api/admin/publish-hotels/route.ts
/app/api/admin/seed-intelligence/route.ts        (see 12d)
/lib/curation/{types,validator,fetch,stage,images,publish,e2e-stub}.ts, /lib/apify/{client,run-ledger}.ts
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

Header: destination tabs + count badges, **"Start Fetch"** button per destination (ledger-driven async fetch — Start → poll → **Ingest** — see **12h**, replaces the old blocking "Fetch Hotels"), **"Resolve Place IDs"** button, "Publish to Hotels" button, "Seed Demo Intelligence" button. A **Runs panel** lists prior Apify runs (history + a prominent free **Ingest** call-to-action for a succeeded-but-un-ingested run; the **"Refresh — new paid run"** action is visually subordinate so it isn't mistaken for the free next step). Hotel cards show a **hero thumbnail + image count** (a 0-image card is flagged inline as won't-publish), are editable inline (place-id field + resolved status); status badge; Approve/Reject buttons.

**Operator feedback (2026-06-16 — surfaced by the live Phuket smoke):**
- **Approve is disabled** (with a `title` reason + an inline hint) for sub-100-review hotels — the rule is enforced *before* the click, not only as a post-PATCH error. The server PATCH still re-validates as the source of truth.
- The single page notice is **typed** (ok / info / error): success shows in the success style, problems in a bordered neutral panel — **no amber/red** (those stay reserved for hard-flags per 05).
- **Publish names what it skipped and why** (e.g. "Skipped 1: No Pic Hotel (Needs at least one image)") instead of a bare count.

**Operator-scale triage (2026-06-16 — ~250 hotels ≈ 50/destination):** a flat list doesn't scale, so the candidate list is filtered/searched/sorted client-side over the loaded rows:
- **Status filter chips** (Pending / Approved / Rejected / All) with live counts; default = **Pending** (the queue that needs a decision). A "{n} staged · {m} ready to publish" line shows progress.
- **Name search** + **sort** (TripAdvisor rank · review count · "needs attention" = missing-image/sub-100 first).
- **Bulk approve** — "Approve eligible in view (n)" PATCHes every *visible eligible* row (≥100 reviews, not already approved) sequentially so the server guard stays authoritative; reports approved + any that failed. Image remains a publish-time gate, not approve-time.
- These run client-side (fine to a few hundred rows). **Server-side pagination in `/api/admin/hotels` is deferred** until a single destination exceeds ~100 (YAGNI at 50/destination).

## Rules

- Only hotels with **100+ reviews** may be approved — the Approve button is **disabled with a reason** below the threshold (UI) and the PATCH route + publish re-validate server-side.
- Destination / price_tier / star_rating / brand are enforced dropdowns.
- Publish blocked if name / destination / tripadvisor_url missing, **or if the hotel has 0 images** (see 12g) — the card shows the image count so this is visible pre-publish.
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
