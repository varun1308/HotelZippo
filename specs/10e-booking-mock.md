# 10e · Mock RouteStack Booking (production-showable demo path)

- **Notion:** extends 10c (RouteStack integration) · 10d (order-lifecycle webhooks) · 08c (Booking Agent). **Phase:** 7 follow-up. **Status:** SPEC (proposed; build PENDING founder confirm).
- **Cross-refs:** 10c · RouteStack (the live flow this mocks) · 10d · Webhooks (the lifecycle this self-emits) · 07 · Data Model (`booking_orders`, `hotels`) · 13 · Environment · 14 · Error Handling/OTEL · 15 · Test Strategy · 18 · Deployment Runbook. Skills: `otel-wrap`.

> **Why this exists.** The RouteStack **sandbox is chronically unstable** (empty inventory → 429 rate-limit → prolonged 503 outages — all RouteStack-side; see the live-flake findings) and a real **live** booking can't be reliably driven end-to-end on demand. HotelZippo's **MOAT is the curated hotel-selection intelligence**, not the booking transport. So for launch/demo we want a **production-deployable mock of RouteStack** that lets a visitor experience the **complete booking journey** — proceed-to-book → room picker → deep-link checkout → "Booked ✅" — without depending on the RouteStack sandbox. The intelligence stays 100% real; only the **upstream booking HTTP** is faked.

## Design principle — mock the TRANSPORT, not the routes

The booking code already has an **injectable HTTP seam**: every RouteStack call goes through a `RouteStackFetch` (`lib/booking/auth.ts`), and the orchestrator (`lib/booking/routestack.ts`) takes it as `deps.fetchImpl`. The live transport is `createRouteStackFetch()` (`lib/booking/transport.ts`); tests inject a mock.

This spec adds a **third transport**: `createMockRouteStackFetch()` — a deterministic in-process function that returns **real RouteStack envelope JSON** (`{ success, code, message, result }`) for each `/mcp/...` path. Because it plugs into the same seam, **the entire production booking stack runs unchanged**:

```
createRouteStackFetch()         ← live (sandbox/prod)
createMockRouteStackFetch()     ← NEW: returns canned RouteStack-shaped JSON
        │  (selected at request time by the booking routes)
        ▼
searchAndRates / selectAndPaymentUrl   ← REAL orchestrator (unchanged)
   ├─ partner-token / search-destinations / search-hotels / details+rates  ← REAL logic, mock JSON
   ├─ mapRoomRateOptions()                                                  ← REAL mapper
   ├─ revalidate / get-payment-url                                          ← REAL logic, mock JSON
   ├─ booking_orders pending row (recordPendingOrder)                       ← REAL write (10d)
   └─ OTEL spans                                                            ← REAL
```

This is **strictly higher fidelity** than a route-level short-circuit (which the existing `lib/booking/e2e-stub.ts` already does for Playwright). The E2E stub is **build-blocked from production** by `scripts/build/preflight.mjs` (it rides `NEXT_PUBLIC_E2E`, a browser-baked flag) and skips the orchestrator + mapper + webhook lifecycle. The mock transport here is **production-safe** and exercises the real code paths.

> **The E2E stub is NOT reused.** It stays exactly as-is (Playwright-only, `NEXT_PUBLIC_E2E=1`, build-guarded). This mock is a separate, prod-deployable seam with its own server-only flag. The two never overlap: E2E short-circuits the routes for deterministic browser tests; the mock swaps the transport for a deployable demo.

## Gating — server-only flag, prod-safe by construction

- **`ROUTESTACK_MOCK=1`** — server-side **only** (NOT `NEXT_PUBLIC_`). Read **at request time** in the booking routes, never at import. When set, the routes inject `createMockRouteStackFetch()` instead of `createRouteStackFetch()`.
- Because it's not a `NEXT_PUBLIC_` flag it is **never baked into the browser bundle**, so `preflight.mjs` does **not** need to block it and the production build is unaffected. (Optional hardening: `preflight` MAY emit a `console.log` notice when `ROUTESTACK_MOCK=1` so a mock build is loud, not silent — it does **not** fail the build.)
- **Flip to fully live = unset `ROUTESTACK_MOCK` on Vercel + redeploy.** No code change. The same client bundle serves both modes.
- **Default OFF.** Unset → byte-for-byte today's live behaviour. CI never sets it.
- This is **not** an auth bypass and **not** a fake-data leak into the intelligence layer — it only changes which hotel **rates/availability** transport answers. The hotels, cards, hard flags, and recommendations remain the real curated data.

