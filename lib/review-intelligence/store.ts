/* Raw review storage (Phase 6 · specs/02 Stage 3 / 08a-6 TC-P5..P7). Inserts scraped +
 * tagged reviews into public.raw_reviews, each carrying its pipeline_run_id.
 *
 * - DEDUP (TC-P5): the raw_reviews_dedup unique index on (hotel_id, source, reviewer_name,
 *   review_date) means re-runs insert only genuinely new rows. We use upsert with
 *   ignoreDuplicates (= INSERT … ON CONFLICT DO NOTHING) so re-running a hotel never
 *   duplicates and never errors.
 * - PERMANENT retention (TC-P6): we never delete. Old reviews accumulate as a data asset;
 *   the 12-month filter lives at synthesis (format.ts), not here.
 * - RUN linkage (TC-P7): every inserted row carries the run's pipeline_run_id.
 *
 * Server-side; service client (raw_reviews is service-role only — no client policy). */
// No `import 'server-only'`: part of the worker chain (run by the standalone Node worker via
// tsx). Server-side by construction (service client); never imported by a client component.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { TaggedReview } from './tagging';

export interface StoreResult {
  /** Rows attempted (after de-duping the in-batch collisions). */
  attempted: number;
}

/** Insert tagged reviews for a hotel under a run. ON CONFLICT DO NOTHING via ignoreDuplicates.
 * Rows missing the dedup key parts (reviewer_name / review_date) still insert — the unique
 * index treats NULLs as distinct, which is acceptable (anonymous/undated reviews aren't the
 * dedup target). */
export async function storeRawReviews(
  client: SupabaseClient,
  hotelId: string,
  pipelineRunId: string,
  reviews: TaggedReview[],
): Promise<StoreResult> {
  if (reviews.length === 0) return { attempted: 0 };

  // De-dupe within the batch first (same hotel could see a guest on both fixture entries)
  // so a single insert call doesn't carry in-payload conflicts.
  const seen = new Set<string>();
  const rows = reviews
    .filter((r) => {
      const key = `${r.source}|${r.reviewer_name ?? ''}|${r.review_date ?? ''}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((r) => ({
      hotel_id: hotelId,
      pipeline_run_id: pipelineRunId,
      source: r.source,
      review_date: r.review_date,
      reviewer_name: r.reviewer_name,
      review_text: r.review_text,
      rating: r.rating,
      is_family: r.is_family,
      is_indian: r.is_indian,
    }));

  const { error } = await client
    .from('raw_reviews')
    .upsert(rows, { onConflict: 'hotel_id,source,reviewer_name,review_date', ignoreDuplicates: true });
  if (error) throw new Error(`raw_reviews insert failed: ${error.message}`);

  return { attempted: rows.length };
}

/** Load all stored reviews for a hotel (for synthesis input — the 12-month filter is applied
 * downstream in format.ts, NOT here, so retention stays permanent). Returns most-recent-first. */
export async function loadHotelReviews(
  client: SupabaseClient,
  hotelId: string,
): Promise<TaggedReview[]> {
  const { data, error } = await client
    .from('raw_reviews')
    .select('source, review_date, reviewer_name, review_text, rating, is_family, is_indian')
    .eq('hotel_id', hotelId)
    .order('review_date', { ascending: false });
  if (error) throw new Error(`raw_reviews load failed: ${error.message}`);
  return (data ?? []) as TaggedReview[];
}
