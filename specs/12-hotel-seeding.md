# 12 · Hotel Seeding Strategy

- **Notion:** https://app.notion.com/p/3744958429ac81faad33ee4727baf8fc
- **Phase:** 1 · **Status:** built ✅ (curation + publish + demo seed live-verified; see 12a/12d)

## Selection

250 hotels = top 50 per destination (Phuket, Singapore, Tokyo, Orlando, Bali) by **TripAdvisor Traveller Ranking**, filtered to **100+ reviews minimum**. Per-hotel data: name, destination, tripadvisor_url, google_place_id, brand, price_tier, images, star_rating (3/4/5).

## Pipeline (Phase 1 build order)

1. Build the Hotel Curation Tool (12a) at `/admin/curation`.
2. Curate hotels → **Publish to Hotels** (direct upsert to `hotels`; CSV retired).
3. Hand-craft the 10 demo `hotel_intelligence` JSON files (5 Phuket, 5 Bali) — see 12d.
4. Click **Seed Demo Intelligence** → upserts demo records (12d).
5. Verify Phase 1 acceptance criteria (15).

## Demo intelligence scope

10 records power the Phase 2–3 demo **before** the real pipeline (Phase 6). Structure + selection rules in 12d.

> ⚠️ **Open item (2026-06-05):** the 10 demo records now EXIST as Claude-authored *placeholder* content (fabricated, not from real reviews) — the founder owns final content and may revise wholesale before launch. Structure + selection rules in 12d.

## Acceptance criteria

- **AC1** — each curated destination has its top-N published rows in `hotels` (N = `APIFY_SEARCH_MAX_RESULTS`, default 50), every row satisfying the publish gates: 100+ reviews and ≥1 image (12a / 01b).
- **AC2** — exactly 10 demo `hotel_intelligence` records seeded (5 Phuket, 5 Bali), idempotent on re-seed (12d scenarios).
- **AC3** — no published hotel renders a broken hero image (01b placeholder rule).
- **AC4** — the recommendation flow (03b) can assemble cards for a seeded destination without touching `raw_reviews`.

## Action items

See child specs: `12a-curation-tool.md`, `12d-seed-script.md`, `01b-image-sourcing.md`.
