/* Consumption contract (read side) — specs/02-review-intelligence-pipeline.md (08a-5),
 * also referenced by specs/03b-recommendation-flow.md step 2(a). PHASE 2.
 *
 * Given a destination + the resolved family_profile (budget) and trip_brief
 * (evaluate_only, pre_shortlisted_hotels), return the ≤15 candidate intelligence
 * records that feed the assembly prompt (08b-2).
 *
 * Hard rules (CLAUDE.md 1/4, spec 02):
 *  - Reads `hotel_intelligence` joined to `hotels` ONLY — never `raw_reviews`.
 *  - Excludes `review_count_total = 0` AND `low_confidence = true` (never surfaced).
 *  - `hard_flags` pass through untouched — never filtered here; surfaced downstream.
 *
 * Server-side only (uses the service client at the call site). */
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  DESTINATIONS,
  BUDGET_TIERS,
  PRICE_TIERS,
  hotelIntelligenceSchema,
  hotelSchema,
} from '@/lib/db/schemas';
import { z } from 'zod';

/** How many candidates the assembly prompt receives (spec 02 / 03b). */
export const MAX_CANDIDATES = 15;

/** budget_tier → eligible hotels.price_tier set (spec 02 pre-filter, spec 08b-2 Step 2). */
export const BUDGET_TO_PRICE_TIERS: Record<
  (typeof BUDGET_TIERS)[number],
  ReadonlyArray<(typeof PRICE_TIERS)[number]>
> = {
  value: ['mid-range'],
  comfort: ['mid-range', 'luxury'],
  luxury: ['luxury', 'ultra-luxury'],
};

/** A candidate = an intelligence record joined to its hotel's display metadata. */
export const candidateSchema = hotelIntelligenceSchema.extend({
  hotel: hotelSchema,
});
export type Candidate = z.infer<typeof candidateSchema>;

export interface QueryInput {
  destination: (typeof DESTINATIONS)[number];
  /** trip_briefs.evaluate_only */
  evaluateOnly: boolean;
  /** trip_briefs.pre_shortlisted_hotels — required (and only used) when evaluateOnly. */
  preShortlistedHotels?: string[] | null;
  /** family_profiles.budget_tier — drives the price-tier pre-filter when !evaluateOnly. */
  budgetTier?: (typeof BUDGET_TIERS)[number] | null;
}

/** Normalise a hotel name for shortlist matching: lowercase, collapse whitespace,
 * strip punctuation. Mirrors the "normalised name match" in spec 02. */
export function normaliseName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** True if `family_signal_strength` is `none` across ALL four categories (drop these). */
function allNoneFamilySignal(c: Candidate): boolean {
  const fss = c.family_signal_strength;
  if (!fss) return false; // null signal is not "all none" — keep it (assembly handles it).
  return (
    fss.rooms === 'none' &&
    fss.facilities === 'none' &&
    fss.food === 'none' &&
    fss.location === 'none'
  );
}

/**
 * Run the consumption contract. Returns up to MAX_CANDIDATES candidates, already
 * filtered + (for the non-evaluate path) sorted by review_count_family desc.
 */
export async function queryCandidates(
  supabase: SupabaseClient,
  input: QueryInput,
): Promise<Candidate[]> {
  // Join hotel_intelligence → hotels and filter to the destination at the DB level.
  // Exclude low_confidence + zero-review records in the query (spec 02 step 2).
  const { data, error } = await supabase
    .from('hotel_intelligence')
    .select('*, hotel:hotels!inner(*)')
    .eq('hotel.destination', input.destination)
    .eq('low_confidence', false)
    .gt('review_count_total', 0);
  if (error) throw new Error(`candidate query failed: ${error.message}`);

  // Validate the join shape; a malformed row is a contract violation, fail loud.
  const candidates: Candidate[] = (data ?? []).map((row) => candidateSchema.parse(row));

  // Branch on evaluate_only (spec 02 step 3).
  if (input.evaluateOnly) {
    const shortlist = new Set((input.preShortlistedHotels ?? []).map(normaliseName));
    // Restrict to the pre-shortlist (normalised name match). No budget/family pre-filter,
    // no sort/take — the user named these explicitly; assembly evaluates them as-is.
    return candidates.filter((c) => shortlist.has(normaliseName(c.hotel.name)));
  }

  // evaluate_only = false → apply the pre-filter.
  let filtered = candidates;

  // Budget → price_tier (only when a budget tier is set; absent budget = no price filter).
  if (input.budgetTier) {
    const allowed = new Set(BUDGET_TO_PRICE_TIERS[input.budgetTier]);
    filtered = filtered.filter((c) => c.hotel.price_tier != null && allowed.has(c.hotel.price_tier));
  }

  // Drop hotels with no family signal in any category.
  filtered = filtered.filter((c) => !allNoneFamilySignal(c));

  // Sort by review_count_family desc, take top 15.
  filtered.sort((a, b) => b.review_count_family - a.review_count_family);
  return filtered.slice(0, MAX_CANDIDATES);
}
