/* Shared two-step recommendation runtime (spec 03b) — used by BOTH the
 * /api/recommendations/assemble route AND the conversation agent's
 * assemble_recommendations tool (so the agent never makes an HTTP self-call).
 *
 * Step (a): consumption query (08a-5) — deterministic candidate set, excludes
 *           low_confidence, never touches raw_reviews.
 * Step (b): assembly (08b-2) — validated against the contract; malformed → throws.
 *
 * Returns the assembly JSON (success or {error} variant). When there's no review intelligence for the
 * destination, it falls back to PREVIEW recommendations (12i-B) if `source='preview'` hotels exist —
 * so a preview-only destination (e.g. Bali) can still surface bookable cards — else `no_eligible_hotels`.
 * Server-side only. */
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { queryCandidates, type QueryInput } from '@/lib/review-intelligence/query';
import {
  assembleRecommendations,
  type AssembleDeps,
} from '@/lib/recommendations/assemble';
import type { RecommendationAssembly } from '@/lib/contracts/recommendation-assembly';
import {
  previewRecommendations,
  type PreviewRecommendations,
} from '@/lib/preview/preview-recommendations';
import { ensurePreviewSeed, runtimeSeedEnabled } from '@/lib/preview/runtime-seed';
import type { BookingDeps } from '@/lib/booking/routestack';

/** The "still seeding" variant (12i-C): a runtime seed is in progress, no cards yet this turn. */
export interface PreviewSeeding {
  result: 'preview_seeding';
  destination: string;
  state: 'in_progress' | 'failed';
}

/** runAssembly returns a normal assembly result, the preview variant (12i-B), or the seeding variant. */
export type AssemblyOrPreview = RecommendationAssembly | PreviewRecommendations | PreviewSeeding;

/** Optional runtime-seed seam (12i-C). Absent → no on-the-fly seeding (CI/tests stay key-free). */
export interface RuntimeSeedDeps {
  bookingDeps: BookingDeps;
}

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
  seedDeps?: RuntimeSeedDeps,
): Promise<AssemblyOrPreview> {
  const queryInput: QueryInput = {
    destination: input.trip_brief.destination,
    evaluateOnly: input.trip_brief.evaluate_only ?? false,
    preShortlistedHotels: input.trip_brief.pre_shortlisted_hotels ?? null,
    budgetTier: (input.family_profile?.budget_tier as QueryInput['budgetTier']) ?? null,
  };

  const candidates = await queryCandidates(supabase, queryInput);

  if (candidates.length === 0) {
    // No review intelligence for this destination. Before giving up, check for PREVIEW hotels (12i-B):
    // a preview-only destination should still surface bookable cards (no LLM, no fabricated reviews).
    let preview = await previewRecommendations(supabase, input.trip_brief.destination, {
      budgetTier: queryInput.budgetTier,
    });
    if (preview.result === 'preview_recommendations') return preview;

    // 12i-C: still nothing — seed on the fly (once, race-safe, fast) if enabled, then re-query so the
    // SAME turn can surface cards. Gated by PREVIEW_RUNTIME_SEED + an injected RouteStack dep.
    if (seedDeps && runtimeSeedEnabled()) {
      const seed = await ensurePreviewSeed(supabase, input.trip_brief.destination, seedDeps.bookingDeps);
      if (seed.state === 'seeded' || seed.state === 'already_seeded') {
        preview = await previewRecommendations(supabase, input.trip_brief.destination, { budgetTier: queryInput.budgetTier });
        if (preview.result === 'preview_recommendations') return preview;
      }
      // A seed is mid-flight (another request) or failed → tell the agent so it can say "gathering…".
      if (seed.state === 'in_progress') return { result: 'preview_seeding', destination: input.trip_brief.destination, state: 'in_progress' };
      if (seed.state === 'failed') return { result: 'preview_seeding', destination: input.trip_brief.destination, state: 'failed' };
      // 'seeded'/'already_seeded' but the preview query still found nothing (e.g. budget filter excluded
      // all) or 'empty' → fall through to no_eligible_hotels.
    }
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
