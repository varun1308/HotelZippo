# 18 · Production Deployment Runbook (Vercel + Supabase)

- **Notion:** https://app.notion.com/p/3764958429ac816db9dcde79dba3feab (18 · Deployment & Launch Checklist)
- **Phase:** 8 · Launch · **Status:** runbook (authored 2026-06-16)
- **Companion:** [13 · Environment & Secrets Map](13-environment.md) (variable catalogue), [10a · Supabase](10a-supabase.md), [04 · Auth & Persistence](04-auth-persistence.md), [02 · Review-Intelligence Pipeline](02-review-intelligence-pipeline.md).

> Notion 18 is the operational launch *checklist*; this file is the detailed *runbook/procedure* kept
> in sync with it (the 2026-06-16 launch-prep decisions below are also appended to Notion 18).

The end-to-end procedure to take HotelZippo live on **Vercel** (Next.js app) + **Supabase Cloud**
(Postgres / Auth / Storage). Variable *names + purpose* live in spec 13; this page is the *procedure*
and the launch-specific decisions. Actual secret **values** never appear in the repo.

## Architecture (what runs where)

| Component | Host | Notes |
|---|---|---|
| Next.js 14 app (chat, booking, curation routes, auth callback) | **Vercel** (serverless) | `next build` / `next start`, no overrides |
| Postgres + Auth + Storage | **Supabase Cloud** | migrations `0001`–`0011`; `hotel-images` bucket |
| Review-intelligence pipeline worker (`scripts/pipeline/run-worker.ts`) | **NOT on Vercel** | long-running poll loop; serverless can't host it. **Launch decision: run on-demand only** (manual pre-launch curation; no always-on worker). Add Vercel Cron / a dedicated host later. |

## Launch decisions (locked 2026-06-16)

1. **Pipeline worker → on-demand only.** No always-on worker for launch. Intelligence is curated
   manually before launch and refreshed deliberately. Consequence: **the Vercel app needs NO Apify
   env vars** — Apify lives only wherever curation is run.
2. **Build-time safety guard → shipped.** `scripts/build/preflight.mjs` runs as `prebuild` and
   **fails `next build`** if `NEXT_PUBLIC_ENABLE_DEV_LOGIN==='true'` or `NEXT_PUBLIC_E2E==='1'`.
   The CI E2E build opts out via `ALLOW_UNSAFE_FLAGS=1` (the `e2e:build` script). This makes the
   auth-bypass / test-stub footgun impossible to ship to production.
3. **Production data → live curation pipeline.** Real hotels + intelligence are curated into the
   prod DB via the real Apify + Google Places + Claude flow (costs API credits → run deliberately,
   cache-banked first). The dev seed (`supabase/seed.sql`) is git-ignored, demo-only, **never** prod.

## Environment variables by host

> Full catalogue + browser-safety rules: [spec 13](13-environment.md). This is the *placement* map.

### On Vercel (the app)
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` — public (RLS-enforced in browser).
- `SUPABASE_SERVICE_ROLE_KEY` — **secret** (bypasses RLS; server routes only).
- `ANTHROPIC_API_KEY` — **secret** (chat / synthesis / recommendations).
- `ROUTESTACK_API_KEY`, `ROUTESTACK_API_SECRET`, `ROUTESTACK_API_URL` — **secret**. ⚠️ `_URL` must be
  the **production** RouteStack endpoint, not the sandbox `https://evolvemcp.routestack.ai`.
- `GOOGLE_PLACES_API_KEY` — **secret** (curation place resolution; needed on the app only if curation
  routes run server-side in prod — otherwise worker-side).
- `DASH0_API_KEY`, `OTEL_EXPORTER_OTLP_ENDPOINT`, `DASH0_DATASET` — optional (prod observability).

### MUST be UNSET on Vercel (now build-guarded — leaving them on aborts the build)
- `NEXT_PUBLIC_ENABLE_DEV_LOGIN` — would enable the email/password **auth bypass**.
- `NEXT_PUBLIC_E2E` — would inject **chat + booking test stubs** (fake responses).
- `CURATION_USE_CACHE` — dev-only Apify cache replay.

