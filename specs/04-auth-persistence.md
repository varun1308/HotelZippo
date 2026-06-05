# 04 · Auth & Persistence

- **Notion:** https://app.notion.com/p/3764958429ac813eadd8d3f4f9cae3cf
- **Phase:** 4 · **Status:** SPECCED

> Gates the consumer app behind **Google sign-in**, activates the existing owner-only RLS with real `auth.uid()` sessions, and persists `family_profiles` / `sessions` / `shortlists` to Supabase. Builds on Phase 3 (done); unblocks Phase 5 session memory (08b-3). No new schema columns — Phase 4 activates and verifies the FKs + RLS already built in PR #3.

## Decisions locked (planning 2026-06-05)

1. **Google OAuth only for v1.** The "Continue with email" fallback button in the 05 Home Page prototype is **dropped**. Resolves the CLAUDE.md hard rule "Google Sign-In only — no guest access."
2. **Minimal account surface.** Sign in, sign out, edit the family profile (via the existing Family Profile Form). **No** account page, data export, or self-serve deletion in v1.
3. **Build the landing route.** The home/landing route is not yet implemented as a real page. Phase 4 builds it from `Home Page.html` (05), Google-only, wired to real OAuth.
4. **Hard gate.** `/chat` sits fully behind sign-in; no guest/anonymous chat. Therefore **no anonymous in-progress state to migrate** — every user-owned write is keyed to the authenticated user from the first interaction.

## Scope

| In scope (v1) | Out of scope (deferred) |
| --- | --- |
| Google OAuth sign-in via Supabase Auth | Email/password, magic-link, any non-Google provider |
| Hard-gated `/chat` (no guest access) | Guest / anonymous access |
| Build landing route from the 05 prototype | Account page, data export, account deletion |
| Persist `family_profiles` / `sessions` / `shortlists` | Multi-session picker / history UI (Phase 5) |
| Activate + verify owner-only RLS with real sessions | Admin-tool authentication (admin stays no-auth internal) |
| Sign-out + minimal account menu + edit profile | |

## Schema & RLS — no new columns

