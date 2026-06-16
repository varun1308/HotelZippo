/* Preview seeding — step 2: RouteStack VERIFIES Claude's proposed names + stages survivors (12i).
 *
 * The honest contract (12i): RouteStack is GROUND TRUTH. We resolve the destination ONCE (the fixed,
 * Google-anchored resolution — see 10c) and run search-hotels ONCE, then keep only proposed names
 * that actually appear in that real inventory. Survivors are upserted into `hotels` as
 * `source='preview'` with NO hotel_intelligence row — surfaced honestly as a "preview" tier.
 *
 * One search per destination (NOT one rates call per hotel): search-hotels already returns the
 * destination's named inventory + star ratings, which is all verification needs. Best-effort /
 * warm-fail: a RouteStack failure drops that destination's verification, never crashes the seed.
 *
 * No `import 'server-only'`: server-side by construction (service client + RouteStack creds), reached
 * by the admin route + a tsx maintenance path (the guard would break the latter). */
import type { SupabaseClient } from '@supabase/supabase-js';
import { searchHotelsInDestination, listSearchHotels, type BookingDeps } from '@/lib/booking/routestack';
import type { ProposedHotel } from './propose';

/** Default party/dates for a verification search — sensible near-future window (availability is
 * date-volatile, so we just need a window that returns inventory). Dates are injectable for tests. */
export interface VerifyOptions {
  dates?: { checkIn: string; checkOut: string };
  party?: { adults: number; children: number; childAges: number[]; rooms: number };
}

export interface VerifiedHotel {
  name: string; // the RouteStack-confirmed name (canonical)
  proposedName: string; // what Claude proposed (may differ slightly)
  rsHotelId: string;
  starRating: number | null;
  priceTier: 'mid-range' | 'luxury' | 'ultra-luxury';
}

export interface VerifyResult {
  proposed: number;
  verified: VerifiedHotel[];
  staged: number;
  /** Proposed names RouteStack did NOT return (dropped — name mismatch or not in inventory). */
  dropped: string[];
}

/** Conservative star→price_tier (preview hotels carry NO review-derived luxury claim; this is a
 * neutral placeholder the operator can correct). 5★ → luxury; else mid-range. Never ultra-luxury
 * automatically — that's an editorial call, not a star count. */
function tierFromStar(star: number | null | undefined): 'mid-range' | 'luxury' | 'ultra-luxury' {
  return star === 5 ? 'luxury' : 'mid-range';
}

/** Exact-then-contains name match (mirrors lib/booking matchHotelByName). Returns the matching
 * RouteStack hotel or null. Near-misses are intentionally DROPPED (safe — better than mis-seeding). */
function matchByName(
  want: string,
  inventory: Array<{ id: string; name: string; starRating?: number }>,
): { id: string; name: string; starRating?: number } | null {
  const w = want.trim().toLowerCase();
  let contains: (typeof inventory)[number] | null = null;
  for (const h of inventory) {
    const lc = h.name.trim().toLowerCase();
    if (!h.id || !lc) continue;
    if (lc === w) return h;
    if (!contains && (lc.includes(w) || w.includes(lc))) contains = h;
  }
  return contains;
}

/** Verify proposed hotels against RouteStack and upsert survivors as source='preview'. */
export async function verifyAndStage(
  client: SupabaseClient,
  destination: string,
  proposals: ProposedHotel[],
  deps: BookingDeps,
  opts: VerifyOptions = {},
): Promise<VerifyResult> {
  const party = opts.party ?? { adults: 2, children: 0, childAges: [], rooms: 1 };
  const dates = opts.dates ?? defaultDates();

  // ONE resolve + search for the whole destination.
  const { searchResult } = await searchHotelsInDestination(destination, party, dates, deps);
  const inventory = listSearchHotels(searchResult).filter((h) => h.id && h.name);

  const verified: VerifiedHotel[] = [];
  const dropped: string[] = [];
  const seenRsId = new Set<string>();
  for (const p of proposals) {
    const hit = matchByName(p.name, inventory);
    if (!hit || seenRsId.has(hit.id)) {
      dropped.push(p.name);
      continue;
    }
    seenRsId.add(hit.id);
    verified.push({
      name: hit.name,
      proposedName: p.name,
      rsHotelId: hit.id,
      starRating: hit.starRating ?? null,
      priceTier: tierFromStar(hit.starRating),
    });
  }

  // Upsert survivors as preview hotels (on the hotels (name,destination) unique key). NO
  // hotel_intelligence row is written — preview is honestly review-intelligence-free.
  let staged = 0;
  if (verified.length > 0) {
    const rows = verified.map((v) => ({
      name: v.name,
      destination,
      star_rating: v.starRating === 3 || v.starRating === 4 || v.starRating === 5 ? v.starRating : null,
      price_tier: v.priceTier,
      source: 'preview' as const,
    }));
    const { error, count } = await client
      .from('hotels')
      .upsert(rows, { onConflict: 'name,destination', count: 'exact' });
    if (error) throw new Error(`preview upsert failed: ${error.message}`);
    staged = count ?? rows.length;
  }

  return { proposed: proposals.length, verified, staged, dropped };
}

/** +30 / +33 day window (deterministic-ish; tests inject explicit dates). */
function defaultDates(): { checkIn: string; checkOut: string } {
  const base = Date.now();
  const d = (n: number) => new Date(base + n * 86400000).toISOString().slice(0, 10);
  return { checkIn: d(30), checkOut: d(33) };
}