### Configured in the Supabase dashboard (NOT Vercel)
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` — entered in Supabase Auth → Providers → Google.

### Wherever curation is run (laptop / job — not Vercel for launch)
- `APIFY_API_TOKEN`, `APIFY_TRIPADVISOR_SEARCH_ACTOR_ID`, `APIFY_TRIPADVISOR_REVIEWS_ACTOR_ID`,
  `APIFY_GOOGLE_REVIEWS_ACTOR_ID` (+ optional `APIFY_SEARCH_MAX_RESULTS`, `APIFY_REVIEWS_MAX_RESULTS`).
- Plus the same `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_PLACES_API_KEY` values.
- Optional `PIPELINE_POLL_MS`, Dash0 vars.

## Provisioning checklist — what the operator sets up

### GitHub
- Authorize the Vercel GitHub App on the (private) repo during import. Optional: mark CI jobs
  "required" on `main` if branch protection is desired (not required for launch).

### Supabase (production project)
1. Create a Supabase Cloud project (region near users — SG/HK given the destinations). Note the ref.
2. Capture: Project URL, `anon` key, `service_role` key (secret), DB password.
3. **Auth → Providers → Google:** enable, paste `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET`.
   In Google Cloud Console add the authorized redirect URI:
   `https://<project-ref>.supabase.co/auth/v1/callback`.
4. **Auth → URL Configuration:** Site URL `https://<prod-domain>`; allow-list redirect URL
   `https://<prod-domain>/auth/callback` (+ a `*.vercel.app` preview URL if previews should log in).
5. Apply migrations `0001`–`0011` (`supabase db push`). Verify the `hotel-images` Storage bucket
   (public-read, service-role write) and RLS policies on `users` / `family_profiles` / `shortlists`.
6. ⚠️ Curation prerequisites on the prod-backing accounts: **Places API (New)** enabled in GCP, and
   the **TripAdvisor-reviews Apify actor approved** (both were done for dev — confirm they cover the
   keys backing production).

### Vercel
1. Import the GitHub repo (Next.js auto-detected; build `next build`, no overrides).
2. Connect the production domain (or use `*.vercel.app` for a soft launch).
3. Set Production env vars per the host map above. Confirm the three "MUST be unset" flags are absent.
4. (Worker host deferred — launch decision is on-demand only.)

## Execution sequence

1. **Supabase:** `supabase db push` (manual for the launch bootstrap; future migrations via the
   `db-migrate.yml` Actions button — see "Migrations" below) → verify bucket + RLS.
2. **Curate prod data** via the live pipeline (cache-banked first; founder-gated; costs credits).
3. **Vercel preview deploy** → smoke test: Google login round-trip, a chat turn, a RouteStack rate
   lookup against the **prod** endpoint. Confirm `prebuild` guard passed in the build logs.
4. **Wire prod domain** → update Supabase Site/Redirect URLs to match.
5. **Production deploy.** Post-launch checks: dev-login route absent / 403, OAuth works, OTEL traces
   land in Dash0, a real booking deep-link generates.
6. **(Later)** schedule curation refresh (Vercel Cron or a dedicated worker host).

## Migrations: who applies them, and how
- **Vercel deploys the app, NOT the database.** The Vercel GitHub integration auto-builds + serves on
  push to `main`; it never runs `supabase db push`. The schema is a separate pipeline.
- **First push (launch bootstrap): manual.** `supabase db push` run by a human against the empty prod
  DB, watching the result (irreversible-DDL risk → eyes on the first one).
- **Future migrations: GitHub Actions, manual button.** `.github/workflows/db-migrate.yml`
  (`workflow_dispatch` only — no push/PR trigger). Default is a **dry run**; to apply, set the
  `confirm` input to the literal `APPLY` (typo-guard). Runs in the `production` GitHub Environment so a
  required-reviewer gate can be attached later. CLI pinned to 2.84.2 (matches `ci.yml` + local).
  **Required repo Actions secrets:** `SUPABASE_PROJECT_REF`, `SUPABASE_DB_PASSWORD`, and
  `SUPABASE_ACCESS_TOKEN` (a Supabase account/personal access token — `supabase link` needs it in CI;
  there is no interactive `supabase login` on a runner).

## Auth specifics (so redirect config is correct)
- Sign-in starts client-side with `redirectTo = ${window.location.origin}/auth/callback`
  (`lib/auth/signIn.ts`). The callback (`app/auth/callback/route.ts`) uses `request.nextUrl.origin`
  — **no hardcoded host**, so it works on any domain once Supabase's redirect allow-list includes it.
- Failures redirect to `/?error=auth` (warm, non-blocking — spec 14). Never a raw error page.

## Out of scope (stated, not silently dropped)
- An always-on production worker (deferred — on-demand for launch).
- Auto-seeding production reference data (the dev seed is demo-only; prod data is curated live).
- Multi-region / HA Supabase, CDN tuning, rate-limit hardening — post-launch concerns.
