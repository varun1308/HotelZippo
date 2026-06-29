/* Curation top-N selection (12a). After the Apify TripAdvisor actor returns a LARGE pool (~500) for a
 * destination, we pick the hotels to actually stage:
 *   - PREFER 4 & 5-star hotels, ordered by TripAdvisor Traveller Ranking (best = lowest rank first).
 *   - Take the top N (default 50) from that preferred set.
 *   - If fewer than N four/five-star exist, BACKFILL with the next-best-ranked remaining hotels
 *     (3-star or unrated) until N is reached — we never ship fewer than N when the pool allows.
 *
 * The 100+ review rule is NOT applied here — it stays a publish-time gate (12a Rule #1), so all N
 * selected hotels are staged and the operator publishes the review-eligible ones. Pure + dependency-
 * free so it unit-tests without any DB/network. */
import type { FetchedHotel } from './types';

/** Traveller-Ranking comparator: lower rank = better; null/missing rank sorts LAST (stable). */
function byRanking(a: FetchedHotel, b: FetchedHotel): number {
  const ra = a.tripadvisor_rank ?? Number.POSITIVE_INFINITY;
  const rb = b.tripadvisor_rank ?? Number.POSITIVE_INFINITY;
  return ra - rb;
}

export interface SelectOptions {
  /** How many hotels to keep (default 50). */
  topN?: number;
  /** Star ratings to prefer first (default [4, 5]). */
  preferredStars?: number[];
}

/** Select the hotels to stage from a fetched pool, per the rule above. Returns at most `topN`. */
export function selectTopHotels(pool: FetchedHotel[], opts: SelectOptions = {}): FetchedHotel[] {
  const topN = opts.topN ?? 50;
  const preferred = new Set(opts.preferredStars ?? [4, 5]);

  // De-dup by name (the actor can return the same property twice); keep the better-ranked copy.
  const byName = new Map<string, FetchedHotel>();
  for (const h of [...pool].sort(byRanking)) {
    if (!byName.has(h.name)) byName.set(h.name, h);
  }
  const unique = [...byName.values()];

  const preferredHotels = unique
    .filter((h) => h.star_rating != null && preferred.has(h.star_rating))
    .sort(byRanking);

  if (preferredHotels.length >= topN) return preferredHotels.slice(0, topN);

  // Backfill: the rest (not already chosen), best-ranked first, until we reach topN.
  const chosen = new Set(preferredHotels.map((h) => h.name));
  const backfill = unique.filter((h) => !chosen.has(h.name)).sort(byRanking);
  return [...preferredHotels, ...backfill].slice(0, topN);
}
