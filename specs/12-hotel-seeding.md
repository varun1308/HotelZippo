# 12 · Hotel Seeding Strategy

- **Notion:** https://app.notion.com/p/3744958429ac81faad33ee4727baf8fc
- **Phase:** 1 · **Status:** specced

## Selection

250 hotels = top 50 per destination (Phuket, Hong Kong, Singapore, Maldives, Bali) by **TripAdvisor Traveller Ranking**, filtered to **100+ reviews minimum**. Per-hotel data: name, destination, tripadvisor_url, google_place_id, brand, price_tier, images, star_rating (3/4/5).

## Pipeline (Phase 1 build order)

1. Build the Hotel Curation Tool (12a) at `/admin/curation`.
2. Curate hotels → **Publish to Hotels** (direct upsert to `hotels`; CSV retired).
3. Hand-craft the 10 demo `hotel_intelligence` JSON files (5 Phuket, 5 Bali) — see 12d.
4. Click **Seed Demo Intelligence** → upserts demo records (12d).
5. Verify Phase 1 acceptance criteria (15).

## Demo intelligence scope

10 records power the Phase 2–3 demo **before** the real pipeline (Phase 6). Structure + selection rules in 12d.

> ⚠️ **Open item:** the 10 demo records' *content* is not yet authored (see `docs/spec-coverage.md` / plan §Risks). Only the structure exists in 12d.

## Action items

See child specs: `12a-curation-tool.md`, `12d-seed-script.md`, `01b-image-sourcing.md`.