## What the mock returns (per RouteStack path)

The mock implements exactly the paths the orchestrator calls, each in the **real envelope shape** (`{ success, message, code, result }`; some steps put fields at the top level — e.g. `get-payment-url` returns `url` top-level — matching 10c). Determinism comes from hashing the request (hotel name + dates), so the same input always yields the same rooms/prices.

| Path | Mock behaviour |
| --- | --- |
| `POST /mcp/auth/partner-token` | `{ token: "<mock-jwt>", success: true }` — a syntactically-valid opaque token (never sent anywhere real). The orchestrator caches it normally. |
| `POST /mcp/hotel/search-destinations` | One candidate `{ id, fullName, country, type:'DESTINATION', coordinates:{lat,long} }` per supported destination (Phuket/Singapore/Tokyo/Orlando/Bali, from `lib/db/schemas.ts DESTINATIONS`), with **real** lat/long so `pickDestination` resolves correctly. Geocode disambiguation is a no-op (single candidate). |
| `POST /mcp/hotel/search-hotels` | A list that **includes the requested `hotelName`** (so `matchHotelByName` always resolves) plus the session handles **`correlationId` + `token`** the later steps thread. The requested hotel's `id`/`name`/`starRating`/`ourprice` are echoed from the request so the match is exact. |
| `POST /mcp/hotel/get-hotel-details-and-rates` | A `result.availability.groups[].rooms[]` payload in the **confirmed live shape** (10c §6) so the **real `mapRoomRateOptions`** produces several options. Includes a fully-described room AND a sparse one (proves graceful field omission). Carries `recommendationId` + `id` (roomId) + `rateid` per offer. Derived deterministically from the captured fixture **`specs/fixtures/routestack/rooms-rates.json`** (re-priced per hotel via the request hash) — so the mapper is exercised against real-shaped data. |
| `POST /mcp/hotel/revalidate` | `{ success: true, result: { rate: [{ providerName: 'MockSupplier', … }] } }` — the chosen rate always validates. (A `__EXPIRED__` magic token in `hotelName` → `{ success:false, code:5148 }` so the warm offer-expired fallback can be demoed.) |
| `POST /mcp/hotel/get-payment-url` | `{ success: true, url: "<APP_ORIGIN>/booking-demo?session=<id>&hotel=<name>&checkIn=…&checkOut=…" }` — the deep link points at the **in-app mock checkout page** (below), NOT an external RouteStack URL. |

**Magic tokens (demo controls, optional):** a `hotelName` containing `__NOAVAIL__` → `search-hotels`/details returns `code 204` (warm no-availability path, mirroring the E2E stub convention); `__EXPIRED__` → `revalidate` returns `5148`. These let the founder demo the graceful conversational fallbacks (spec 14) without touching real RouteStack.

## Mock checkout page + self-emitted webhook (the confirmation lifecycle)

The live deep link hands off to RouteStack's hosted checkout, and a **webhook** (10d) later flips our `booking_orders` row to CONFIRMED. The mock reproduces **that whole lifecycle in-app**:

