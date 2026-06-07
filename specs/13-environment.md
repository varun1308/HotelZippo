# 13 · Environment & Secrets Map

- **Notion:** https://app.notion.com/p/3744958429ac818cad2adcae5a4fe82e
- **Phase:** 0 · **Status:** specced

Actual values are never stored in the repo — only variable names + purpose. `.env.local` is git-ignored; `.env.example` is committed with all names, empty values, and one-line descriptions.

## Variables

| Variable | Browser-safe? | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | server-only | Authenticates all Claude API calls |
| `NEXT_PUBLIC_SUPABASE_URL` | public | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | public | Supabase anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | server-only | Service role key — never exposed to client |
| `APIFY_API_TOKEN` | server-only | Authenticates Apify actor runs |
| `APIFY_TRIPADVISOR_REVIEWS_ACTOR_ID` | server-only | TripAdvisor Reviews Scraper actor (Phase 6) |
| `APIFY_GOOGLE_REVIEWS_ACTOR_ID` | server-only | Google Maps Reviews Scraper actor (Phase 6) |
| `APIFY_TRIPADVISOR_SEARCH_ACTOR_ID` | server-only | TripAdvisor Hotel **Search** actor used by curation tool (12a). Confirm exact name against 12a. |
| `APIFY_SEARCH_MAX_RESULTS` | server-only | Curation hotel-search over-fetch cap (`lib/curation/fetch.ts`; optional, default 50) |
| `APIFY_REVIEWS_MAX_RESULTS` | server-only | Per-source review-scrape over-fetch cap (`lib/review-intelligence/apify.ts`; optional, default 600) |
| `ROUTESTACK_API_KEY` | server-only | RouteStack partner API key (public identifier) — used in the HMAC token exchange (Phase 7) |
| `ROUTESTACK_API_SECRET` | server-only | RouteStack partner secret — signs the HMAC (`apiKey:timestamp:nonce`) for the partner-token exchange; never exposed to client (Phase 7) |
| `ROUTESTACK_API_URL` | server-only | RouteStack HTTP base URL — sandbox `https://evolvemcp.routestack.ai` (Phase 7) |
| `GOOGLE_CLIENT_ID` | server-only | Google OAuth client ID (Phase 4) |
| `GOOGLE_CLIENT_SECRET` | server-only | Google OAuth client secret (Phase 4) |
| `GOOGLE_PLACES_API_KEY` | server-only | Google Places **Text Search (New)**, ID-only field mask — resolves curated hotels → `google_place_id` (12a). Free 10k/mo SKU. Distinct from the OAuth creds. |
| `DASH0_API_KEY` | server-only | OTEL export to Dash0 |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | server-only | Dash0 OTLP endpoint URL |
| `PIPELINE_POLL_MS` | server-only | Review-intelligence worker poll interval, ms (`scripts/pipeline/run-worker.ts`; optional, default 5000) |

## Rules

1. All AI inference is server-side only — `ANTHROPIC_API_KEY` never in client code.
2. `SUPABASE_SERVICE_ROLE_KEY` server-side only — never passed to client or in API responses.
3. `NEXT_PUBLIC_` is reserved for browser-safe values — all others are server-side.
4. `.env.local` is always in `.gitignore` — include in the initial scaffold.
5. `DASH0_API_KEY` and `OTEL_EXPORTER_OTLP_ENDPOINT` are server-side only.

## Setup order (new environment)

1. Create Supabase project → URL + keys. 2. Enable Google OAuth in Supabase Auth → client ID + secret. 3. Create Anthropic API key. 4. Create Apify account → token. 5. RouteStack key + base URL. 6. Dash0 account → key + OTLP endpoint. 7. Populate `.env.local` from `.env.example`.

## Action items (from Notion)

- Scaffold `.env.example` from this page directly (all names, empty values, one-line descriptions).
- Ensure `.env.local` is in `.gitignore` in the initial scaffold.

## Pre-flight note

All variable **names** are known and can be templated now. **No values exist yet** — every variable is currently unset and must be filled per the setup order before the corresponding phase can run live.
