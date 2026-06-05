# 15 · Test Strategy

- **Notion:** https://app.notion.com/p/3744958429ac8148b2f6e4617ef2c55f
- **Phase:** all · **Status:** specced

## Principles
Tests written **alongside** code (never after). Every spec produces a test file. All tests pass before a phase is complete. Tests focus on **behaviour, not implementation**. AI output is validated for **structure/format/contract**, not content.

## Test types
- **Unit** — Jest; pure functions + prompt output parsers.
- **Integration** — Jest + a dedicated Supabase **test** project (never production).
- **E2E** — Playwright on critical user journeys.
- **Contract** — Zod schema validation.

## Test data
- Dedicated Supabase test project.
- Standard test family profile + trip brief in `/tests/fixtures/`.
- Labelled review samples in `/tests/fixtures/reviews/` (Phase 6).

## Acceptance criteria (the per-phase gates)

### Phase 0 — Scaffold
*(Not enumerated as a checklist in 15; gate from 11/13/14/05:)* app builds + runs; `.env.example` complete; `.env.local` git-ignored; OTEL initialised in `instrumentation.ts` with `service.name=hotelzippo`; design tokens wired (Tailwind + tokens.css render correctly). Test type: smoke + a lint/typecheck gate.

### Phase 1 — Data
- All 10 core tables created with correct schema (+ `curation_hotels` staging).
- RLS verified — **user A cannot read user B's data**.
- Seed script runs without errors.
- 250 hotels present in `hotels`.
- 10 demo `hotel_intelligence` records present and schema-valid.
- **Test type:** Contract (Zod for all 10 tables) + integration (RLS).

### Phase 2 — Recommendation engine
- Given a valid trip brief + family profile + seeded intelligence, the API returns 2–3 recommendations.
- Hard flags present in intelligence **always** appear in output.
- Output matches the card rendering schema **exactly**.
- Empty `hotel_intelligence` returns the correct error, not a partial result.
- Response time under 5s for local development.
- **Test type:** Unit (filtering logic) + Integration (Supabase queries) + Contract (output schema = card schema).

### Phase 3 — Conversational UI
- New user can complete onboarding in a single session.
- Trip brief collected and saved correctly.
- Recommendations render as inline cards within the conversation.
- Hard-flag alerts render prominently on relevant cards.
- Top pick clearly distinguished from other recommendations.
- **Test type:** E2E (Playwright: onboarding → recommendations → card rendering).

### Phase 4 — Auth & Persistence
(Source: `specs/04-auth-persistence.md` acceptance criteria.)
- Unauthenticated `GET /chat` redirects to `/`.
- "Continue with Google" completes OAuth and lands on `/chat` with an active session. *(Live path verified once founder Google creds are configured; mocked in CI.)*
- Session persists across page refresh and browser restart (cookie-based).
- `family_profiles` / `sessions` / `shortlists` are written to Supabase, keyed to the user.
- **RLS isolation:** user A cannot read or write user B's rows (two real signed-in users).
- A `public.users` row exists after first sign-in (the `on_auth_user_created` trigger).
- Edit profile loads existing values and saves changes.
- Sign-out clears the session and returns to `/`.
- Landing renders from the prototype, Google-only (no email button), responsive 375–430px.
- OAuth failure path returns to `/` with a non-blocking error and no broken state.
- **Test type:** unit/jsdom (landing, account menu), node integration (gating + callback, `public.users` trigger, RLS isolation, persistence round-trip). Live Google sign-in is verified manually once creds land.

## Later phases (reference)
Phase 5 (session snapshot save/restore + token budget), Phase 6 (pipeline idempotency, tagging, hard-flag detection, single-active-run, low_confidence exclusion), Phase 7 (RouteStack), Phase 8 (shortlist save/share + all 14 error scenarios). See Notion 15.

## Action items
- Stand up Jest + Playwright + Zod with a dedicated Supabase test project.
- `qa-gate` owns these criteria and refuses to mark a phase complete until they pass.
- Materialise `/tests/fixtures/` standard profile + brief.
