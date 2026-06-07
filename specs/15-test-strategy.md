# 15 · Test Strategy

- **Notion:** https://app.notion.com/p/3744958429ac8148b2f6e4617ef2c55f
- **Phase:** all · **Status:** specced

## Principles
Tests written **alongside** code (never after). Every spec produces a test file. All tests pass before a phase is complete. Tests focus on **behaviour, not implementation**. AI output is validated for **structure/format/contract**, not content.

## Test types
- **Unit** — Jest; pure functions + prompt output parsers.
- **Integration** — Jest + a dedicated Supabase **test** project (never production).
- **E2E** — Playwright on critical user journeys. **ACTIVE** — see `specs/15a-e2e-test-strategy.md` for the full contract (seams, journeys J1–J4, acceptance criteria). The suite is deterministic + key-free (the agent + booking providers are stubbed via `NEXT_PUBLIC_E2E`; auth is real via dev-login; data is a seeded local Supabase). The CI `e2e` job auto-activates on the `test:e2e` script. *(Was deferred post-v1; reactivated 2026-06-08.)*
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
- **Test type (current gate):** jsdom component/unit tests cover card rendering, hard-flag prominence, and top-pick distinction; the conversational flow is exercised via the chat-runtime unit/contract tests + a manual happy-path smoke against the dev server.
- **Test type (E2E, active):** Playwright journey **J2** in `specs/15a-e2e-test-strategy.md` (onboarding → recommendations → inline card rendering → top-pick distinction → hard-flag prominence), run against the real server with a stubbed agent. *(All four journeys J1–J4 are live; see 15a.)*

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

### Phase 6 — Review Intelligence Pipeline
(Source: `specs/02-review-intelligence-pipeline.md`; full case list = 08a-6 TC-P1..P22 + the 7 synthesis cases in 08a-3.)
- Pipeline runs end-to-end for test hotels without error (scrape → tag → store → synthesise → upsert).
- Raw reviews written to `raw_reviews` with `pipeline_run_id`; idempotent dedup-append (re-run inserts no duplicates, deletes nothing); permanent retention.
- Family + Indian tagging correct on a labelled set (canonical 08a-2 keyword list).
- Segment caps enforced (≤150 family / ≤100 Indian / ≤250 general, ≤500 total, most-recent-first, no redistribution); input lines `[YYYY-MM-DD] [rating/5] {text}` with HTML/management-response strip + <20-char drop + 12-month filter.
- Synthesised intelligence matches the `hotel_intelligence` schema; malformed JSON → hotel failed, no partial write, logged via OTEL.
- Confidence gate: `high`→publish, `medium`→publish + review queue, `low`→`low_confidence=true` + Dash0 alert.
- Hard flags detected correctly (incl. the Holiday Inn Karon case, 08a-3 TC-2).
- Admin UI / API enforces a single active run (DB-level `one_active_run`) and supports per-hotel retry; live status feed; run history.
- `low_confidence` / `review_count_total = 0` hotels excluded by the consumption contract; the Conversation Agent never reads `raw_reviews`.
- **Test type:** unit/jsdom (prompt contract, tagging, format, synthesis call+gate, admin UI), node integration (raw_reviews storage, worker e2e, single-active-run, retry, admin status/history). Live Apify scrape is verified manually once founder actor creds land (mock-fixtures-first in CI).

### Phase 7 — Booking (RouteStack)
(Source: `specs/10c-booking-routestack.md`; built against the real API in `specs/openapi.yaml`.)
- **Token lifecycle:** the wrapper mints a JWT via `/mcp/auth/partner-token` (HMAC-SHA256 of `apiKey:timestamp:nonce`, base64url) and caches/reuses it within the 24h TTL (no re-mint per call).
- **Session flow:** destination resolves via `search-destinations` → `search-hotels` matches the chosen hotel by `name` → `correlationId` + `token` are threaded through every later call → `get-hotel-details-and-rates` returns rooms/rates incl. `recommendationId` + `roomId`.
- **Combined confirm turn:** before any RouteStack call, the flow confirms travellers + room count + exact dates in one step (the modal's first screen); the **confirmed** party (incl. grandparents, captured here — not auto-counted) drives `rooms[]`/`childAges`; month-only dates are collected here, never guessed; currency defaults to USD (changeable currency = future scope).
- **Room picker:** rooms/rates render in a modal with room type / price+currency / cancellation / board / bed / occupancy (each omitted gracefully when absent); the user's selection drives `revalidate` → `get-payment-url` for that `recommendationId`/`roomId`; the deep-link `booking_url` opens (new tab) **only after** an explicit room choice.
- **Graceful errors:** the wrapper branches on the `{success}` envelope (not HTTP status); 204 / 5148 / session-expiry map to warm conversational fallbacks per 14 (Try again → confirm / another shortlisted hotel); no broken state, never a dead-end.
- **Secret hygiene:** `ROUTESTACK_API_KEY` **and** `ROUTESTACK_API_SECRET` stay server-side (the wrapper runs only in `/api/booking/*` + the capture script); never reach the client (hard rules #2, #5).
- **Observability:** every RouteStack call is OTEL-traced → Dash0 (`hotel_id`, dates, success/failure, latency); the trace id is surfaced on `BookingError`.
- **Adaptive mapper:** the rooms/rates mapper is reconciled against a captured sandbox fixture (`specs/fixtures/routestack/rooms-rates.json`); the fixture-driven test keeps it honest after the real capture overwrites the placeholder.
- **Test type:** unit/jsdom (auth HMAC + JWT cache, party inference + rooms builder, adaptive mapper, orchestrator success-envelope branching, flow state machine, room-picker modal, context wiring, fixture mapper) — all against mock fixtures, **key-free**. node integration (**sandbox smoke**, env-gated: skips without `ROUTESTACK_*` and skips gracefully if the account isn't provisioned; **never completes a live booking** — stops before `get-payment-url`). Live capture + the live booking path are verified manually once the founder provisions the sandbox account (member-token / anonymous config — see `specs/10c-booking-routestack.md` founder dependencies).

## Later phases (reference)
Phase 8 (launch checklist — Notion 18; founder-run, not build work in this campaign). See Notion 15.

## Action items
- Stand up Jest + Zod with a dedicated Supabase test project. **Done.**
- Stand up Playwright E2E (`specs/15a`). **Done** — all four journeys live (J1 auth/landing,
  J2 onboarding→recommendations, J3 shortlist+profile persistence, J4 booking room-picker).
  17 tests green + 1 documented `test.fixme` (shortlist-reload gap — see 15a §7).
- `qa-gate` owns these criteria and refuses to mark a phase complete until they pass.
- Materialise `/tests/fixtures/` standard profile + brief.
