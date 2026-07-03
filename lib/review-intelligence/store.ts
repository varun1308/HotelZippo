/* Raw review storage (Phase 6 · specs/02 Stage 3 / 08a-6 TC-P5..P7). Inserts scraped +
 * tagged reviews into public.raw_reviews, each carrying its pipeline_run_id.
 *
 * - DEDUP (TC-P5): the raw_reviews_dedup unique index (migration 0020) is NULLS NOT DISTINCT
 *   on (hotel_id, source, reviewer_name, review_date, anon_text_hash), where anon_text_hash is
 *   a GENERATED column = md5(review_text) ONLY when both name and date are null (else '').
 *   Null-key reviews therefore dedup across runs (no more re-inserting undated reviews every
 *   run), while genuinely distinct anonymous+undated reviews are kept apart by their text
 *   hash. We upsert with ignoreDuplicates on that 5-column target (= INSERT … ON CONFLICT DO
 *   NOTHING) so re-running a hotel never duplicates and never errors.
 * - PERMANENT retention (TC-P6): we never delete. Old reviews accumulate as a data asset;
 *   the 12-month filter lives at synthesis (format.ts), not here.
 * - RUN linkage (TC-P7): every inserted row carries the run's pipeline_run_id.
 *
 * Server-side; service client (raw_reviews is service-role only — no client policy). */
// No `import 'server-only'`: part of the worker chain (run by the standalone Node worker via
// tsx). Server-side by construction (service client); never imported by a client component.
import crypto from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { TaggedReview } from './tagging';
import type { RawPayloadItem, ReviewSource } from './apify';

export interface StoreResult {
  /** Rows attempted (after de-duping the in-batch collisions). */
  attempted: number;
}

/** The in-batch dedup key for one review. MUST mirror the raw_reviews_dedup unique index
 * (migration 0020: NULLS NOT DISTINCT + the generated anon_text_hash column) exactly, or
 * in-batch and cross-run dedup semantics diverge and re-runs dupe: nulls collapse to fixed
 * sentinels (≡ NULLS NOT DISTINCT), and the review text's md5 disambiguates ONLY when both
 * reviewer_name and review_date are null (so distinct anonymous+undated reviews are not
 * collapsed into one, but a re-scrape of the same one still dedups). */
export function rawReviewDedupKey(
  r: Pick<TaggedReview, 'source' | 'reviewer_name' | 'review_date' | 'review_text'>,
): string {
  const anonHash =
    r.reviewer_name == null && r.review_date == null
      ? crypto.createHash('md5').update(r.review_text ?? '').digest('hex')
      : '';
  return `${r.source}|${r.reviewer_name ?? ''}|${r.review_date ?? ''}|${anonHash}`;
}

/** Insert tagged reviews for a hotel under a run. ON CONFLICT DO NOTHING via ignoreDuplicates
 * on the 0020 dedup index's 5-column target (anon_text_hash is generated — never inserted). */
export async function storeRawReviews(
  client: SupabaseClient,
  hotelId: string,
  pipelineRunId: string | null,
  reviews: TaggedReview[],
): Promise<StoreResult> {
  if (reviews.length === 0) return { attempted: 0 };

  // De-dupe within the batch first (same hotel could see a guest on both fixture entries)
  // so a single insert call doesn't carry in-payload conflicts.
  const seen = new Set<string>();
  const rows = reviews
    .filter((r) => {
      const key = rawReviewDedupKey(r);
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

  // Conflict target = the 0020 NULLS-NOT-DISTINCT index's columns (incl. the generated
  // anon_text_hash) so PostgREST's ON CONFLICT (…) DO NOTHING infers the right arbiter.
  const { error } = await client
    .from('raw_reviews')
    .upsert(rows, {
      onConflict: 'hotel_id,source,reviewer_name,review_date,anon_text_hash',
      ignoreDuplicates: true,
    });
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

/** A stored raw payload row (what loadRawPayloads returns — enough to re-run a mapper). */
export interface StoredPayload {
  source: ReviewSource;
  external_id: string | null;
  payload: unknown;
}

/** Bank the untouched actor payloads for a hotel under a run, so mappings can be re-run later
 * WITHOUT a paid re-scrape. ON CONFLICT DO NOTHING on (hotel_id, source, external_id) — re-running
 * a hotel never duplicates a payload with a known id (null ids are distinct, so anonymous/idless
 * items aren't the dedup target, mirroring raw_reviews). Caller decides fatal vs best-effort. */
export async function storeRawPayloads(
  client: SupabaseClient,
  hotelId: string,
  pipelineRunId: string,
  payloads: RawPayloadItem[],
): Promise<StoreResult> {
  if (payloads.length === 0) return { attempted: 0 };

  // De-dupe within the batch first so a single insert doesn't carry in-payload conflicts.
  const seen = new Set<string>();
  const rows = payloads
    .filter((p) => {
      const key = `${p.source}|${p.external_id ?? ''}`;
      // Keep all null-id rows (they don't dedup); dedup only on a real external_id.
      if (p.external_id != null && seen.has(key)) return false;
      if (p.external_id != null) seen.add(key);
      return true;
    })
    .map((p) => ({
      hotel_id: hotelId,
      pipeline_run_id: pipelineRunId,
      source: p.source,
      external_id: p.external_id,
      payload: p.payload,
    }));

  const { error } = await client
    .from('raw_review_payloads')
    .upsert(rows, { onConflict: 'hotel_id,source,external_id', ignoreDuplicates: true });
  if (error) throw new Error(`raw_review_payloads insert failed: ${error.message}`);

  return { attempted: rows.length };
}

/** Load stored raw payloads for re-mapping (all hotels, or one). Service client. */
export async function loadRawPayloads(
  client: SupabaseClient,
  hotelId?: string,
): Promise<Array<StoredPayload & { hotel_id: string }>> {
  let query = client.from('raw_review_payloads').select('hotel_id, source, external_id, payload');
  if (hotelId) query = query.eq('hotel_id', hotelId);
  const { data, error } = await query;
  if (error) throw new Error(`raw_review_payloads load failed: ${error.message}`);
  return (data ?? []) as Array<StoredPayload & { hotel_id: string }>;
}
