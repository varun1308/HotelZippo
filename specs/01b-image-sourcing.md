# 01b · Hotel Image Sourcing & Hosting

- **Notion:** 12g — https://app.notion.com/p/3754958429ac810c8859e1a690ecc747
- **Phase:** 1 · **Status:** specced (v1 hero; richer imagery post-v1)
- **Filename note:** Notion 16 keys 12g to `/specs/01b-image-sourcing.md`.

## v1 approach

Download the TripAdvisor **hero** image server-side on publish → upload to Supabase Storage (`hotel-images` bucket, public-read) → write the **Storage URL** (not the TripAdvisor URL) to `hotels.images[0]`. No AI-generated images.

## Flow

1. **Curation (12a):** store the hero image URL from the TripAdvisor actor result on `curation_hotels.images`.
2. **Publish-to-Hotels (12a):** download server-side → upload to Storage → write Storage URLs to `hotels.images`.
3. **Serve:** `next/image` with the Supabase Storage domain allow-listed in `next.config` `images.remotePatterns`.

## Edge cases

- Zero usable images → placeholder + flag for founder to add manually.
- Broken/oversized source → skip + log.
- **Block publish if a hotel has 0 images.**
- Card honours the 05 elegant placeholder (`.photo-slot`) — never a broken image.

## Post-v1 (deferred)

Richer imagery via RouteStack MCP or a separate content MCP.

## Action items (from Notion, verbatim)

1. Create `hotel-images` Supabase Storage bucket (public-read) + access policy.
2. In Publish-to-Hotels: download `curation_hotels.images` → upload to Storage → write Storage URLs to `hotels.images`.
3. Add Storage domain to `next.config` `images.remotePatterns`; use `next/image` in the card.
4. Extend publish validation: block publish if a hotel has 0 images.
5. (This file generated from the Notion page.)
