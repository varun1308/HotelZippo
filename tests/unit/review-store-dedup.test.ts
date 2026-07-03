/* M19 — raw_reviews dedup on null key parts (spec 02 TC-P5). Two halves, kept in LOCKSTEP:
 *   - cross-run: the 0020 migration's NULLS-NOT-DISTINCT index over (hotel_id, source,
 *     reviewer_name, review_date, anon_text_hash) — exercised by the integration suite;
 *   - in-batch: rawReviewDedupKey + storeRawReviews' pre-filter MUST mirror that index so
 *     re-runs and single batches agree. This suite covers the in-batch half with a fake client. */
import { storeRawReviews, rawReviewDedupKey } from '@/lib/review-intelligence/store';
import type { TaggedReview } from '@/lib/review-intelligence/tagging';
import type { SupabaseClient } from '@supabase/supabase-js';

function review(over: Partial<TaggedReview>): TaggedReview {
  return {
    source: 'tripadvisor',
    review_date: '2026-05-01',
    reviewer_name: 'Raj Mehta',
    review_text: 'kids loved the pool and the breakfast spread',
    rating: 5,
    is_family: true,
    is_indian: false,
    ...over,
  };
}

function fakeClient() {
  const upserts: Array<{ rows: Array<Record<string, unknown>>; options: Record<string, unknown> }> = [];
  const client = {
    from(_t: string) {
      return {
        async upsert(rows: Array<Record<string, unknown>>, options: Record<string, unknown>) {
          upserts.push({ rows, options });
          return { error: null };
        },
      };
    },
  } as unknown as SupabaseClient;
  return { client, upserts };
}

describe('rawReviewDedupKey', () => {
  it('name+date present: text is NOT part of the key (a re-scrape with edited text still dedups)', () => {
    const a = review({ review_text: 'great stay' });
    const b = review({ review_text: 'great stay — edited' });
    expect(rawReviewDedupKey(a)).toBe(rawReviewDedupKey(b));
  });

  it('both name and date null: distinct texts get DISTINCT keys; identical text collides', () => {
    const a = review({ reviewer_name: null, review_date: null, review_text: 'anonymous review one' });
    const b = review({ reviewer_name: null, review_date: null, review_text: 'anonymous review two' });
    const c = review({ reviewer_name: null, review_date: null, review_text: 'anonymous review one' });
    expect(rawReviewDedupKey(a)).not.toBe(rawReviewDedupKey(b));
    expect(rawReviewDedupKey(a)).toBe(rawReviewDedupKey(c));
  });

  it('one null key part: nulls collapse to a sentinel (≡ NULLS NOT DISTINCT), text ignored', () => {
    // name present, date null → same reviewer's undated reviews collide (matches the DB index).
    const a = review({ review_date: null, review_text: 'first' });
    const b = review({ review_date: null, review_text: 'second' });
    expect(rawReviewDedupKey(a)).toBe(rawReviewDedupKey(b));
    // sources still separate.
    expect(rawReviewDedupKey(review({ source: 'google' }))).not.toBe(rawReviewDedupKey(review({})));
  });
});

describe('storeRawReviews in-batch dedup', () => {
  it('keeps genuinely distinct anonymous+undated reviews (no longer collapsed to one)', async () => {
    const { client, upserts } = fakeClient();
    const res = await storeRawReviews(client, 'hotel-1', 'run-1', [
      review({ reviewer_name: null, review_date: null, review_text: 'anonymous review one' }),
      review({ reviewer_name: null, review_date: null, review_text: 'anonymous review two' }),
      review({ reviewer_name: null, review_date: null, review_text: 'anonymous review one' }), // dup of #1
    ]);
    expect(res.attempted).toBe(2);
    expect(upserts[0].rows).toHaveLength(2);
  });

  it('still collapses same (source, name, date) duplicates within a batch', async () => {
    const { client, upserts } = fakeClient();
    const res = await storeRawReviews(client, 'hotel-1', 'run-1', [review({}), review({ rating: 4 })]);
    expect(res.attempted).toBe(1);
    expect(upserts[0].rows).toHaveLength(1);
  });

  it('upserts on the 0020 index columns with ignoreDuplicates (ON CONFLICT DO NOTHING)', async () => {
    const { client, upserts } = fakeClient();
    await storeRawReviews(client, 'hotel-1', null, [review({})]);
    expect(upserts[0].options).toEqual({
      onConflict: 'hotel_id,source,reviewer_name,review_date,anon_text_hash',
      ignoreDuplicates: true,
    });
    // anon_text_hash is GENERATED — it must never be in the insert payload.
    expect(Object.keys(upserts[0].rows[0])).not.toContain('anon_text_hash');
  });
});
