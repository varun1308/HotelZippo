/* Re-map utility (Phase 6 follow-up). Regenerates `raw_reviews` from the banked
 * `raw_review_payloads` WITHOUT a (paid) Apify re-scrape — the payoff of storing raw payloads.
 *
 * Use when a mapper changes (lib/review-intelligence/apify-mapper.ts): run this and every hotel's
 * raw_reviews is rebuilt from the stored actor items with the new mapping. NO Apify import here.
 *
 * Server-side; service client (raw_review_payloads + raw_reviews are service-role only). Part of
 * the worker chain (run via scripts/pipeline/remap.ts under tsx) — no `import 'server-only'`. */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ReviewSource } from './apify';
import { mapTripadvisorReviewItem, mapGoogleReviewItem } from './apify-mapper';
import { tagReviews, type RawReviewInput, type TaggedReview } from './tagging';
import { loadRawPayloads, storeRawReviews, type StoredPayload, type StoreResult } from './store';

/** Re-run the source mappers + tagging over stored payloads → TaggedReview[]. Pure (no DB).
 * Dispatches on source; drops items the (current) mapper skips, exactly like the live scrape. */
export function remapPayloads(
  payloads: Array<Pick<StoredPayload, 'source' | 'payload'>>,
  opts: { indian?: boolean } = {},
): TaggedReview[] {
  const mapped: RawReviewInput[] = [];
  for (const { source, payload } of payloads) {
    const r = source === 'tripadvisor' ? mapTripadvisorReviewItem(payload) : mapGoogleReviewItem(payload);
    if (r) mapped.push(r);
  }
  return tagReviews(mapped, opts);
}

/** Re-map ONE hotel: load its payloads → remap → re-write raw_reviews. `runId` is stamped on the
 * regenerated rows (nullable on raw_reviews; pass null for an out-of-band re-map).
 *
 * `replace` (default false): when true, DELETE the hotel's existing raw_reviews first so a changed
 * mapper truly REGENERATES them (storeRawReviews is ON CONFLICT DO NOTHING, so without a replace it
 * only ADDS genuinely-new rows and won't overwrite existing dedup keys). Deleting here is an
 * explicit founder re-map action, distinct from the worker's never-delete rule. */
export async function remapHotel(
  client: SupabaseClient,
  hotelId: string,
  runId: string | null,
  opts: { indian?: boolean; replace?: boolean } = {},
): Promise<StoreResult> {
  const payloads = await loadRawPayloads(client, hotelId);
  const tagged = remapPayloads(payloads, { indian: opts.indian });

  if (opts.replace) {
    const { error } = await client.from('raw_reviews').delete().eq('hotel_id', hotelId);
    if (error) throw new Error(`raw_reviews delete (remap replace) failed: ${error.message}`);
  }

  // raw_reviews.pipeline_run_id is nullable — a null runId is passed through as SQL NULL.
  return storeRawReviews(client, hotelId, runId, tagged);
}

/** Re-map every hotel that has stored payloads. Returns per-hotel attempted counts. */
export async function remapAll(
  client: SupabaseClient,
  runId: string | null,
  opts: { indian?: boolean; replace?: boolean } = {},
): Promise<Array<{ hotelId: string; attempted: number }>> {
  const payloads = await loadRawPayloads(client);
  const hotelIds = [...new Set(payloads.map((p) => p.hotel_id))];
  const out: Array<{ hotelId: string; attempted: number }> = [];
  for (const hotelId of hotelIds) {
    const { attempted } = await remapHotel(client, hotelId, runId, opts);
    out.push({ hotelId, attempted });
  }
  return out;
}

export type { ReviewSource };