The `user_id` foreign keys and owner-only RLS **already exist** (built in PR #3, per 07). Phase 4 **activates and verifies** them — it does not recreate them.

- **No new columns.** `users`, `family_profiles`, `trip_briefs`, `sessions`, `shortlists` already carry `user_id` per the canonical data model.
- **RLS already built** (owner-only + reference-read + service-role). Phase 4 makes `auth.uid()` real so the owner-only policies actually scope rows. **Re-run the isolation tests with two real signed-in users.**
- **`public.users` population:** ensure a row is created on first sign-in — **preferred via a DB trigger on `auth.users` insert** (sets `id`, `email`, `created_at`), or an upsert in the OAuth callback. **No such trigger exists in the migrations today** (only `updated_at` triggers); it must be added.
- **Unchanged:** `hotels` + `hotel_intelligence` stay authenticated-read reference; `raw_reviews`, `pipeline_runs`, `pipeline_run_hotels`, `curation_hotels` stay service-role only.

## Stage 1 — Landing / Home route

Build the landing route from `Home Page.html` (05):

- Split hero (editorial copy + sign-in CTA left; app-showcase carousel right), trust row, mobile reflow `copy → carousel → CTA` — per the prototype.
- **Google-only:** render only the authentic "Continue with Google" button (white, multi-colour G, `#dadce0` border). **Remove the "Continue with email" button.**
- "Continue with Google" triggers the OAuth flow (Stage 2).
- Verified responsive at 375–430px.

## Stage 2 — Google OAuth (Supabase Auth)

Use `@supabase/ssr` for cookie-based sessions in the App Router (server + client helpers).

1. Client calls `signInWithOAuth({ provider: 'google', options: { redirectTo: <origin>/auth/callback } })`.
2. Google consent screen.
3. `/auth/callback` route handler exchanges the code for a session (`exchangeCodeForSession`), sets the session cookies, then redirects to `/chat`.

**Secrets placement:** the Google client ID/secret and authorised redirect URLs are configured in the **Supabase dashboard (Auth providers)** + **Google Cloud Console** — *not* in app env. The app uses only the existing `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`. All auth exchange is server-side; never expose secrets client-side (hard rules #2, #5).

## Stage 3 — Route gating (middleware)

`middleware.ts` refreshes the session and enforces gating:

- Unauthenticated request to `/chat` (and any future user route) → redirect to `/` (landing).
- An authenticated user hitting `/` may be routed straight to `/chat` (optional).
- **Admin tools (`/admin/*`) remain no-auth internal for v1** — consistent with the curation tool (12a) and the pipeline admin UI (08a-5). The middleware does **not** gate them.

## Stage 4 — Persistence

All user-owned writes go to Supabase, keyed to the authenticated user — no client-only state path:

- **`family_profiles`** — upsert one per user (from onboarding / edit profile).
- **`trip_briefs`** — insert per search (already user-keyed).
- **`sessions`** — write/update session snapshot rows. The resume-on-return UX is **Phase 5** (08b-3); Phase 4 only ensures rows persist and are user-scoped.
- **`shortlists`** — persist saved hotels + `share_token`.

Reads are automatically scoped by the owner-only RLS.

## Stage 5 — Account surface (minimal)

- **Signed-in shell:** account menu in the app chrome — Google avatar + name/email, **Edit profile**, **Sign out**.
- **Edit profile:** reuse the built Family Profile Form (05 component #4b). Load existing `family_profiles` on open; upsert on save.
- **Sign out:** `supabase.auth.signOut()` → redirect to `/`.

## Auth UI states

- **Google button:** idle / loading (during redirect) / disabled.
- **OAuth callback:** brief loading interstitial; on error, redirect to `/` with a **non-blocking** error message (per 14 · Error Handling).
- **Session expiry mid-use:** prompt re-auth while preserving the current route; no broken/blank state.

## Environment & setup (→ 13)

| Item | Where | Owner |
| --- | --- | --- |
| Google Cloud OAuth app (client ID + secret) | Google Cloud Console | Founder |
| Authorised redirect URIs (`http://localhost:3000/auth/callback` • prod) | Google Cloud + Supabase | Founder |
| Enable Google provider | Supabase dashboard → Auth | Founder |
| New app `.env` vars | None required (uses existing Supabase URL + anon key) | — |

## Acceptance criteria (→ Phase 4 gate in 15)

- Unauthenticated `GET /chat` redirects to `/`.
- "Continue with Google" completes OAuth and lands on `/chat` with an active session.
- Session persists across page refresh and browser restart (cookie-based).
- `family_profiles` / `sessions` / `shortlists` are written to Supabase, keyed to the user.
- **RLS isolation:** user A cannot read or write user B's rows (verified with two real signed-in users).
- A `public.users` row exists after first sign-in.
- Edit profile loads existing values and saves changes.
- Sign-out clears the session and returns to `/`.
- Landing renders from the prototype, Google-only (no email button), responsive 375–430px.
- OAuth failure path returns to `/` with a non-blocking error and no broken state.

## Claude Code Action Items (from Notion)

1. Confirm/create `public.users` population on first sign-in (trigger on `auth.users`, or callback upsert).
2. `@supabase/ssr` server + client helpers; `middleware.ts` (session refresh + gate `/chat` → `/`).
3. `/app/auth/callback/route.ts` — exchange code for session; error handling per 14.
4. Build the landing route from `Home Page.html` (05): Google-only, drop the email button, wire "Continue with Google" to `signInWithOAuth`.
5. Signed-in shell: account menu (avatar / name / email · Edit profile · Sign out).
6. Edit-profile: reuse the Family Profile Form (05 #4b); load + upsert `family_profiles`.
7. Persistence wiring: route `family_profiles` / `sessions` / `shortlists` writes through Supabase, user-scoped; remove the client-only state fallback.
8. Re-run RLS isolation tests with two real signed-in users.
9. Tests per 15 (add the Phase 4 criteria above): gating, mocked OAuth callback, RLS isolation, persistence round-trip, sign-out.
10. Generate `/specs/04-auth-persistence.md` from this page (CLAUDE.md hard rule #7).

## Founder dependencies (before handoff)

- Create the Google Cloud OAuth app and provide the client ID + secret.
- Enable the Google provider and configure redirect URLs in the Supabase dashboard.

## Cross-references

05 · UI Component Specs · 07 · Data Model · 08b-3 · Session Snapshot (Phase 5) · 10a · Supabase · 11 · Build Sequence · 13 · Environment & Secrets · 14 · Error Handling · 15 · Test Strategy · 16 · Spec Index
