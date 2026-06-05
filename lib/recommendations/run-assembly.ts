/* Shared two-step recommendation runtime (spec 03b) — used by BOTH the
 * /api/recommendations/assemble route AND the conversation agent's
 * assemble_recommendations tool (so the agent never makes an HTTP self-call).
 *
 * Step (a): consumption query (08a-5) — deterministic candidate set, excludes
 *           low_confidence, never touches raw_reviews.
 * Step (b): assembly (08b-2) — validated against the contract; malformed → throws.
 *
 * Returns the assembly JSON (success or {error} variant), OR a no_eligible_hotels
 * error object when the query yields nothing. Server-side only. */
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { queryCandidates, type QueryInput } from '@/lib/review-intelligence/query';
import {
  assembleRecommendations,
  type AssembleDeps,
} from '@/lib/recommendations/assemble';
import type { RecommendationAssembly } from '@/lib/contracts/recommendation-assembly';

/** Resolved family_profile + trip_brief (the agent/route pass these through). */
export interface RunAssemblyInput {
  family_profile: { budget_tier?: string | null } & Record<string, unknown>;
  trip_brief: {
    destination: QueryInput['destination'];
    evaluate_only?: boolean;
    pre_shortlisted_hotels?: string[] | null;
  } & Record<string, unknown>;
}

export async function runAssembly(
  supabase: SupabaseClient,
  input: RunAssemblyInput,
  deps?: AssembleDeps,
): Promise<RecommendationAssembly> {
  const queryInput: QueryInput = {
    destination: input.trip_brief.destination,
    evaluateOnly: input.trip_brief.evaluate_only ?? false,
    preShortlistedHotels: input.trip_brief.pre_shortlisted_hotels ?? null,
    budgetTier: (input.family_profile?.budget_tier as QueryInput['budgetTier']) ?? null,
  };

  const candidates = await queryCandidates(supabase, queryInput);

  if (candidates.length === 0) {
    return {
      error: 'no_eligible_hotels',
      reason:
        'No hotels with sufficient family review intelligence are available for this destination yet.',
    };
  }

  return assembleRecommendations(
    {
      family_profile: input.family_profile ?? null,
      trip_brief: input.trip_brief,
      candidates,
    },
    deps,
  );
}
