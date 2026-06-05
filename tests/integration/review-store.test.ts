/* Phase 6 · TC-P5..P7 (raw_reviews storage). storeRawReviews against local Supabase:
 * dedup idempotency (re-run inserts no duplicates), permanent retention (old reviews stay),
 * and run linkage (every row carries its pipeline_run_id). Service client (raw_reviews is
 * service-role only). */
import { serviceClient } from './helpers';
import { storeRawReviews, loadHotelReviews } from '@/lib/review-intelligence/store';
import type { TaggedReview } from '@/lib/review-intelligence/tagging';

jest.setTimeout(30_000);
const admin = serviceClient();

let hotelId: string;
let runA: string;
let runB: string;

const reviews: TaggedReview[] = [
  { source: 'tripadvisor', review_date: '2026-05-01', reviewer_name: 'Anita', review_text: 'kids loved the pool', rating: 5, is_family: true, is_indian: true },
  { source: 'tripadvisor', review_date: '2024-01-01', reviewer_name: 'OldGuest', review_text: 'older but kept review', rating: 4, is_family: false, is_indian: false },
  { source: 'google', review_date: '2026-04-01', reviewer_name: 'Tom', review_text: 'comfortable rooms', rating: 4, is_family: false, is_indian: false },
];

beforeAll(async () => {
  const { data: hotel } = await admin
    .from('hotels')
    .insert({ name: 'Store Test Resort', destination: 'Phuket', star_rating: 4, price_tier: 'luxury' })
    .select('id')
    .single();
  hotelId = hotel!.id;
  const { data: a } = await admin.from('pipeline_runs').insert({ scope_type: 'hotel', scope_value: hotelId, status: 'complete' }).select('id').single();
  const { data: b } = await admin.from('pipeline_runs').insert({ scope_type: 'hotel', scope_value: hotelId, status: 'complete' }).select('id').single();
  runA = a!.id;
  runB = b!.id;
});

afterAll(async () => {
  await admin.from('raw_reviews').delete().eq('hotel_id', hotelId);
  await admin.from('pipeline_runs').delete().in('id', [runA, runB]);
  await admin.from('hotels').delete().eq('id', hotelId);
});

describe('storeRawReviews', () => {
  it('TC-P7 run linkage: every inserted row carries the run id', async () => {
    await storeRawReviews(admin, hotelId, runA, reviews);
    const { data } = await admin.from('raw_reviews').select('pipeline_run_id').eq('hotel_id', hotelId);
    expect(data).toHaveLength(3);
    expect(data!.every((r) => r.pipeline_run_id === runA)).toBe(true);
  });

  it('TC-P5 dedup idempotency: re-running inserts no duplicates (on conflict do nothing)', async () => {
    // Re-store the SAME reviews under a different run; the dedup index blocks duplicates.
    await storeRawReviews(admin, hotelId, runB, reviews);
    const { data } = await admin.from('raw_reviews').select('id').eq('hotel_id', hotelId);
    expect(data).toHaveLength(3); // still 3, not 6
  });

  it('TC-P5 only genuinely new reviews are added on a partial re-run', async () => {
    const withNew: TaggedReview[] = [
      ...reviews,
      { source: 'google', review_date: '2026-06-01', reviewer_name: 'NewGuest', review_text: 'brand new review of the stay', rating: 5, is_family: false, is_indian: false },
    ];
    await storeRawReviews(admin, hotelId, runB, withNew);
    const { data } = await admin.from('raw_reviews').select('id').eq('hotel_id', hotelId);
    expect(data).toHaveLength(4); // the 1 new one only
  });

  it('TC-P6 permanent retention: the >12-month-old review is still stored (never deleted)', async () => {
    const all = await loadHotelReviews(admin, hotelId);
    expect(all.some((r) => r.review_date === '2024-01-01')).toBe(true);
    // loadHotelReviews returns most-recent-first.
    expect(all[0].review_date! >= all[all.length - 1].review_date!).toBe(true);
  });
});
