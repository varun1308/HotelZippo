/* Recommendation Assembly output contract (spec 08b-2, verbatim schema).
 * The assembly prompt emits structured JSON ONLY — this Zod schema is the
 * authoritative shape the route + the Phase 3 cards depend on. It is the UNION of
 * the success object and the two error variants; both must parse (per the
 * prompt-contract-test skill). Do not widen to make a test pass — schema changes
 * originate in Notion → /specs → here. */
import { z } from 'zod';
import { hardFlagSchema } from '@/lib/db/schemas';

const uuid = z.string().uuid();

const categoryPhrases = z.object({
  rooms: z.array(z.string()),
  facilities: z.array(z.string()),
  food: z.array(z.string()),
  location: z.array(z.string()),
});

export const topPickSchema = z.object({
  hotel_id: uuid,
  hotel_name: z.string(),
  verdict: z.string(),
  category_summaries: z.object({
    rooms: z.string(),
    facilities: z.string(),
    food: z.string(),
    location: z.string(),
  }),
  hard_flags: z.array(hardFlagSchema),
  brand_note: z.string().nullable(),
  supporting_phrases: categoryPhrases,
  why_top_pick: z.string(),
});

export const otherPickSchema = z.object({
  hotel_id: uuid,
  hotel_name: z.string(),
  summary: z.string(),
  hard_flags: z.array(hardFlagSchema),
  brand_note: z.string().nullable(),
});

/** The success object (08b-2 Step 4 output schema). */
export const recommendationSuccessSchema = z.object({
  top_pick: topPickSchema,
  other_picks: z.array(otherPickSchema),
  recommendation_notes: z.string().nullable(),
  evaluate_only_applied: z.boolean(),
  alternatives_introduced: z.boolean(),
});
export type RecommendationSuccess = z.infer<typeof recommendationSuccessSchema>;

/** Error variants (08b-2 Step 1 / Step 5). */
export const RECOMMENDATION_ERRORS = ['no_eligible_hotels', 'budget_mismatch'] as const;

export const noEligibleHotelsSchema = z.object({
  error: z.literal('no_eligible_hotels'),
  reason: z.string(),
});

export const budgetMismatchSchema = z.object({
  error: z.literal('budget_mismatch'),
  reason: z.string(),
  available_tiers: z.array(z.string()),
});

export const recommendationErrorSchema = z.discriminatedUnion('error', [
  noEligibleHotelsSchema,
  budgetMismatchSchema,
]);
export type RecommendationError = z.infer<typeof recommendationErrorSchema>;

/** The full assembly output = success OR an error object. */
export const recommendationAssemblySchema = z.union([
  recommendationSuccessSchema,
  recommendationErrorSchema,
]);
export type RecommendationAssembly = z.infer<typeof recommendationAssemblySchema>;

/** Type guard: is this output an error variant? */
export function isRecommendationError(
  out: RecommendationAssembly,
): out is RecommendationError {
  return 'error' in out;
}
