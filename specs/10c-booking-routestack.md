# 10c · Booking Agent & RouteStack Integration (Phase 7)

- **Notion:** 10c (RouteStack integration contract) · 08c (Booking Agent). Built against **`specs/openapi.yaml`** — the **authoritative** RouteStack OpenAPI doc the founder provided (2026-06-05) — reconciled with **10c** + **08c**. The earlier SDK sample (`client.hotels.search(...)`) in 10c was **marketing**; `openapi.yaml` supersedes it.
- **Phase:** 7 (final build phase) · **Status:** SPECCED — **all three slices buildable now.** The founder has sandbox keys and the core schema is confirmed by `openapi.yaml`, so the live path is **no longer blocked**. **Scope addition (founder, 2026-06-05):** booking is now a **two-phase flow** with a **room/rate selection step** rendered as a **modal / bottom-sheet room picker** (not inline chat cards, not a card accordion). Phase 1 returns the available rooms/rates; the user picks one; Phase 2 revalidates that specific rate → payment URL.
- **Filename note:** prefixed `10c` after the booking/RouteStack integration's canonical Notion home (10c · RouteStack), matching the repo convention of keying each spec to its Notion page number (cf. `02-`, `04-`, `10a-`, `08b-`). It is the **Phase-7** build contract. Reconciled from **10c** (canonical integration contract; the booking *model* — deep-link, not server-side reservation) + **08c** (Booking Agent flow; decision D4 — no dedicated Claude prompt).
- **Canonical cross-refs:** 07 · Data Model (`trip_briefs`, `hotels`, `family_profiles`) · 08b · Conversation Agent (booking-intent detection) · 13 · Environment & Secrets · 14 · Error Handling / OTEL · 15 · Test Strategy. Skills: `otel-wrap`.

> The Booking Agent is a **genuine thin pass-through** to RouteStack's hotel data layer. RouteStack does **NOT** take a server-side reservation or return an in-app confirmation — the final step (`get-payment-url`) returns a **pre-populated deep-link checkout URL** (`booking_url`) carrying property + dates + selected rate, and the **user** completes booking off-platform on the RouteStack/supplier checkout. Implications for HotelZippo v1: **no payment handling, no PCI scope, no booking state machine, no reservation records.** "Confirmation" is off-platform; revenue-share attribution is tied to the partner credentials / deep link. The deep-link model holds **no** reservation state — the `get-booking-info` / `cancel-booking` / `list-bookings` endpoints exist in `openapi.yaml` but are **OUT of v1 scope**.

## Decisions locked (from 10c · 08c · openapi.yaml)

