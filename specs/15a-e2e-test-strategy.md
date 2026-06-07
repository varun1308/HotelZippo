# 15a · E2E Test Strategy (Playwright)

- **Parent:** `specs/15-test-strategy.md` (this is the deferred-E2E section, now activated)
- **Phase:** post-v1 hardening · **Status:** specced (not yet built)
- **Owner:** `qa-gate` (owns acceptance criteria; refuses phase-complete until green)

> This contract turns the spec-15 "E2E deferred" placeholder into a buildable plan. It
> defines WHAT the E2E suite proves, the seams it relies on, and the per-journey
> acceptance criteria. The implementation plan lives alongside this in the PR description
> and the build slices below.

## 0. Goal & non-goals

**Goal.** Prove the *critical user journeys* end-to-end through a real Next.js server, a real
local Supabase (real cookies, real RLS, real persistence), and the real rendered UI — the
gaps that unit/jsdom + node-integration tests structurally cannot cover (routing, the
middleware auth gate, cookie sessions, client↔server↔DB round-trips, inline card rendering in
a live browser).

**Non-goals (explicitly out of scope for v1 E2E).**
- **Live LLM accuracy.** Agent *content* quality is validated by the synthesis/contract tests
  + manual 08a-3 runs, never by E2E. E2E asserts *structure and behaviour* only.
- **Live RouteStack booking.** Admin-blocked (see `[[routestack-sandbox-blocker]]`); the
  booking journey runs against a deterministic stub. A real booking is never executed.
- **Live Google OAuth.** Cannot be automated; E2E authenticates via the existing dev-login
  seam (below). The live OAuth path stays a manual founder check (spec 04).
- **Visual regression / pixel diffing.** Out of scope for v1; behaviour + presence/role
  assertions only.

## 1. Core principle: deterministic, key-free, CI-on-every-PR

The entire default suite MUST run with **no secrets** (`ANTHROPIC_API_KEY`, `APIFY_*`,
`ROUTESTACK_*`, Google OAuth all absent) and produce **identical results every run**. This
mirrors the project's existing key-free-CI discipline (injectable model in `agent.ts`,
injectable transport in booking, mock-first scrape). E2E adds one new idea — an **E2E stub
mode** — applied at the two non-deterministic server seams.

### 1.1 The E2E stub seam (the central design decision)

A single env flag, **`NEXT_PUBLIC_E2E=1`** (set only when Playwright launches the app),
switches two server routes from their live providers to deterministic stubs:

| Route | Live (normal) | E2E stub (flag on) |
|---|---|---|
| `POST /api/chat` | `runConversation` → Anthropic | a scripted NDJSON stream that replays a fixed concierge turn + an inline `recommendation-set` (reuse the existing `mockStream` script as the data source). No API key touched. |
| `POST /api/booking/rates` + `/api/booking/payment-url` | `searchAndRates` / `selectAndPaymentUrl` → RouteStack | a fixed rooms/rates payload + a fake `bookingUrl` (e.g. `https://example.test/checkout/...`). No RouteStack call. |

Rules for the stub seam (hard requirements):
- **Server-side gate only.** The flag is read inside the route handler; the branch lives at
  the *top* of `POST`, before any provider import is exercised. The stub modules are
  imported lazily so the live bundle is unaffected.
- **The stub is real protocol.** It emits the exact same `StreamChunk` NDJSON / `RatesResponse`
  / `BookingHandoff` shapes the live path emits — so the *client* code under test is 100% the
  production code; only the upstream provider is swapped.
- **Auth still real.** The stub does NOT bypass the cookie/RLS auth check — an unauth call to
  the stubbed booking route still 401s. We stub the *provider*, not the *gate*.
- **Off by default, impossible in prod.** Absent the flag, behaviour is byte-for-byte today's.
  The flag is `NEXT_PUBLIC_`-prefixed for symmetry with `NEXT_PUBLIC_ENABLE_DEV_LOGIN` and is
  never set in any real deployment.

### 1.2 Auth seam: dev-login

E2E authenticates through the **existing** dev-login path (no new auth code):
`NEXT_PUBLIC_ENABLE_DEV_LOGIN=true` + a seeded dev user (`npm run dev:user`) +
`devSignIn(email, password)`. This produces a *real* Supabase cookie session, so the
middleware gate, RLS, and persistence are all exercised for real. Google OAuth is untouched.

### 1.3 Data seam: seeded local Supabase

E2E runs against a **real local Supabase** seeded deterministically via `npm run dev:db`
(10 hotels + intelligence, 1:1, from the canonical fixtures) — the same stack the
`integration` CI job already boots. Assertions key off this fixed dataset (e.g. the seeded
top-pick name). The dev user is seeded fresh per run; the DB is reset (`supabase db reset`)
so each run starts from a known state.

