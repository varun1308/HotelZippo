# 10d · RouteStack Booking Webhooks (order lifecycle → tracked orders)

- **Notion:** extends 10c (RouteStack integration) · 08c (Booking Agent). **Phase:** 7 follow-up. **Status:** SPEC (build in progress).
- **Cross-refs:** 10c · RouteStack (the deep-link booking flow this completes) · 07 · Data Model · 13 · Environment · 14 · Error Handling · 15 · Test Strategy.

> **What this closes.** 10c's deep-link model hands the user off to RouteStack's checkout and HotelZippo learns **nothing** about the outcome — `get-payment-url` returns only `{ url, success }`, no order id, and our anonymous partner can't `list-bookings`. RouteStack now provides **outbound HTTP webhooks** that push the **order lifecycle** (creation → payment → booking → cancel/refund) to a URL we configure, each event carrying an `orderid` + `billing_email`. This spec adds the **inbound webhook endpoint** + **pending-order correlation** so a deep-link booking becomes a **tracked order** in HotelZippo — enabling end-to-end verification of the RouteStack flow (and, later, a `/bookings` page + chat status, which are OUT of this spec).

## What RouteStack sends (confirmed from the webhook docs, 2026-06-28)

Configured in RouteStack's dashboard (**Webhook Settings**) with separate **Live** and **Sandbox** endpoints, each with a **Webhook URL** + an optional **Webhook access key** (shared secret).

**Events** (all `module: HOTEL|CAR|FLIGHT` — we care about HOTEL):

| Event | `orderstatus` | `paymentstatus` | Meaning |
| --- | --- | --- | --- |
| `ORDER_CREATION_SUCCESS` | INCOMPLETE | — | Order shell created (`orderid` assigned) |
| `ORDER_CREATION_FAILED` | INCOMPLETE | — | Order never created (`orderid: null`) |
| `ORDER_PAYMENT_AUTHORIZED` | INCOMPLETE | AUTHORIZED | Card authorized, not captured |
| `ORDER_PAYMENT_CAPTURED_SUCCESS` | CONFIRMED | COMPLETED | Money captured |
| `ORDER_PAYMENT_FAILED` | INCOMPLETE | INCOMPLETE | Payment failed |
| `ORDER_PAYMENT_REFUNDED` | CANCELLED | REFUNDED | Refunded |
| `BOOKING_SUCCESS` | CONFIRMED | COMPLETED | **Hotel booked** ✅ |
| `BOOKING_FAILED` | INCOMPLETE | REFUNDED | Booking failed (auto-refunded) |
| `BOOKING_CANCELLED` | CANCELLED | REFUNDED | Booking cancelled |

**Payload shape** (consistent across events; `createdat`/`paymentstatus` present on some):
```json
{
  "event": "BOOKING_SUCCESS",
  "orderid": "RSA-1234567890",        // string | null (null only on early CREATION_FAILED)
  "orderstatus": "CONFIRMED",          // INCOMPLETE | CONFIRMED | CANCELLED
  "message": "Booked hotel successfully",
  "createdat": "2026-06-24T12:00:00Z",
  "account_code": "ACME-1234",         // OUR RouteStack account code
  "billing_email": "john.doe@example.com",  // ← the user-correlation handle
  "billing_name": "John Doe",
  "price": 100,
  "currency": "USD",
  "module": "HOTEL",
  "event_timestamp": "2026-06-24T12:00:05Z",
  "paymentstatus": "COMPLETED"         // AUTHORIZED | COMPLETED | INCOMPLETE | REFUNDED (when applicable)
}
```