1. **Deep-link target = `/booking-demo`** (new page, `app/booking-demo/page.tsx`). Reads `session`/`hotel`/`checkIn`/`checkOut` from the query. Renders a **conversationally-styled mock checkout** (locked 05 design tokens; reuses the booking modal's visual language) summarising the hotel + dates + selected room/price, with a clear **"This is a demonstration checkout"** banner so it's never mistaken for a real payment. No card fields, no PCI.
2. A **"Confirm booking"** button POSTs to a small **mock-confirm endpoint** (`POST /api/booking/mock-confirm`, gated on `ROUTESTACK_MOCK=1`) which **self-emits a real RouteStack webhook event** to our own `POST /api/webhooks/routestack` — a `BOOKING_SUCCESS` payload (10d shape) carrying the `billing_email` of the signed-in user and the order's `correlationId`-derived `orderid`. The webhook route is **unchanged**: it verifies the secret, redacts + persists `webhook_events`, and **correlates → flips the pending `booking_orders` row PENDING → CONFIRMED/COMPLETED** by `billing_email`, exactly as a live RouteStack delivery would.
   - The self-emitted event is signed with `ROUTESTACK_WEBHOOK_SECRET` so the webhook's existing shared-secret verification passes (when set). When unset (dev), the webhook already skips verification + warns.
   - This means **the tracked-order lifecycle is genuinely exercised** in the demo: pending-order write at payment-url handoff (10d), then webhook correlation, then status flip — no shortcut.
3. The page then shows **"Booking confirmed ✅"** and offers a link back to the chat. (A later `/bookings` surfacing — out of scope here — would read the now-CONFIRMED `booking_orders` row.)

**Why self-emit rather than fake the DB write directly?** So the demo proves the **real correlation + webhook code path** (the part 10d added), not just a cosmetic status. The only faked thing remains the **upstream booking transport**; the lifecycle plumbing is the production code.

## Scope

| In scope (v1) | Out of scope (deferred / explicitly NOT) |
| --- | --- |
| `createMockRouteStackFetch()` mock transport (real envelope JSON per path) in `lib/booking/mock-transport.ts` | Any change to the live transport, orchestrator, mapper, or webhook **logic** (they run unchanged) |
| Server-only `ROUTESTACK_MOCK=1` gating in both booking routes (request-time, lazy import) | Reusing / weakening the `NEXT_PUBLIC_E2E` E2E stub or the `preflight.mjs` guard |
| `/booking-demo` mock checkout page (locked tokens, clear demo banner, no card fields) | Real payment / PCI / card capture (never — same as 10c) |
| `POST /api/booking/mock-confirm` → self-emit `BOOKING_SUCCESS` to the real webhook route | Faking hotels / intelligence / recommendations (the MOAT stays 100% real) |
| Deterministic per-hotel pricing derived from the captured `rooms-rates.json` fixture | A dedicated `/bookings` page (separate follow-up; 10d's `booking_orders` is the foundation) |
| Magic-token demo controls (`__NOAVAIL__`, `__EXPIRED__`) for the warm-fallback paths | Mocking the OTHER RouteStack endpoints (cars/flights/list-bookings/cancel — not in v1 booking flow) |
| OTEL spans on every mock call (same `tracedCall` path) | Switching the **intelligence** pipeline to any mock (curation stays live) |

## Build invariants (carry from 10c/10d)

- **Lazy env reads** — `ROUTESTACK_MOCK` and `APP_ORIGIN` read at call time, never at import (key-free CI; the mock module has no top-level env access).
- **Injectable seam preserved** — the mock IS a `RouteStackFetch`; routes choose `createMockRouteStackFetch()` vs `createRouteStackFetch()` after the auth gate, mirroring the existing E2E-stub branch placement (`if (e2eEnabled())` → add `if (routeStackMockEnabled())` first / alongside, both lazy-imported so the live bundle is untouched).
- **No `'use client'`** on the mock transport / confirm helpers (server-side; reached only by routes — guards against the RSC-import gotcha).
- **OTEL on every call** — the mock goes through the same `tracedCall`, so spans (`hotel_id`, dates, success/failure, latency) appear in Dash0 indistinguishably from live (attribute a `mock: true` span tag so traces are honestly labelled).
- **Warm errors, never dead-ends** (spec 14) — `__NOAVAIL__`/`__EXPIRED__` map to the same `BookingError` kinds the live flow produces; the chat speaks the same fallback copy.
- **Auth gate intact** — the mock runs **after** the route's real Supabase auth check, exactly like the E2E stub; an anonymous caller is still 401'd.

## Environment (13)

| Var | Where | Meaning |
| --- | --- | --- |
| `ROUTESTACK_MOCK` | server-only (Vercel + `.env.local`) | `=1` → booking routes use the mock transport + enable `/api/booking/mock-confirm`. Unset/`0` → live. **Never `NEXT_PUBLIC_`.** Add to `.env.example` (commented, off). |
| `APP_ORIGIN` (or derive from request) | server | Base URL the mock deep link points at for `/booking-demo`. Prefer deriving from `request.nextUrl.origin` (works on any domain, like auth does) — only add an env if a derived origin is unavailable. |
| `ROUTESTACK_WEBHOOK_SECRET` | server (existing, 10d) | Reused — the self-emitted `BOOKING_SUCCESS` is signed with it so the webhook verification passes. Unset → webhook skips verification (dev). |

## Acceptance criteria (15)

- **AC1 — full happy path (mock).** With `ROUTESTACK_MOCK=1`, a signed-in user can: proceed-to-book a real curated hotel → see the confirm screen → see ≥2 room options (mapped by the **real** mapper) → pick one → get a `/booking-demo` deep link → confirm → land on "Booking confirmed ✅". No RouteStack network call is made (assertable: the live transport's `fetch` is never invoked).
- **AC2 — lifecycle flip.** Confirming on `/booking-demo` results in the user's `booking_orders` row transitioning **PENDING → CONFIRMED/COMPLETED** via the **real** `/api/webhooks/routestack` correlation (a `webhook_events` audit row is written, billing PII redacted) — i.e. the 10d code path actually ran.
- **AC3 — warm fallbacks.** A hotel name carrying `__NOAVAIL__` → the chat shows the no-availability fallback (offer different dates / another hotel); `__EXPIRED__` → the offer-expired fallback. Both via the real `BookingError` → spec-14 copy path.
- **AC4 — prod safety.** Unset `ROUTESTACK_MOCK` → identical to today's live behaviour; `next build` succeeds with no preflight change (the flag is not `NEXT_PUBLIC_`, so it can't be baked into the bundle). `/api/booking/mock-confirm` 404s/403s when the flag is off.
- **AC5 — honesty.** The `/booking-demo` page visibly states it's a demonstration checkout; mock OTEL spans carry `mock: true`; no fake data reaches the hotel/intelligence layer.
- **AC6 — unit coverage.** `createMockRouteStackFetch()` is unit-tested against the orchestrator (search→rates→revalidate→payment-url) producing a valid `RoomsAndRates` + `BookingHandoff`; the mock-confirm self-emit is integration-tested to flip a seeded pending order. Key-free, runs in CI without `ROUTESTACK_MOCK` (tests inject the mock directly).

## Claude Code Action Items

1. **Confirm the mock destination/checkout design with the founder** before building (this spec). Specifically: the `/booking-demo` page copy + the "demonstration" banner, and whether the demo should also support cancellation (out of scope here unless asked).
2. **Slice 1 — mock transport:** `lib/booking/mock-transport.ts` (`createMockRouteStackFetch()` + `routeStackMockEnabled()`), deterministic per-hotel re-pricing off the captured fixture, magic-token controls. Wire into both booking routes (lazy, after auth, alongside the E2E branch). Unit tests against the real orchestrator. OTEL `mock:true` tag.
3. **Slice 2 — mock checkout + lifecycle:** `app/booking-demo/page.tsx` (locked tokens, demo banner) + `POST /api/booking/mock-confirm` (gated; self-emits `BOOKING_SUCCESS` to `/api/webhooks/routestack`, signed with `ROUTESTACK_WEBHOOK_SECRET`). Integration test for the pending→confirmed flip.
4. **Slice 3 — docs/env:** `.env.example` (`ROUTESTACK_MOCK` commented off), spec 13 (env table row), spec 18 (deploy runbook: "demo mode = set `ROUTESTACK_MOCK=1`; go-live = unset + redeploy"), spec 15 (AC1–AC6). Notion sync (10e page under the 10c/10d family + spec index row).
5. **PAUSE for founder review** after the spec (this file) + Notion 10e, before coding — per the standing spec-first cadence.
