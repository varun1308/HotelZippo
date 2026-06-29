-- 0016_booking_orders.sql
-- WHAT: Two new tables for RouteStack booking-order tracking (spec 10d · Booking Webhooks):
--   public.booking_orders — ONE row per booking with a lifecycle. Born "pending" at the
--     payment-url handoff (who started which booking, keyed by HotelZippo email +
--     correlationId), then promoted to "tracked" when an inbound RouteStack webhook matches
--     it by billing_email and attaches the RouteStack orderid + lifecycle statuses.
--   public.webhook_events — append-only audit log of every inbound RouteStack webhook
--     delivery (matched or not), holding the REDACTED payload for replay/debugging.
-- WHY: 10c's deep-link booking flow hands the user off to RouteStack's checkout and learns
--   NOTHING about the outcome (get-payment-url returns only { url, success }; our anonymous
--   partner can't list-bookings). RouteStack's outbound webhooks push the order lifecycle
--   (creation → payment → booking → cancel/refund) back to us. These tables let a deep-link
--   booking become a TRACKED order, enabling end-to-end verification of the RouteStack flow
--   (and a future /bookings page — out of scope here).
-- CORRELATION: the payload carries no HotelZippo identifier, so the only handle tying an event
--   to our user is billing_email. We write a booking_orders row at handoff (linked = false),
--   then on webhook match the most-recent unlinked row by lower(user_email) = lower(billing_email)
--   → attach rs_order_id + statuses, set linked = true. Unmatched events are still persisted
--   (never dropped) and can be reconciled later.
-- IDEMPOTENCY: rs_order_id is UNIQUE so a redelivered webhook for the same order UPSERTS the same
--   booking_orders row (last-writer-wins statuses) — webhooks can be redelivered.
-- NULLABILITY: user_id and rs_order_id are NULLABLE because an unmatched webhook can land before
--   or without a linked HotelZippo user (e.g. the user typed a different email at checkout).
-- NOTE: hotel_id is RouteStack's id STRING, intentionally NOT a uuid FK to public.hotels — it is a
--   raw provider-side id captured at handoff and must survive even when no hotels row exists.
-- Canonical: Notion 07 · Data Model (needs booking_orders + webhook_events added there — see handoff note).

-- ---------------------------------------------------------------------------
-- booking_orders — one row per booking; "pending" at handoff, "tracked" on webhook match.
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- webhook_events — raw, append-only webhook audit log (every delivery, matched or not).
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- RLS:
--   booking_orders — RLS enabled with ONE owner-read SELECT policy so a signed-in user reads
--     only their OWN tracked orders (for the future /bookings page). There are NO insert/update/
--     delete policies: every write happens via the service role (the webhook + handoff routes),
--     which bypasses RLS. Mirrors the owner-only auth.uid() = user_id pattern from 0004.
--   webhook_events — service-role only. RLS enabled with NO client policies (the service role
--     bypasses RLS; authenticated/anon clients get zero rows). Mirrors raw_routestack_payloads
--     in 0015 / raw_reviews in 0004.
-- ---------------------------------------------------------------------------
alter table public.booking_orders enable row level security;
alter table public.webhook_events enable row level security;

create policy booking_orders_owner_select on public.booking_orders
  for select to authenticated using (auth.uid() = user_id);
