/* RouteStack id cache (Phase 7 optimisation · specs/10c-booking-routestack.md).
 *
 * Each booking flow makes paid RouteStack calls. The LIVE API contract (verified by probe) lets us
 * cache only the STABLE ids — availability/prices are volatile and never cached:
 *   - search-destinations output (destinationId + lat/long per HotelZippo destination) is stable →
 *     cache it and SKIP that call on repeat bookings.
 *   - get-hotel-details-and-rates REQUIRES a fresh session token that ONLY search-hotels mints, so
 *     search-hotels still runs every booking. But we cache the RouteStack hotel id ↔ our hotel row,
 *     so matching is DETERMINISTIC (exact id) instead of fuzzy name-matching ~141 results.
 *
 * This module is the persistence seam: pure functions over an injected SupabaseClient (the service
 * client — both tables are service-role only, RLS-enabled with no policies). The orchestrator takes
 * an IdCache interface (below) so it stays unit-testable with a fake; the route injects the real,
 * Supabase-backed implementation. Every method is best-effort at the call site — a cache miss or
 * error must never break a booking (the orchestrator falls back to the live calls).
 *
 * NOT `'use client'`: server-side by construction (service client); reached from the booking route
 * and potentially tsx scripts. Never imported by a client component. */
import type { SupabaseClient } from '@supabase/supabase-js';

/** A cached, stable RouteStack destination handle (skips search-destinations). */
export interface CachedDestination {
  rsDestinationId: string;
  rsDestinationType: string | null;
  lat: number;
  long: number;
}

/** The cache surface the orchestrator depends on. Injected as `deps.cache`; a fake in tests. All
 * methods are best-effort — implementations should resolve to null / no-op rather than throw, but
 * the orchestrator also guards each call so a thrown error degrades to "cache miss". */
export interface IdCache {
  loadDestination(destination: string): Promise<CachedDestination | null>;
  saveDestination(destination: string, hit: CachedDestination): Promise<void>;
  /** RouteStack hotel id for one of our hotels (uuid), or null if not resolved yet. */
  loadHotelRsId(hotelId: string): Promise<string | null>;
  saveHotelRsId(hotelId: string, rsHotelId: string, rsHotelName: string | null): Promise<void>;
}

interface DestinationRow {
  rs_destination_id: string;
  rs_destination_type: string | null;
  lat: number;
  long: number;
}

/** Build the real Supabase-backed cache. `client` MUST be the service client (these tables are
 * service-role only). Reads/writes are tolerant: any DB error resolves to null / no-op so the
 * orchestrator's best-effort guard simply proceeds with the live RouteStack calls. */
export function makeSupabaseIdCache(client: SupabaseClient): IdCache {
  return {
    async loadDestination(destination) {
      const { data, error } = await client
        .from('routestack_destinations')
        .select('rs_destination_id, rs_destination_type, lat, long')
        .eq('destination', destination)
        .maybeSingle();
      if (error || !data) return null;
      const row = data as DestinationRow;
      return {
        rsDestinationId: row.rs_destination_id,
        rsDestinationType: row.rs_destination_type,
        lat: row.lat,
        long: row.long,
      };
    },

    async saveDestination(destination, hit) {
      await client.from('routestack_destinations').upsert(
        {
          destination,
          rs_destination_id: hit.rsDestinationId,
          rs_destination_type: hit.rsDestinationType,
          lat: hit.lat,
          long: hit.long,
          resolved_at: new Date().toISOString(),
        },
        { onConflict: 'destination' },
      );
    },

    async loadHotelRsId(hotelId) {
      const { data, error } = await client
        .from('routestack_hotels')
        .select('rs_hotel_id')
        .eq('hotel_id', hotelId)
        .eq('provider', 'routestack')
        .maybeSingle();
      if (error || !data) return null;
      const id = (data as { rs_hotel_id?: unknown }).rs_hotel_id;
      return typeof id === 'string' && id ? id : null;
    },

    async saveHotelRsId(hotelId, rsHotelId, rsHotelName) {
      await client.from('routestack_hotels').upsert(
        {
          hotel_id: hotelId,
          provider: 'routestack',
          rs_hotel_id: rsHotelId,
          rs_hotel_name: rsHotelName,
          resolved_at: new Date().toISOString(),
        },
        { onConflict: 'hotel_id,provider' },
      );
    },
  };
}

// ci-filter-probe: temporary touch to verify the run lane on PR #43 (reverted before merge)