1. **Deep-link model (corrects the earlier 08c assumption).** HotelZippo runs the RouteStack session → gets `booking_url` from the **final** `get-payment-url` step → hands the user off (new tab). No server-side reservation, no in-app confirmation, no booking state.
2. **No dedicated Claude prompt for the Booking Agent (08c decision D4, 2026-06-04).** Minimal logic, maximum pass-through. Booking *intent* detection lives in the **Conversation Agent (08b)**, NOT here. The Booking Agent holds **no** booking business logic of its own — it is a thin session orchestrator.
3. **Transport = plain HTTPS REST + HMAC→JWT auth (corrects the earlier "MCP transport" assumption).** RouteStack is **not** an MCP stdio transport and **not** a one-shot SDK call. It is plain HTTPS REST (JSON POST per call). `ROUTESTACK_API_URL` = the HTTP base URL (sandbox base `https://evolvemcp.routestack.ai`; the token-exchange sample base is `https://mcp.routestack.ai`). Sandbox Account ID = `AWP889CG`.
   - **Auth:** `POST /mcp/auth/partner-token` with `{ apiKey, hmac, timestamp, nonce }`, where `hmac = HMAC-SHA256(API_SECRET, "apiKey:timestamp:nonce").digest('base64url')`, `timestamp` = Unix **seconds**, `nonce` = random UUID. Returns `{ token }` (JWT, `expiresIn` 24h). Send `Authorization: Bearer <token>` on **every other** call. **Cache & reuse the JWT within its 24h TTL** — do not re-mint per call.
   - **Env (server-side ONLY, never client — CLAUDE.md hard rules #2, #5):** `ROUTESTACK_API_KEY` (public identifier), **NEW** `ROUTESTACK_API_SECRET` (HMAC secret), `ROUTESTACK_API_URL` (HTTP base). The actual key/secret live in `.env.local` — never in this spec.
4. **The wrapper is owned by HotelZippo:** `/lib/booking/routestack.ts` — a server-side **session orchestrator** that mints/caches the JWT, then runs the hotel session (resolve destination → search → details+rates → revalidate → payment-url), and returns a typed result `{ booking_url, … }`. Still a genuine pass-through (no payment/PCI/reservation state in HotelZippo).
5. **Two-phase booking with a room/rate picker (founder decision, 2026-06-05).** The session orchestrator is **split into two phases** with a user choice in between — the wrapper does **NOT** auto-pick a room.
   - **Phase 1 (`searchAndRates`-style):** on "Proceed to book", run JWT mint/cache → `search-destinations` → `search-hotels` (match the chosen hotel by `name`) → `get-hotel-details-and-rates` → **return the list of available rooms/rates to the UI. STOP here — do NOT auto-pick a room or call revalidate.**
   - **Room-picker UI:** a **modal / bottom-sheet** opens **OVER the chat** (NOT inline chat cards, NOT a card accordion — founder chose modal/sheet). It lists the available rooms/rates; the user **selects one room + rate**.
   - **Phase 2 (`selectAndPaymentUrl`-style):** on room selection, take the chosen room's `recommendationId` + `roomId` → **`revalidate`** that specific rate → **`get-payment-url`** → return the deep-link `booking_url`. The UI opens it in a new tab. **The deep link is only produced AFTER an explicit room choice.**
6. **Adaptive rooms/rates mapper (field names pinned via captured sandbox fixture).** The exact field **names** for the rooms/rates payload are **NOT** in `openapi.yaml` — the `get-hotel-details-and-rates` response is **trimmed** there ("Response trimmed for documentation due to size", length 150098). So the rooms/rates **mapper is written ADAPTIVELY**: tolerant of the real shape, it reads the room type / total price / currency / cancellation (free-cancellation flag / deadline) / board basis / bed type / max-occupancy fields, and **omits any field gracefully when absent**. The **exact field names are pinned by CAPTURING A REAL SANDBOX RESPONSE** during the live slice (Slice C): the wrapper makes a real `get-hotel-details-and-rates` call against a HotelZippo destination (Phuket/Singapore first; **fall back to a known-good sandbox city like Pune** if no inventory) and **SAVES the response as the canonical fixture at `specs/fixtures/routestack/rooms-rates.json`**, against which the mapper + modal are finalized. (Note: **RouteStack is plain HTTPS REST, NOT a connectable MCP server**, so the schema can't be introspected via MCP tooling — it's captured by our own wrapper calling the sandbox.)

## Scope

| In scope (v1) | Out of scope (deferred / explicitly NOT built) |
| --- | --- |
| Server-side session orchestrator `/lib/booking/routestack.ts` (JWT mint/cache → destination → search → details+rates → revalidate → payment-url) | Payment handling / PCI scope |
| **Two-phase booking: rooms/rates retrieval → modal room picker → revalidate selected rate → payment URL** | In-app reservation or confirmation / booking state machine |
| **Room-picker modal/sheet UI** (overlay over chat; lists rooms/rates; user selects one) | Auto-picking a room (the user must explicitly choose) |
| **Adaptive rooms/rates mapper** (field names pinned via captured sandbox fixture `specs/fixtures/routestack/rooms-rates.json`) | A dedicated Booking-Agent Claude prompt (08c D4) |
| Property matching (resolve the chosen `hotels` row to a `search-hotels` result by `name`) | |
| Param + guest-model **inference** from `trip_briefs` + `family_profiles.family_members` (+ grandparent hints in notes) → **confirmed conversationally** | Reservation records persisted in HotelZippo |
| "Proceed to book" CTA wiring → open `booking_url` (from `get-payment-url`) in a new tab | User-changeable currency (USD-only in v1; currency selection is **FUTURE scope**) |
| **Combined conversational confirm turn before Phase 1** (one turn confirms travellers + room count + exact dates; folds in the month-only date prompt; required even when unambiguous) | Booking-intent detection (lives in 08b, not here) |
| Success-envelope branching + graceful fallbacks per 14 (no-availability 204, offer-expired 5148) | `get-booking-info` / `cancel-booking` / `list-bookings` (deep-link holds no reservation state) |
| OTEL tracing of every RouteStack call → Dash0 | Flight / Car verticals (`/mcp/flight/*`, `/mcp/car/*`) |
| Mock fixtures (unit / key-free CI) + sandbox integration smoke (live path) | |

## RouteStack hotel flow (confirmed by `openapi.yaml`)

All calls are `POST` JSON to `ROUTESTACK_API_URL` + path, with `Authorization: Bearer <cached JWT>` (except the token mint itself). **The deep-link is the LAST step.**

0. **Mint/cache JWT** — `POST /mcp/auth/partner-token` `{ apiKey, hmac, timestamp, nonce }` → `{ token }` (24h). Reuse within TTL.
1. **Resolve destination** — `POST /mcp/hotel/search-destinations` `{ query, type: 'DESTINATION' }` → `result[]` of `{ id, fullName, country, type, coordinates: { lat, long } }`. Turns a place name into `destinationId` + coords (search-hotels needs `lat`/`long`/`destinationId`, not a city string).
2. **Search hotels** — `POST /mcp/hotel/search-hotels` `{ destinationId, destinationType, lat, long, checkIn, checkOut, rooms: [{ adults, children, childAges: number[] }], currency }` → `result.result[]` hotels `{ id, name, ourprice, baseprice, starRating, currency, … }` + `result.correlationId` + `result.token`. **PERSIST BOTH `correlationId` and `token`** and thread them through every later call (do not invent them). **Property match** = find the chosen hotel by `name` within `result.result[]`. **No availability** = `{ success: false, code: 204, result: null }`.
3. **Get details + rates (combined) — END OF PHASE 1** — `POST /mcp/hotel/get-hotel-details-and-rates` `{ hotelId, token, correlationId, checkIn, checkOut, rooms[], hotelName }` → **the list of available rooms/rates** (each carrying `recommendationId` + `roomId`). **Prefer the combined call for HotelZippo.** The two-call alternative (`get-hotel-details` + `get-rooms-and-rates`) exists but is **one pattern OR the other, never both** for the same step. **Phase 1 STOPS here** — the wrapper returns the mapped rooms/rates list to the UI for the modal picker; it does **NOT** auto-pick a room or proceed to revalidate. **Schema caveat:** the rooms/rates response is **trimmed in `openapi.yaml`** (length 150098), so the exact field names are **unknown from the doc** — see the **adaptive mapper** (decision 6) + the **captured sandbox fixture** `specs/fixtures/routestack/rooms-rates.json` (Slice C).
4. **Revalidate — START OF PHASE 2 (after the user picks a room)** — `POST /mcp/hotel/revalidate` `{ hotelId, recommendationId, token, correlationId }` for the **user-selected** room/rate → verify the rate before payment; call this **immediately before** `get-payment-url`. **Offer expired** = `{ success: false, code: 5148, message: "The offer you were viewing has expired" }`.
5. **Get payment URL (deep link)** — `POST /mcp/hotel/get-payment-url` `{ hotelId, token, correlationId, recommendationId, roomId, checkIn, checkOut, hotelName }` (the **chosen** `recommendationId` + `roomId`) → `{ success, url }`. The `url` (`https://evolve.routestack.ai/hotel/guests?...&deeplink=Y`) **IS** the `booking_url` the user is handed off to (open in a new tab). **Only produced after an explicit room choice.**

### Rooms/rates card detail (rendered in the modal picker)

Each room/rate option in the modal shows (founder chose "add board + bed + occupancy"): **room type / name**, **total price + currency**, **cancellation terms** (free-cancellation flag / deadline), **board basis** (room-only / breakfast / etc.), **bed type**, and **max occupancy**. The **mapper is adaptive** — it reads each of these fields tolerantly from the real payload shape and **omits any field gracefully when absent** (the exact field names are unknown until the sandbox fixture is captured; see decision 6).

## Error model (confirmed by `openapi.yaml`)

- **Uniform envelope:** `{ success, message, code, result }` on every response.
- **Business failures return HTTP 200** with `success: false` + a human `message`. The wrapper **MUST branch on `success`, not on HTTP status.**
- **Known codes:** `204` no-availability (search) · `5148` offer expired (revalidate / rooms-rates) · `5034` booking-info-not-found.
- Map all failures to **warm conversational fallbacks per spec 14** (never dead-end; offer different dates or another shortlisted hotel).
- **Session TTL ~2h** (`CORRELATION_ID_TTL_MS`). If the `correlationId` / `token` expire mid-flow, **re-run the search** (step 2) to obtain a fresh session.

## HotelZippo → RouteStack mapping (what the wrapper passes)

Verified against the repo (`lib/db/schemas.ts`):

| RouteStack input | Source in HotelZippo | Notes / repo ground-truth |
| --- | --- | --- |
| `query` (search-destinations) | selected hotel's `hotels.destination` | `enum(DESTINATIONS)` = Phuket / Hong Kong / Singapore / Maldives / Bali. **Bangkok is NOT a destination.** The wrapper passes the destination name as the free-text `query`; **flag:** confirm the RouteStack destination vocabulary matches at integration time (no longer a blocker — `search-destinations` resolves free-text). |
| `destinationId` / `lat` / `long` (search-hotels) | from the `search-destinations` `result[]` | Resolved at step 1; **not** sourced directly from HotelZippo. |
| property match | `hotels.name` within `search-hotels` `result.result[]` | RouteStack search is **destination-level**; HotelZippo has already chosen a specific hotel → wrapper **matches the chosen property by `name`** within results. **There is no per-property endpoint** — destination search + name match is the confirmed pattern. |
| `checkIn` / `checkOut` | `trip_briefs.travel_dates` (start / end) | ISO `yyyy-mm-dd`, both **required** by `search-hotels`. `travel_dates` is **loosely-typed jsonb** (`z.unknown().nullable()`) — there is **NO** separate `travel_month` column. **"Month-only" = `travel_dates` lacks a resolvable start + end.** If only a month is set → **prompt for exact dates as a conversational chat turn before the call** (founder decision 2026-06-05; not an inline date-picker), never guess. |
| `rooms: [{ adults, children, childAges[] }]` | the **CONFIRMED party** from the combined confirm turn (seeded by an inference from `family_profiles.family_members` + grandparent hints in freestyle `notes`) | The mechanical mapping (`adults = 1 + (spouse ? 1 : 0)`; `children = family_members.children.length`; `childAges` = `children[].age`, mapped **directly**) is the **INFERENCE that seeds** the confirm turn — **not** the value passed. The **confirmed** travellers + room count (after the user confirms/corrects in ONE combined turn, incl. grandparents from notes) are **authoritative** and drive the `rooms[]` array. See the guest-model subsection + the combined confirm turn (booking flow). |
| `currency` | fixed `USD` for v1 | **USD is the v1 default.** User-changeable currency is **explicitly FUTURE scope** (not built in v1). |

### Guest-model derivation → confirmed conversationally (founder decision, 2026-06-05)

The guest model is no longer **silently derived** from `family_members` and passed straight to RouteStack. The mechanical derivation is now the **INFERENCE that seeds a combined conversational confirm turn**; the **confirmed** values are authoritative.

- **The inference (seed only).** An **inference helper** (pure function — see Slice A) reads the profile + freestyle notes and proposes:
  - `adults = 1 + (family_members.spouse ? 1 : 0)`, `children = family_members.children.length`, `childAges = family_members.children.map(c => c.age)` — `children[].age` maps directly into `childAges`; plus
  - **any grandparent hints in freestyle `notes` / `freestyle_notes`** folded into the proposed travelling party, and
  - a **default room count** from a simple heuristic (~**1 room per 2 adults**; **grandparents likely a separate room**).
  - The `rooms` model **supports** adults/children split **with child ages** **and** multiple rooms — confirmed by `HotelRoomOccupancy` + `rooms: HotelRoomOccupancy[]` in `openapi.yaml`.
- **The confirm turn (authoritative).** The concierge posts **ONE combined message** summarizing the inferred party (e.g. "2 adults, 2 children aged 2 & 7"), the proposed room count (e.g. "2 rooms"), **and** prompts for exact dates if `travel_dates` is month-only — asking the user to **confirm or correct all of it at once** (fewest interruptions; same conversational mechanism as the month-only date prompt). The **confirmed** party + room count + dates then drive the RouteStack `rooms: [{ adults, children, childAges[] }]` array and `checkIn` / `checkOut` for Phase 1.
- **Grandparents gap — now CLOSED via conversation, not structured data.** Grandparents are still **not** a structured field (they live only in freestyle `notes`), so they are not *auto-counted* — but they are **captured conversationally**: the inference folds notes hints into the proposed party and the user confirms/corrects, so grandparents are **included via the confirm turn**. Do **not** invent a grandparents field.
- **Rooms count — user-confirmed with an inferred default** (no longer a hardcoded single room). The inference proposes a default (~1 room per 2 adults; grandparents likely separate) and the user confirms/corrects it in the combined turn. **Multi-room support stays** — RouteStack `rooms[]` is an array.
- **Always confirm, even when unambiguous.** If everything is already known and unambiguous (full dates, no grandparent ambiguity), the confirm turn is still **REQUIRED** as a lightweight gate ("Here's who I'm booking for: … — good to go?"), since travellers / rooms materially affect pricing and availability.

## Wrapper behaviour (`/lib/booking/routestack.ts` — HotelZippo owns)

- **Server-side session orchestrator, SPLIT into two phases** (the user picks a room in between — never auto-picked):
  - **Phase 1 — `searchAndRates`-style call:** Mint/cache JWT → `search-destinations` → `search-hotels` (match by `name`) → `get-hotel-details-and-rates` → return the **mapped rooms/rates list** to the UI (threading `correlationId` + `token`). Stops here.
  - **Phase 2 — `selectAndPaymentUrl`-style call:** takes the chosen `recommendationId` + `roomId` (plus the persisted `correlationId` + `token`) → `revalidate` that rate → `get-payment-url` → return `{ booking_url, … }` (the `booking_url` is the `get-payment-url` `url`).
  - Build params from the selected hotel + trip brief + family profile. Still a genuine pass-through — **no payment, PCI, or reservation state** in HotelZippo.
- **Adaptive rooms/rates mapper.** Phase 1's mapper reads the rooms/rates list tolerantly (room type / total price / currency / cancellation / board / bed / max occupancy), **omitting any field gracefully when absent**. Exact field names are **pinned against the captured sandbox fixture** `specs/fixtures/routestack/rooms-rates.json` (Slice C) — not from `openapi.yaml` (trimmed there).
- **`import 'server-only'` is OK here** — the wrapper is request-time / Next-bundled (invoked from a route or server action), never run under standalone `tsx`. (Do NOT add `server-only` to anything the standalone test/worker runtime imports.)
- **Lazy-throw env factory.** HMAC creds (`ROUTESTACK_API_KEY` / `ROUTESTACK_API_SECRET` / `ROUTESTACK_API_URL`) are read **only at call time**, never at import — so the module imports cleanly with no env (key-free CI). Mirror the established factory pattern.
- **Injectable HTTP transport.** The injectable seam is now around the **HTTP transport** — a `routeStackFetch`-style dependency. Default to a real `fetch`-based client; **inject a mock** in tests. The same seam serves both **mock fixtures** (key-free CI) and the **live sandbox**. No live bookings, no key required for unit tests.
- **OTEL on every call.** Wrap each RouteStack call in a span via `trace.getTracer('hotelzippo').startActiveSpan(...)` per the `otel-wrap` skill. Standard attributes (14): `hotel_id`, `dates`, `success`/`failure`, `latency` (`duration`). On error: record the exception, attach a trace ID, set span status = error, end the span in `finally`, and rethrow so the caller surfaces a **warm** message (never the raw error to the user).
- **Success-envelope branching, never dead-end (per 14).** Branch on the envelope `success` flag (not HTTP status). No availability (204), offer expired (5148), or any `success: false` → surface gracefully **in conversation** (warm voice, Try-again), and **always offer a clear next action**: different dates, or another shortlisted hotel. Session expiry mid-flow → re-run search. The three RouteStack failure scenarios from 14 all resolve to a warm conversational fallback, never a broken state.

## Booking flow (08c)

1. **Conversation Agent (08b) detects booking intent** ("Proceed to book").
2. It hands off the **selected hotel + trip dates + family profile** to the Booking Agent.
2b. **Combined conversational confirm turn (BEFORE Phase 1).** The wrapper/agent runs the **inference helper** (infer travelling party from `family_members` + grandparent hints in notes; propose a default room count via the ~1-room-per-2-adults heuristic) and the concierge posts **ONE combined message** summarizing the inferred party, the proposed room count, **and** — if `travel_dates` is month-only — prompting for exact dates, asking the user to **confirm or correct all of it at once**. The month-only date prompt is **folded into this same turn** (one turn handles dates + travellers + rooms). This turn is **REQUIRED even when everything is unambiguous** (lightweight "good to go?" gate). The **confirmed** party + room count + dates drive `rooms[]` / `childAges` and `checkIn` / `checkOut`. Only after confirmation does Phase 1 run.
3. **Phase 1 — Booking Agent runs the RouteStack session** (mint/cache JWT → resolve destination → search → match by name → details+rates) using the **confirmed** party / rooms / dates, and **returns the available rooms/rates** — it does **NOT** revalidate or pick a room.
4. **Room-picker modal/sheet opens over the chat** listing the rooms/rates (room type / price / cancellation / board / bed / occupancy). **The user selects one room + rate.**
5. **Phase 2 — on selection, the Booking Agent revalidates** the chosen rate → **`get-payment-url` returns the pre-populated deep-link checkout URL** (`booking_url`) for the selected hotel / dates / **chosen** rate.
6. **Conversation hands the user off** to that checkout URL (opened in a **new tab**). HotelZippo handles no payment, reservation, or in-app confirmation.

## "Proceed to book" UI wiring (repo ground-truth)

Verified in the repo — the CTA already exists and is currently **UNHANDLED at the chat-page level**; Phase 7 connects it:

- `components/recommendation/HotelCard.tsx` (Top Pick + Standard cards) renders the **"Proceed to book"** CTA and fires the card prop `onProceed?: () => void` (`components/recommendation/types.ts`, on both `TopPickCardProps` and `StandardCardProps`).
- The card prop `hotelId` (+ `hotelName`, `destination`, etc. on `HotelDisplay`) carries the identity needed to resolve the chosen `hotels` row.
- `components/recommendation/ShortlistableRecommendationSet.tsx` wraps the pure set and currently overrides **only** `onSave` (shortlist) — it passes `onProceed` through **untouched**. So Phase 7 supplies a real `onProceed` from `app/chat/page.tsx` (the same place that owns shortlist + brief state) down through `ShortlistableRecommendationSet` → rendered in chat via `components/chat/MessageRow.tsx` (`recommendation-set` part).
- **On `onProceed`:** **FIRST run the combined conversational confirm turn** — run the **inference helper** (infer party from `family_members` + grandparent hints in notes; propose a default room count) and post **ONE combined message** summarizing the inferred party + proposed room count, **and** (if dates are month-only) prompting for exact dates, asking the user to **confirm or correct all of it at once**. The month-only date prompt is **part of this turn** (no longer a separate prompt). This confirm turn is **REQUIRED even when dates are full and the party is unambiguous** (a lightweight "good to go?" gate). **Do not call RouteStack until the user confirms.** Only **after confirmation** (with the confirmed party / room count / dates) run the wrapper's **Phase 1** call → **open the room-picker modal/sheet** with the returned rooms/rates. On **room selection**, run the wrapper's **Phase 2** call (revalidate the chosen rate → `get-payment-url`), then **open `booking_url` in a new tab** (`window.open(..., '_blank', 'noopener,noreferrer')`). On `success: false` / wrapper error (either phase) → **warm conversational fallback** offering different dates / another shortlisted hotel (per 14). Never dead-end. **Modal close / no rooms available** are handled gracefully (close returns to chat; no-rooms surfaces a warm fallback).

### Room-picker modal/sheet (NEW overlay interaction state)

- A **modal / bottom-sheet** rendered **OVER the chat** (NOT inline chat cards, NOT a card accordion — founder chose modal/sheet, 2026-06-05). It lists the Phase-1 rooms/rates; the user selects one room + rate, which drives Phase 2.
- Built by the **ui-builder agent** against the **locked `design_handoff` tokens**. This is a **NEW overlay interaction state** → it needs **overlay/modal tokens drawn from the `design_handoff` system**. The **never-broken-image** rule and the **no-amber/red-except-hard-flag** rule **still apply**.
- Each option shows room type/name, total price + currency, cancellation terms, board basis, bed type, and max occupancy (fields **omitted gracefully** when absent — the modal is finalized against the captured sandbox fixture).
- **Modal close** (user dismisses without choosing) returns to chat cleanly; **no rooms available** surfaces a warm conversational fallback rather than an empty modal.

## Verify-against-sandbox list — ✅ Confirmed (2026-06-05, resolved by `openapi.yaml`)

All previously-open items are now **resolved** by the authoritative OpenAPI doc:

1. **`checkOut` / nights** — ✅ Confirmed. `checkOut` is ISO `yyyy-mm-dd`, **required** on `search-hotels` (alongside `checkIn`).
2. **Property-level lookup** — ✅ Confirmed. **No per-property endpoint.** Pattern = destination-level `search-hotels` + **match the chosen property by `name`** within `result.result[]`.
3. **Guest model** — ✅ Confirmed. `rooms: [{ adults, children, childAges: number[] }]` supports adults/children split **with child ages** **and** multiple rooms. HotelZippo `children[].age` maps directly into `childAges`. (Grandparents = known notes-only limitation.)
4. **Result schema** — ✅ Confirmed (with one carve-out). `search-hotels` returns `{ id, name, ourprice, baseprice, starRating, currency, … }` + `correlationId` + `token`; rates carry `recommendationId` + `roomId`; `get-payment-url` returns `{ success, url }` (the deep link). **Carve-out: the `get-hotel-details-and-rates` rooms/rates payload is TRIMMED in `openapi.yaml`** ("Response trimmed for documentation due to size", length 150098) → the **exact rooms/rates field names are NOT in the doc.** Handled by the **adaptive mapper** (decision 6) + **captured sandbox fixture** `specs/fixtures/routestack/rooms-rates.json` (Slice C). RouteStack is plain HTTPS REST (not a connectable MCP server), so the schema is captured by our own wrapper, not introspected via MCP tooling.
5. **Errors & limits** — ✅ Confirmed. Uniform envelope `{ success, message, code, result }`; business failures = HTTP 200 + `success: false`; codes 204 / 5148 / 5034; session TTL ~2h (`CORRELATION_ID_TTL_MS`).
6. **Completed-booking webhook/callback** — ✅ Confirmed **none.** The API has `get-booking-info` / `cancel-booking` / `list-bookings`, but those are **OUT of v1 scope** — the deep-link model holds no reservation state.
7. **Transport** — ✅ Confirmed. Plain **HTTPS REST + HMAC→JWT** (NOT MCP stdio, NOT a one-shot SDK). `ROUTESTACK_API_URL` = HTTP base; auth via `/mcp/auth/partner-token`; `ROUTESTACK_API_SECRET` required.

## Environment & setup (→ 13)

| Item | Where | Owner |
| --- | --- | --- |
| RouteStack account | RouteStack signup | Founder |
| Sandbox + live partner credentials | RouteStack | Founder |
| `ROUTESTACK_API_KEY` / `ROUTESTACK_API_SECRET` / `ROUTESTACK_API_URL` (server-side only) | App `.env.local`; **already added to `.env.example` + `specs/13-environment.md`** | Founder provides creds; vars already specced in 13 |
| Pricing / credits + revenue-share confirmation | RouteStack | Founder |

Sandbox creds in dev/CI; integration smoke tests run against **sandbox only** (per 15); mock fixtures for unit tests / key-free CI. **The API key AND secret never reach the client.**

## Slice plan (3 PRs — all buildable now)

### Slice A — two-phase session-orchestrator wrapper + adaptive mapper + mock path

Everything in Slice A is unit-tested against **MOCK fixtures**; no key required; CI stays key-free. **No UI yet.**

- `/lib/booking/routestack.ts` — the session orchestrator **SPLIT into its two phases**:
  - a **`searchAndRates`-style** call (Phase 1: JWT mint/cache → search-destinations → search-hotels → get-hotel-details-and-rates) that **returns the mapped rooms/rates list**, and
  - a **`selectAndPaymentUrl`-style** call (Phase 2: takes a chosen `recommendationId` / `roomId` → revalidate → get-payment-url) returning the `booking_url`.
- Plus: param builders (selected hotel + `trip_briefs` + `family_profiles`), the **party-inference helper** (a **pure function**: infer travelling party from `family_members` + grandparent hints in notes, and propose a default room count via the ~1-room-per-2-adults heuristic — grandparents likely a separate room — that **seeds** the combined confirm turn; **unit-tested against mock profiles**), guest-model + `rooms` builder that maps the **confirmed** party (not raw `family_members`) into `rooms[]` (`1 + spouse` adults + children-with-ages as the seeded inference; **multi-room** supported), property matcher (by `name` within `search-hotels` results), the **adaptive rooms/rates mapper** (reads room type / price / currency / cancellation / board / bed / occupancy; omits absent fields gracefully), a **graceful `success`-envelope error result type** (branch on `success`; map 204 / 5148 / session-expiry), and **OTEL spans per call**. The HTTP transport is **injectable**; Slice A wires a **mock `routeStackFetch`** + fixtures (rooms/rates list for Phase 1 → a `booking_url` for Phase 2).
- **Unit tests** against mock fixtures: HMAC/JWT mint + cache reuse, param building, the **party-inference helper** (party + default room count from mock profiles, incl. grandparent-hint folding), guest/`rooms` derivation from the **confirmed** party (incl. multi-room), destination resolution, property match by name, the combined details+rates step + **rooms/rates mapping** (incl. graceful field omission), revalidate-before-payment for a **chosen** rate, success-envelope branching (204 / 5148 / session-expiry), and the two-phase split (Phase 1 returns rooms without revalidating; Phase 2 produces the deep-link). No live bookings.

### Slice B — room-picker modal/sheet + "Proceed to book" UI wiring

- **Room-picker modal/sheet component** — built by the **ui-builder agent** against the **locked `design_handoff` tokens**. This is a **NEW overlay interaction state** → it needs **overlay/modal tokens drawn from the `design_handoff` system**; the **never-broken-image** rule and the **no-amber/red-except-hard-flag** rule **still apply**. Each room/rate option shows room type / price / cancellation / board / bed / occupancy (graceful omit when absent).
- **"Proceed to book" UI wiring** — supply `onProceed` from `app/chat/page.tsx` through `ShortlistableRecommendationSet`. On `onProceed` → **FIRST run the combined conversational confirm turn**: seed it with Slice A's **party-inference helper** (party + default room count) and post **ONE message** confirming travellers + room count + (if month-only) exact dates — folding the month-only date prompt into this single turn — for the user to confirm/correct; this turn is **required even when unambiguous** (lightweight "good to go?" gate); **no RouteStack call until confirmed**. After confirmation → run Slice A's **Phase 1** call (with the confirmed party / rooms / dates) → open the modal with the rooms/rates; on **room select** → run **Phase 2** → open `booking_url` in a new tab. On `success: false` / error → warm conversational fallback offering different dates / another shortlisted hotel (per 14). **Modal close / no rooms available** handled gracefully.

### Slice C — live HTTP transport + sandbox schema-capture + smoke

- Wire the real **`fetch`-based HTTP client** into the injectable seam from Slice A — the call sites and result type do not change; only the live transport implementation lands.
- **Sandbox schema-capture + smoke test** (per 15) — runs **ONLY where `ROUTESTACK_*` env is present**. Hit the sandbox through **Phase 1** against a HotelZippo destination (**Phuket/Singapore first; fall back to a known-good sandbox city like Pune** if no inventory), **SAVE the real rooms/rates JSON as `specs/fixtures/routestack/rooms-rates.json`** (the canonical fixture), and **reconcile the adaptive mapper's field names** against it. Assert the deep-link `booking_url` **SHAPE only**. **NEVER completes a live booking in CI** — stop **before / at** the `get-payment-url` URL-shape assertion.

## Acceptance criteria (→ append as Phase 7 to spec 15; do NOT edit 15 yet)

- **Token lifecycle:** the wrapper mints a JWT via `/mcp/auth/partner-token` (HMAC-SHA256 of `apiKey:timestamp:nonce`, base64url) and **caches/reuses** it within the 24h TTL (does not re-mint per call).
- **Destination resolution:** the destination name resolves via `search-destinations` to `destinationId` + `lat` + `long` before `search-hotels`.
- **Property match:** the chosen hotel is matched by `hotels.name` within `search-hotels` `result.result[]`; `correlationId` + `token` are persisted and threaded through every later call.
- **Details + revalidate:** `get-hotel-details-and-rates` returns `recommendationId` + `roomId`; `revalidate` is called **immediately before** `get-payment-url`, for the **user-selected** rate.
- **Two-phase flow + room picker:** Phase 1 returns the available rooms/rates and **does NOT auto-pick a room**; the **modal/sheet room picker** renders them with **room type / price / cancellation / board / bed / occupancy** (each field **omitted gracefully when absent**); the user's room selection drives **Phase 2** (revalidate → get-payment-url) for **that specific `recommendationId` / `roomId`**.
- **Adaptive mapper reconciled:** the adaptive rooms/rates mapper is **reconciled against a captured real sandbox fixture** (`specs/fixtures/routestack/rooms-rates.json`).
- **Valid deep link (explicit choice only):** `get-payment-url` returns `{ success, url }`; the UI opens `url` (the `booking_url`) in a new tab — **only AFTER an explicit room choice.**
- **Combined confirm turn before any RouteStack call:** before **any** RouteStack call, the agent confirms **travellers + room count + exact dates in ONE conversational turn**. The party is **inferred** (from `family_members` + grandparent hints in notes) and a **default room count** proposed (~1 room per 2 adults; grandparents likely separate); the **confirmed** party (incl. grandparents if present) drives `rooms[]` / `childAges`; the user can **correct** the inference. The turn is **required even when dates are full and the party is unambiguous** (lightweight "good to go?" gate). **Currency defaults to USD**; user-changeable currency is **FUTURE scope**.
- **Month-only dates:** when `travel_dates` lacks a resolvable start + end, exact dates are **prompted as part of the combined confirm turn** (folded in with travellers + rooms) **before** the RouteStack call (never guesses).
- **Success-envelope branching + graceful errors:** the wrapper branches on `success` (not HTTP status); 204 / 5148 / session-expiry are handled gracefully per 14 (warm voice + Try-again + a clear next action: different dates or another shortlisted hotel); **no broken state, never a dead-end.**
- **Tests:** sandbox-only in tests; **no live bookings in CI** (smoke stops before `get-payment-url` or asserts URL shape only); unit tests run against mock fixtures with no key.
- **Secret hygiene:** `ROUTESTACK_API_KEY` **and** `ROUTESTACK_API_SECRET` stay server-side and **never reach the client** (hard rules #2, #5).
- **Observability:** every RouteStack call is OTEL-traced → Dash0 (`hotel_id`, dates, success/failure, latency).

## Claude Code Action Items (from 10c · 08c · openapi.yaml)

**Slice A — two-phase wrapper + adaptive mapper + mock path (no UI):**

2. ⬜ `/lib/booking/routestack.ts` — server-side **session orchestrator SPLIT into two phases** (injectable HTTP transport): a **`searchAndRates`-style** Phase-1 call (JWT mint/cache → search-destinations → search-hotels → get-hotel-details-and-rates) returning the **mapped rooms/rates list**, and a **`selectAndPaymentUrl`-style** Phase-2 call (chosen `recommendationId` / `roomId` → revalidate → get-payment-url) returning `booking_url`; param + guest/`rooms` builders from the selected hotel + `trip_briefs` + `family_profiles`; thread `correlationId` + `token`; **graceful `success`-envelope error type**; **OTEL per call**; lazy-throw env factory (`ROUTESTACK_API_KEY` / `ROUTESTACK_API_SECRET` / `ROUTESTACK_API_URL`); `import 'server-only'` (request-time only).
3. ⬜ **Property matching** — resolve the chosen `hotels` row to a `search-hotels` result by `name` (no per-property endpoint; destination search + name match).
3b. ⬜ **Adaptive rooms/rates mapper** — tolerant of the real shape; reads room type / price / currency / cancellation / board / bed / max-occupancy; **omits any absent field gracefully** (exact field names pinned later by the captured sandbox fixture, Slice C).
3c. ⬜ **Party-inference helper** — a **pure function** that infers the travelling party (`adults = 1 + spouse`; children-with-ages; **plus grandparent hints from freestyle `notes`**) and proposes a **default room count** (~1 room per 2 adults; grandparents likely a separate room) to **seed the combined confirm turn**; the **confirmed** party (not raw `family_members`) maps into `rooms[]` / `childAges`; **unit-tested against mock profiles**. Currency = **USD** default (changeable = future scope).
5. ⬜ **Mock fixtures** for unit / key-free CI (Phase-1 rooms/rates list → Phase-2 `booking_url`); unit tests for HMAC/JWT mint + cache, param build, guest/`rooms` derivation, destination resolution, property match, details+rates + **rooms/rates mapping (incl. graceful omission)**, revalidate-before-payment for a chosen rate, success-envelope branching (204 / 5148 / session-expiry), and the two-phase split.

**Slice B — room-picker modal + "Proceed to book" UI wiring:**

4. ⬜ **Room-picker modal/sheet** (ui-builder agent, locked `design_handoff` tokens; **NEW overlay interaction state** needing overlay/modal tokens; never-broken-image + no-amber/red-except-hard-flag rules apply) rendering each option's room type / price / cancellation / board / bed / occupancy (graceful omit).
4b. ⬜ Wire **"Proceed to book"** CTA from `app/chat/page.tsx` through `ShortlistableRecommendationSet`: on proceed → **FIRST the combined conversational confirm turn** (seeded by the Slice A party-inference helper) — **ONE message** confirming travellers + room count + (if month-only) exact dates for the user to confirm/correct, folding the month-only date prompt in; **required even when unambiguous**; **no RouteStack call until confirmed** — then Phase 1 (with the confirmed party / rooms / dates) → **open modal** with rooms/rates; on **room select** → Phase 2 → open `booking_url` in a new tab; `success: false` / error → warm conversational fallback (different dates / another shortlisted hotel, per 14); **modal close / no-rooms handled gracefully**.

**Slice C — live HTTP transport + sandbox schema-capture + smoke (founder has sandbox keys):**

5b. ⬜ Wire the real **`fetch`-based HTTP client** into the injectable seam + a **sandbox schema-capture + smoke test** per 15: hit the sandbox through **Phase 1** against a HotelZippo destination (Phuket/Singapore first; fall back to Pune if no inventory), **SAVE the real rooms/rates JSON as `specs/fixtures/routestack/rooms-rates.json`**, **reconcile the adaptive mapper's field names** against it, and assert the deep-link `booking_url` **shape only** (sandbox env only; **NEVER completes a live booking in CI** — stop before / at the `get-payment-url` URL-shape assertion).

**Process:**

1. ✅ Confirm the verify list + update Notion 10c. The verify list is **resolved by `openapi.yaml`**; Notion 10c is being updated with the confirmed schema in parallel.
6. ✅ Generate the Phase 7 `/specs` from 10c + 08c + `openapi.yaml` (this file). (CLAUDE.md hard rule #7.)

## Founder dependencies (before Phase 7 handoff)

- Provide **sandbox + live keys** in `.env.local`: `ROUTESTACK_API_KEY` / `ROUTESTACK_API_SECRET` / `ROUTESTACK_API_URL` (server-side only). **Founder is providing sandbox keys now** so Slice C can capture the rooms/rates fixture.
- Confirm **pricing / credits + revenue-share**.

*(The core schema verify list is no longer a founder dependency — it is resolved by `openapi.yaml`. The one remaining capture is the **trimmed rooms/rates payload**, pinned during Slice C via a real sandbox call saved to `specs/fixtures/routestack/rooms-rates.json`.)*

## Cross-references

07 · Data Model · 08b · Conversation Agent (booking-intent detection) · 08c · Booking Agent · 10c · RouteStack Integration · 13 · Environment & Secrets · 14 · Error Handling / OTEL · 15 · Test Strategy · 16 · Spec Index · `specs/openapi.yaml` (authoritative RouteStack API; rooms/rates payload **trimmed** there) · `specs/fixtures/routestack/rooms-rates.json` (captured rooms/rates fixture — pinned in Slice C) · skill `otel-wrap`
