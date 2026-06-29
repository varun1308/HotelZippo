-- 0017_rollout_destinations.sql
-- WHAT: Update the supported-destination CHECK constraints on all 4 tables that enforce the
--   destination set, swapping the rollout list from
--     ('Phuket','Hong Kong','Singapore','Maldives','Bali')   -- old
--   to
--     ('Phuket','Singapore','Tokyo','Orlando','Bali')        -- new (REMOVE Hong Kong + Maldives,
--                                                            --      ADD Tokyo + Orlando).
--   Affected tables / constraints (all were created inline + unnamed, so Postgres auto-named them
--   <table>_<column>_check):
--     * trip_briefs              → trip_briefs_destination_check              (0001)
--     * hotels                   → hotels_destination_check                  (0001)
--     * routestack_destinations  → routestack_destinations_destination_check (0011; column is the PK)
--     * preview_seeds            → preview_seeds_destination_check            (0014)
--
-- WHY: HotelZippo is changing its supported destination set for rollout. This migration brings
--   ALREADY-MIGRATED databases (e.g. prod) in line with the new set. Fresh `supabase db reset`
--   (local dev / CI) is handled separately: 0001/0011/0014 were updated in place to emit the new
--   list directly, so a fresh build creates the constraints already correct and this migration is a
--   harmless no-op constraint re-assertion there.
--
-- CRITICAL ORDERING — delete-before-constraint:
--   The cache/latch tables can hold rows for destinations we are dropping. On prod,
--   routestack_destinations has exactly 1 row with destination='Maldives' that would VIOLATE the
--   new constraint, so `ADD CONSTRAINT` would fail. We therefore DELETE the now-unsupported
--   ('Hong Kong','Maldives') rows from the cache/latch tables (routestack_destinations,
--   preview_seeds) BEFORE adding the new constraint. These two tables are server-only,
--   regenerable caches, so deleting stale rows is safe.
--
--   We do NOT delete from hotels or trip_briefs — that is user/catalog data. On prod neither has
--   any Hong Kong/Maldives rows, so the constraint swap succeeds. If a violating row DID exist
--   there, the `ADD CONSTRAINT` would (correctly) fail loudly so a human decides what to do, rather
--   than silently dropping catalog/user data.
--
-- Idempotent where possible: `drop constraint if exists` + delete are safe to re-run.

-- ---------------------------------------------------------------------------
-- Step 1 — remove now-unsupported rows from the regenerable cache/latch tables FIRST,
--          so the new constraint can be added without violation.
-- ---------------------------------------------------------------------------
delete from public.routestack_destinations where destination in ('Hong Kong', 'Maldives');
delete from public.preview_seeds            where destination in ('Hong Kong', 'Maldives');

-- ---------------------------------------------------------------------------
-- Step 2 — swap the CHECK constraints to the new destination set on each table.
-- ---------------------------------------------------------------------------

-- trip_briefs.destination (0001) — user data; constraint add fails loudly if a violating row exists.
alter table public.trip_briefs drop constraint if exists trip_briefs_destination_check;
alter table public.trip_briefs add constraint trip_briefs_destination_check
  check (destination in ('Phuket', 'Singapore', 'Tokyo', 'Orlando', 'Bali'));

-- hotels.destination (0001) — catalog data; constraint add fails loudly if a violating row exists.
alter table public.hotels drop constraint if exists hotels_destination_check;
alter table public.hotels add constraint hotels_destination_check
  check (destination in ('Phuket', 'Singapore', 'Tokyo', 'Orlando', 'Bali'));

-- routestack_destinations.destination (0011) — cache table; violating rows already deleted above.
alter table public.routestack_destinations drop constraint if exists routestack_destinations_destination_check;
alter table public.routestack_destinations add constraint routestack_destinations_destination_check
  check (destination in ('Phuket', 'Singapore', 'Tokyo', 'Orlando', 'Bali'));

-- preview_seeds.destination (0014) — latch table; violating rows already deleted above.
alter table public.preview_seeds drop constraint if exists preview_seeds_destination_check;
alter table public.preview_seeds add constraint preview_seeds_destination_check
  check (destination in ('Phuket', 'Singapore', 'Tokyo', 'Orlando', 'Bali'));
