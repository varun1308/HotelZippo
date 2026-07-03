# 10a · Supabase

- **Notion:** https://app.notion.com/p/3754958429ac8115aed6fec93b39ff39
- **Phase:** 1 · **Status:** built ✅ (concrete tables/policies live in **07-data-model.md** — that page is the canonical contract; this page stays a thin platform brief)

## Summary

- Managed PostgreSQL, **Mumbai region** (Indian-user latency).
- Supabase Auth + Google OAuth only (v1); no email/password, no guest access (Phase 4).
- Env: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (client); `SUPABASE_SERVICE_ROLE_KEY` (server-only).
- All AI inference and admin/service-role DB writes happen server-side (Next.js Route Handlers on Vercel).

## RLS intent

See `docs/data-model.md` → RLS plan. Owner-only for user-scoped tables; read-only authenticated for `hotels`/`hotel_intelligence`; service-role only for `raw_reviews`/`pipeline_*`/`curation_hotels`.

## Client patterns

- **Browser client** — anon key, RLS-enforced, for authenticated user reads/writes of their own data.
- **Server/service client** — service-role key, server-side only (`/lib/db/server.ts`), for admin/curation/seed/pipeline operations. Never imported into client components.

## Action items (from Notion)

- Implement RLS policies matching the intent; never expose the service-role key to the client.
- Provide typed client factories (`browserClient`, `serviceClient`) with the service client guarded against client bundling.

## Acceptance criteria (as built)

- **AC1** — cross-user RLS isolation holds for every user-scoped table (`tests/integration/rls.test.ts`, `update-profile-rls.test.ts`).
- **AC2** — `SUPABASE_SERVICE_ROLE_KEY` never reaches a client bundle (`server-only` guard on `lib/db/server.ts`; `tests/unit/persistence-not-client.test.ts`).
- **AC3** — migrations apply cleanly to a pristine DB (`supabase db reset` green — exercised on every CI integration run).
- **AC4** — the SSR/browser/server client trio (`lib/db/ssr.ts` / `client.ts` / `server.ts`) is the only place Supabase clients are constructed.
