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
| `ROUTESTACK_DEBUG_PAYLOADS` | server-only | **Debug gate (Phase 7).** `=1` persists each RouteStack call's REDACTED request/response into the service-role-only `raw_routestack_payloads` table for replay/inspection (`lib/booking/payload-log.ts`). Off by default → zero capture. Redaction (token / correlationId / payment URL / Authorization / guest PII masked) is ALWAYS applied before insert; the table is service-role only (RLS, no policies). Best-effort: a capture failure never affects a booking. Retention is operator-managed (no auto-TTL). The OTEL-logs half is deferred. |
| `ROUTESTACK_WEBHOOK_SECRET` | server-only | **Webhook auth (Phase 7 · 10d).** Shared secret matching RouteStack's dashboard **Webhook access key**. When set, `POST /api/webhooks/routestack` verifies every inbound order-lifecycle delivery (timing-safe, checked across the likely header/query carriers) and **401s** on mismatch. UNSET (local/dev) → verification skipped with a `console.warn` so sandbox pings work. Configure the matching URL (`https://<host>/api/webhooks/routestack`) + key in RouteStack's Webhook Settings (Sandbox first). |
| `ROUTESTACK_MOCK` | server-only | **Demo mode (Phase 7 · 10e).** `=1` swaps the live RouteStack HTTP transport for a deterministic in-process mock (`lib/booking/mock-transport.ts`) so the FULL booking journey (search → rates → revalidate → payment-url → mock checkout → self-emitted `BOOKING_SUCCESS` webhook → `booking_orders` CONFIRMED) is showable in production without the unstable RouteStack sandbox. The whole orchestrator + rates mapper + webhook lifecycle run unchanged; only the upstream booking HTTP is faked — the curated hotel intelligence stays 100% real. **NOT `NEXT_PUBLIC_`** → never baked into the browser bundle → the `preflight.mjs` build guard needs no change and a prod build is unaffected. The deep-link points at the in-app `/booking-demo` page; `POST /api/booking/mock-confirm` (gated on this flag → 403 when off) self-emits the webhook. Off/unset → byte-for-byte the live behaviour. **Flip to fully live = unset + redeploy** (no code change). |
| `ASSEMBLY_MODEL` | server-only | **Recommendation-assembly model (03c).** Overrides the model for the assembly LLM call; default `claude-haiku-4-5` (chosen for latency/cost — `~34s` Sonnet → `~15s` Haiku, the fix for the prod 60s `/api/chat` timeout). Set `claude-sonnet-4-6` to revert. The assembly output is contract-validated either way. |
| `ASYNC_ASSEMBLY` | server-only | **Async assembly (03c).** `=1` runs recommendation assembly as a durable JOB (`recommendation_jobs`) that a worker route processes on its own budget and the client polls for staged progress + cards — so the slow LLM call never rides the `/api/chat` 60s function cap, survives a reload (re-attaches the in-flight job), and shows the user honest progress. **NOT `NEXT_PUBLIC_`.** Off/unset → the synchronous inline path (today's behaviour). |
| `GOOGLE_CLIENT_ID` | server-only | Google OAuth client ID (Phase 4) |
| `GOOGLE_CLIENT_SECRET` | server-only | Google OAuth client secret (Phase 4) |
| `GOOGLE_PLACES_API_KEY` | server-only | Google Places **Text Search (New)**, ID-only field mask — resolves curated hotels → `google_place_id` (12a). Free 10k/mo SKU. Distinct from the OAuth creds. |
| `DASH0_API_KEY` | server-only | OTEL export to Dash0 |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | server-only | Dash0 OTLP endpoint URL |
| `DASH0_DATASET` | server-only | Dash0 dataset selector — sent as the `Dash0-Dataset` header (`lib/otel/dash0-headers.ts`; optional, default `(default)`) |
| `PIPELINE_POLL_MS` | server-only | Review-intelligence worker poll interval, ms (`scripts/pipeline/run-worker.ts`; optional, default 5000) |
| `PIPELINE_REFRESH` | server-only | **Cost guard.** `=1` forces a destination pipeline run to re-synthesise EVERY hotel. Default (unset): a destination run processes **only hotels missing a `hotel_intelligence` row** (`resolveHotels`), so re-running to finish a partial destination never re-scrapes/re-bills Apify for already-completed hotels. Single-hotel (`scope_type='hotel'`) runs are always processed. |
| `CURATION_USE_CACHE` | server-only | **Dev only.** `=1` replays cached Apify/Places responses instead of live calls (`lib/dev/actor-cache.ts`). MUST be unset in production. |
| `PREVIEW_SEEDING_ENABLED` | server-only | **Operator gate (12i).** `=1` enables `POST /api/admin/preview/seed` (Claude proposes hotel names → RouteStack verifies → `source='preview'` rows). Phased: leave UNSET until preview is ready to go live; the route returns 403 otherwise. Uses `ANTHROPIC_API_KEY` + `ROUTESTACK_*` + `GOOGLE_PLACES_API_KEY`. |
| `PREVIEW_RUNTIME_SEED` | server-only | **Runtime-seed gate (12i-C).** `=1` lets the chat agent seed a 5-enum destination's preview hotels ON THE FLY (once, cached via `preview_seeds`) when it has no hotels, so cards surface in-turn. Off by default. A user request triggers paid RouteStack/Google calls, so the seed-once latch caps cost to ~5 seeds ever. Uses `ROUTESTACK_*` + `GOOGLE_PLACES_API_KEY` (no Anthropic — RouteStack-first, fast seed). |
| `NEXT_PUBLIC_ENABLE_DEV_LOGIN` | public | **Dev/E2E only.** `=true` enables the email/password sign-in that BYPASSES Google OAuth (`lib/auth/devSignin.ts`). MUST be unset in production — the build guard (`scripts/build/preflight.mjs`) fails `next build` if it is set. |
| `NEXT_PUBLIC_E2E` | public | **E2E only.** `=1` injects chat + booking test stubs (`lib/chat/e2e-stub.ts`, `lib/booking/e2e-stub.ts`). MUST be unset in production — blocked by the same build guard. |

## Rules

1. All AI inference is server-side only — `ANTHROPIC_API_KEY` never in client code.
2. `SUPABASE_SERVICE_ROLE_KEY` server-side only — never passed to client or in API responses.
3. `NEXT_PUBLIC_` is reserved for browser-safe values — all others are server-side.
4. `.env.local` is always in `.gitignore` — include in the initial scaffold.
5. `DASH0_API_KEY` and `OTEL_EXPORTER_OTLP_ENDPOINT` are server-side only.
6. `NEXT_PUBLIC_ENABLE_DEV_LOGIN`, `NEXT_PUBLIC_E2E`, and `CURATION_USE_CACHE` are dev/E2E-only and **must be unset in production**. A build-time guard (`scripts/build/preflight.mjs`, run as `prebuild`) fails `next build` if the first two are set; the CI E2E build opts out via `ALLOW_UNSAFE_FLAGS=1`. See [18 · Deployment Runbook](18-deployment-runbook.md).

## Setup order (new environment)

1. Create Supabase project → URL + keys. 2. Enable Google OAuth in Supabase Auth → client ID + secret. 3. Create Anthropic API key. 4. Create Apify account → token. 5. RouteStack key + base URL. 6. Dash0 account → key + OTLP endpoint. 7. Populate `.env.local` from `.env.example`.

## Action items (from Notion)

- Scaffold `.env.example` from this page directly (all names, empty values, one-line descriptions).
- Ensure `.env.local` is in `.gitignore` in the initial scaffold.

## Pre-flight note

All variable **names** are known and can be templated now. **No values exist yet** — every variable is currently unset and must be filled per the setup order before the corresponding phase can run live.