### The correlation problem + decision
The payload carries **no HotelZippo identifier** — `get-payment-url` accepts no partner-reference field, so nothing we own round-trips. The only field that can tie an event to **our** user is **`billing_email`** (what the user types on RouteStack's checkout). Decision (founder, 2026-06-28):

- **At payment-url handoff, write a `pending_orders` row** `{ user_id, user_email, hotel, dates, correlation_id, … }`. This is the bridge: it records *who* started *which* booking, keyed by their HotelZippo email + the session `correlationId`.
- **On webhook, match by `billing_email`** to the **most-recent unlinked** pending order for that email → attach `orderid` + lifecycle status; the order becomes **tracked**.
- **Honest edge:** if the user types a *different* email at checkout than their HotelZippo account email, the event can't be matched — it's still **persisted (unlinked)**, never dropped, and can be reconciled later. We log the unmatched count; we do not fail the webhook. (A future server-supplied reference on `get-payment-url` would make this airtight — out of scope, pending RouteStack.)

## Schema — migration `0016_booking_orders.sql`

Two **service-role-only** tables (RLS enabled; **owner-read policy on `booking_orders`** so a signed-in user can read their *own* tracked orders for the future `/bookings` page; `webhook_events` stays service-role only). Cross-ref 07 · Data Model.

```sql
-- pending_orders → booking_orders is ONE table with a lifecycle, not two:
create table public.booking_orders (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid references public.users(id) on delete set null,   -- nullable: an unmatched webhook can land before/without a user
  user_email      text,                          -- HotelZippo account email captured at handoff (match key)
  -- booking context captured at payment-url handoff (the "pending" half):
  hotel_id        text,                           -- RouteStack hotel id (string, no FK)
  hotel_name      text,
  destination     text,
  check_in        date,
  check_out       date,
  correlation_id  text,                           -- RouteStack session correlationId (audit / future join)
  currency        text,
  -- order tracking (filled by webhooks):
  rs_order_id     text unique,                    -- RouteStack orderid (RSA-…); NULL until first event; UNIQUE so events upsert
  order_status    text,                           -- INCOMPLETE | CONFIRMED | CANCELLED (latest)
  payment_status  text,                           -- AUTHORIZED | COMPLETED | INCOMPLETE | REFUNDED (latest)
  last_event      text,                           -- last event name applied
  billing_email   text,                           -- the email RS reported (may differ from user_email)
  price           numeric,
  linked          boolean not null default false, -- true once a webhook matched this row to its order
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index booking_orders_user_email_idx on public.booking_orders (lower(user_email));
create index booking_orders_user_id_idx on public.booking_orders (user_id);

-- Raw, append-only webhook audit log (every delivery, matched or not). Replay + debugging.
create table public.webhook_events (
  id              uuid primary key default gen_random_uuid(),
  source          text not null default 'routestack',
  event           text not null,                  -- ORDER_CREATION_SUCCESS, BOOKING_SUCCESS, …
  rs_order_id     text,                            -- orderid from the payload (nullable)
  booking_order_id uuid references public.booking_orders(id) on delete set null,  -- matched order, if any
  matched         boolean not null default false,
  payload         jsonb not null,                  -- REDACTED payload (billing_name/email masked — see redaction)
  received_at     timestamptz not null default now()
);
create index webhook_events_rs_order_id_idx on public.webhook_events (rs_order_id);
create index webhook_events_event_idx on public.webhook_events (event);
```

- **RLS:** both tables `enable row level security`. `webhook_events` = **no policies** (service-role only). `booking_orders` = **one SELECT policy** `using (auth.uid() = user_id)` so a user reads only their own orders (for the future `/bookings` page); all writes happen via the service role (webhook + handoff routes), never the client.
- **`rs_order_id UNIQUE`** so repeated events for the same order **upsert** the same row (idempotent — webhooks can be redelivered).

## The webhook endpoint — `app/api/webhooks/routestack/route.ts`

`POST` only, **public** (no Supabase auth gate — RouteStack is the caller), `runtime = nodejs`, `dynamic = force-dynamic`. Steps:

1. **Verify the shared secret.** Read the configured access key from `ROUTESTACK_WEBHOOK_SECRET`. RouteStack delivers it per its webhook settings — **verify the exact delivery mechanism against a live test ping** (likely a header e.g. `x-webhook-key` / `authorization`, or a query param). Compare with **timing-safe equality**. Mismatch / missing (when a secret is configured) → **401**, log + record nothing. If `ROUTESTACK_WEBHOOK_SECRET` is unset (local/dev), skip verification (so sandbox testing works) but `log.warn`.
2. **Parse + validate** the body against a Zod schema (`lib/booking/webhook.ts`). Unknown/garbage → **400** (don't persist). Non-HOTEL `module` → **200** ack + skip (we only track hotels in v1).
3. **Redact + persist the raw event** to `webhook_events` (always, matched or not) — `billing_name` + `billing_email` masked in the stored `payload` (PII; the match key is used transiently, not stored raw in the audit log). Reuse the `redact()` approach from `lib/booking/payload-log.ts`.
4. **Correlate + update the order:**
   - If `orderid` present and a `booking_orders` row already has that `rs_order_id` → **update** its `order_status` / `payment_status` / `last_event` / `price`.
   - Else match the **most-recent `linked = false` `booking_orders` row** with `lower(user_email) = lower(billing_email)` (created within a sane window, e.g. 24h) → set its `rs_order_id`, statuses, `linked = true`, `billing_email`.
   - No match → leave the event recorded as **unmatched** (`matched = false`); never error.
5. **Always return `200`** for any authentic, well-formed event (even unmatched) so RouteStack doesn't retry endlessly. Auth/parse failures are the only non-200s.

**Idempotency:** keyed on `rs_order_id` + applying the latest status — a redelivered event is harmless. Late/out-of-order events: we store `last_event` + the latest statuses; we do NOT try to enforce a strict state machine in v1 (statuses are last-writer-wins; `webhook_events` keeps the full ordered history for audit).

## Pending-order write (in `app/api/booking/payment-url/route.ts`)

After `selectAndPaymentUrl` succeeds (we have a deep-link URL), **before returning**, best-effort insert a `booking_orders` row: `{ user_id: user.id, user_email: user.email, hotel_id, hotel_name: body.hotelName, destination?, check_in, check_out, correlation_id: body.correlationId, currency }`, `linked = false`. **Best-effort** — a failed insert never blocks the handoff (the user still gets their booking URL); we just won't be able to correlate that one. Gated on the same service-client availability as the existing debug-log injection.

## Environment (→ 13)

| Var | Scope | Purpose |
| --- | --- | --- |
| `ROUTESTACK_WEBHOOK_SECRET` | server-only | Shared secret matching RouteStack's **Webhook access key**. When set, the endpoint verifies every inbound delivery (timing-safe) and 401s on mismatch. Unset (local/dev) → verification skipped with a warn, so sandbox pings work. |

Founder configures the **Webhook URL** in RouteStack (sandbox first): `https://<host>/api/webhooks/routestack`, and the matching access key both in RouteStack settings and as this env var.

## Testing the end-to-end RouteStack flow

1. **Local/sandbox:** point RouteStack's **Sandbox** webhook URL at a tunnel to local (`/api/webhooks/routestack`) — or at `webhook.site` first to eyeball the real delivery shape + how the access key is transmitted. Then run a real sandbox booking through the deep link → observe `ORDER_CREATION_SUCCESS` → … → `BOOKING_SUCCESS` land in `webhook_events`, and the `booking_orders` row flip `linked = true` with `order_status = CONFIRMED`.
2. **Unit tests** (`tests/unit/booking-webhook.test.ts`): Zod parse (valid events, reject garbage), secret verify (match / mismatch / unset-skip), correlation logic (existing-order update; email match; no-match → recorded unmatched), redaction (billing_name/email masked).
3. **Integration** (`tests/integration/booking-webhook.test.ts`): POST real example payloads to a handler against local Supabase → assert `webhook_events` row + `booking_orders` linkage; idempotent redelivery; RLS (a user reads only their own `booking_orders`; `webhook_events` not client-readable).

## Out of scope (explicit)
- **`/bookings` page + chat status surfacing** — deferred to a follow-up (the owner-read RLS policy + tracked statuses are the foundation they'll build on).
- **Cancellation from HotelZippo** (`cancel-booking`) — separate; we only *receive* cancel events here.
- **Flight / car modules** — events are acked + skipped; only HOTEL is tracked.
- **Strict lifecycle state machine** — v1 is last-writer-wins statuses + a full ordered `webhook_events` audit trail.
- **OTEL logs** of webhook deliveries — the existing `raw_routestack_payloads` / OTEL-logs plan ([deferred]) is separate.

## Claude Code Action Items
1. Migration `0016_booking_orders.sql` — `booking_orders` (+ owner-read RLS) + `webhook_events` (service-role only). db-migrator owns it + the RLS-isolation assertion.
2. `lib/booking/webhook.ts` — Zod schema for the event payload + `verifyWebhookSecret(req)` (timing-safe, env-gated) + `correlateOrder(...)` pure logic (injectable client, unit-testable).
3. `app/api/webhooks/routestack/route.ts` — verify → parse → redact+persist event → correlate/update order → 200.
4. `app/api/booking/payment-url/route.ts` — best-effort `booking_orders` pending-row write after a successful payment URL.
5. `specs/13-environment.md` + `.env.example` — document `ROUTESTACK_WEBHOOK_SECRET`. Reconcile **10c** ("no webhook" line is now superseded by this spec).
6. Tests per the testing section; full gate (tsc · eslint · jsdom · integration · RLS).
