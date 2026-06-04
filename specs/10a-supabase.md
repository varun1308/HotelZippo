# 10a · Supabase

- **Notion:** https://app.notion.com/p/3754958429ac8115aed6fec93b39ff39
- **Phase:** 1 · **Status:** starter (expand with concrete policies during Phase 1)

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