## 2. Test environment matrix

| Concern | Value in E2E |
|---|---|
| App | `next build` + `next start` (production server), launched by Playwright `webServer` |
| Env | `.env.e2e` (committed; NO secrets) — local Supabase URL/anon/service keys, `NEXT_PUBLIC_E2E=1`, `NEXT_PUBLIC_ENABLE_DEV_LOGIN=true` |
| DB | local Supabase (`supabase start`), reset + seeded (`npm run dev:db`) before the run |
| Auth | dev-login (seeded `dev@hotelzippo.local`) |
| Agent | stubbed (`/api/chat` E2E branch) |
| Booking | stubbed (`/api/booking/*` E2E branch) |
| Browsers | Chromium (required). WebKit/Firefox optional follow-up; mobile viewport (390×844) for the responsive-landing assert. |

## 3. Required test hooks (the app change E2E needs)

Today only ONE `data-testid` exists (`stream-caret`). E2E needs **stable, role-or-testid
selectors** on the surfaces it asserts. Add `data-testid` **only where a role/text selector
is ambiguous or brittle**; prefer accessible roles/names first. The minimum set:

| Surface | Hook |
|---|---|
| Composer input + send | role `textbox` + `data-testid="composer-send"` |
| A streamed assistant message | `data-testid="assistant-message"` |
| Trip Brief rail + "Find hotels" | `data-testid="trip-brief"`, `data-testid="find-hotels"` |
| Recommendation set / top pick / alt cards | `data-testid="recommendation-set"`, `"top-pick-card"`, `"alt-card"` |
| Hard-flag element | `data-testid="hard-flag"` (already class-scoped; add id for assertion) |
| Save-to-shortlist toggle + shortlist panel | `data-testid="save-hotel"`, `"shortlist-panel"`, `"shortlist-item"` |
| Account menu + sign-out + edit-profile | `data-testid="account-menu"`, `"sign-out"`, `"edit-profile"` |
| Family profile form + submit | `data-testid="profile-form"`, `"profile-submit"` |
| Proceed-to-book + room-picker modal + a room option + confirm | `data-testid="proceed-to-book"`, `"room-picker"`, `"room-option"`, `"booking-confirm"` |

These are additive, render-only attributes — no behaviour change, no risk to existing tests.

## 4. Journeys & acceptance criteria

Four specs, four Playwright spec files. Each maps to spec-15 phase criteria.

### J1 — Auth gate + landing (`e2e/auth-gate.spec.ts`)
Maps spec-15 Phase 4.
- **AC1.1** Unauthenticated `GET /chat` → redirected to `/` (middleware gate).
- **AC1.2** Landing renders the `HotelZippo` wordmark + a Google sign-in affordance; **no
  email/password field** in the production-style UI (dev-login affordance is separate + flag-gated).
- **AC1.3** Landing is responsive at 390×844 (no horizontal scroll; hero + CTA visible).
- **AC1.4** Dev-login → lands on `/chat` with the composer visible (a real cookie session).
- **AC1.5** Sign-out from the account menu → returns to `/`; `/chat` is gated again afterwards.

### J2 — Onboarding → recommendations (`e2e/recommendations.spec.ts`)
Maps spec-15 Phase 3 (the headline journey).
- **AC2.1** Signed-in new user can send a message and see a streamed assistant reply
  (`assistant-message` appears, non-empty).
- **AC2.2** Filling the trip brief to its two hard gates (destination + trip type) enables
  **Find hotels**; clicking it injects a chat turn (no assemble-route bypass).
- **AC2.3** A `recommendation-set` renders **inline in the conversation** with exactly one
  `top-pick-card` visually distinguished from the `alt-card`s (top-pick has the distinct
  treatment; count matches the stub's 2–3 set).
- **AC2.4** A hard flag present in the stubbed set renders **prominently** on its card
  (`hard-flag` visible above the fold of the card, amber/red per the hard-flag rules).
- **AC2.5** The trip-brief gates **lock** once recommendations arrive (no further editing of
  the locked fields).

### J3 — Shortlist + profile persistence (`e2e/persistence.spec.ts`)
Maps spec-15 Phase 4 persistence (real Supabase, real RLS).
- **AC3.1** Save a recommended hotel → it appears in the shortlist panel; **reload the page**
  → the shortlist still contains it (persisted to `shortlists`, RLS-scoped, reloaded on mount).
- **AC3.2** Open Edit profile, change a field (e.g. add a child / set hometown), submit →
  **reload** → the new values are prefilled (persisted to `family_profiles`).
- **AC3.3** (Isolation, lightweight) A second seeded dev user does **not** see user one's
  shortlist/profile. *(Optional if the harness supports two storage states; otherwise covered
  by the existing node RLS integration test and noted as such — no silent gap.)*

### J4 — Booking room-picker, stubbed (`e2e/booking.spec.ts`)
Maps spec-15 Phase 7 (UI flow only; RouteStack stubbed).
- **AC4.1** From a recommendation, **Proceed to book** opens the room-picker modal whose
  **first screen** confirms travellers + room count + dates (the combined confirm turn).
- **AC4.2** Confirming advances to the rooms/rates list; each `room-option` shows the present
  fields (room type / price+currency / cancellation / board / bed / occupancy) and omits
  absent ones gracefully (assert against the fixed stub payload).
- **AC4.3** Selecting a room → the deep-link `bookingUrl` is produced and the proceed action
  targets a new tab (assert the `href`/`target=_blank` or the stubbed URL, **without** actually
  navigating off-site). The URL only appears **after** an explicit room choice.
- **AC4.4** A stub-injected business failure (e.g. `no-availability` / `offer-expired`)
  surfaces as a **warm conversational fallback**, never a raw error / dead-end (spec 14).

## 5. CI integration

The `e2e` job in `.github/workflows/ci.yml` **already auto-activates** when a `test:e2e`
script exists (it currently no-ops with an explicit "E2E deferred" notice). The build:
1. Adds `test:e2e` (and `test:e2e:ui` for local debugging) to `package.json`.
2. Extends the `e2e` job to: boot Supabase → `npm run dev:db` (seed) → `npm run dev:user`
   (seed dev user) → `npm run build` → `npx playwright test` (Playwright's `webServer` starts
   `next start` with `.env.e2e`). Mirrors the `integration` job's Supabase setup.
3. Keeps the job **required** on PRs to main once it's real (so a red E2E blocks merge).
4. Live-tagged journeys (if ever added) stay a separate manual/nightly job — NOT on PRs.

## 6. Flake & hygiene rules
- **No arbitrary `waitForTimeout`.** Wait on web-first assertions / `expect(locator)` / network
  idle. The stubbed streams are instant (`delayMs: 0`) so there's nothing to "wait out".
- **Reset between runs.** `supabase db reset` + re-seed; one dev user per spec where state could
  bleed; prefer per-test storage state over shared mutable rows.
- **Trace on failure.** Playwright `trace: 'on-first-retry'`, `retries: 1` in CI, `0` locally.
- **No silent caps.** If a journey is partially covered (e.g. AC3.3 deferred to node RLS), the
  spec file `test.fixme`/`test.skip` with a reason — never a quietly-missing assertion.
- **Selectors are contracts.** Changing a `data-testid` that E2E relies on is a breaking change;
  keep the table in §3 the single source of truth.

## 7. Action items (for `qa-gate` / the build)
- [x] Add Playwright (`@playwright/test`) + `playwright.config.ts` (Chromium, `webServer`, trace). *(Slice 1)*
- [x] Add `.env.e2e` (no secrets) + the `NEXT_PUBLIC_E2E` stub branches in `/api/chat` *(Slice 1)*
      + `/api/booking/*` *(Slice 4)*, with the stub data modules (`lib/chat/e2e-stub.ts`
      reuses `phuketScript` + rebinds real seeded hotel ids; `lib/booking/e2e-stub.ts`).
- [x] Add the §3 test hooks to components (additive `data-testid`s): `recommendation-set`,
      `top-pick-card`, `alt-card`, `assistant-message`, `room-option`. (Most surfaces use
      accessible roles/labels — testids added only where a role was ambiguous.)
- [x] Author the four spec files (§4): `e2e/{auth-gate,recommendations,persistence,booking}.spec.ts`.
- [x] Wire `test:e2e` + extend the CI `e2e` job (§5).
- [x] Update `specs/15-test-strategy.md`: E2E is no longer "deferred" — links here.
- [x] `qa-gate` gate: all four journeys green in CI (17 passed + 1 honest `test.fixme`).

### Known gap surfaced by E2E (tracked, not yet fixed)
- **Shortlist does not survive a page reload.** The chat page persists `hotel_ids[]` to
  `shortlists` but never re-hydrates on mount, and stores only ids (not the card data the
  panel renders). `loadShortlistHotelIds` exists but is uncalled. AC3.1b is a `test.fixme`
  documenting this. A separate fix PR (re-hydrate on mount + re-fetch hotels by id) would
  flip that fixme to a passing test.
