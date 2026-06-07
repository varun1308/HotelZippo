/* Phase 6 follow-up · re-map end-to-end (raw_review_payloads → raw_reviews, NO Apify).
 * Seeds raw_review_payloads with real-shaped actor items, then remapHotel rebuilds raw_reviews
 * from them — the "change a mapper, regenerate without re-scraping" guarantee. Service client. */
import { serviceClient } from './helpers';
import { storeRawPayloads } from '@/lib/review-intelligence/store';
import { remapHotel } from '@/lib/review-intelligence/remap';
import type { RawPayloadItem } from '@/lib/review-intelligence/apify';
import taItems from '../../tests/fixtures/apify/tripadvisor-reviews.json';
import gItems from '../../tests/fixtures/apify/google-reviews.json';

jest.setTimeout(30_000);
const admin = serviceClient();

let hotelId: string;

beforeAll(async () => {
  const { data } = await admin
    .from('hotels')
    .insert({ name: 'Remap Hotel', destination: 'Bali', star_rating: 5, price_tier: 'luxury' })
    .select('id')
    .single();
  hotelId = data!.id;
});

afterAll(async () => {
  await admin.from('raw_reviews').delete().eq('hotel_id', hotelId);
  await admin.from('raw_review_payloads').delete().eq('hotel_id', hotelId);
  await admin.from('hotels').delete().eq('id', hotelId);
});

function payloadsFromFixtures(): RawPayloadItem[] {
  return [
    ...taItems.map((payload, i) => ({ source: 'tripadvisor' as const, external_id: `ta-${i}`, payload })),
    ...gItems.map((payload, i) => ({ source: 'google' as const, external_id: `g-${i}`, payload })),
  ];
}

describe('re-map raw_reviews from stored payloads (no Apify)', () => {
  it('persists payloads then regenerates raw_reviews via remapHotel', async () => {
    // 1. Bank raw payloads (as the worker would on scrape).
    const { attempted } = await storeRawPayloads(admin, hotelId, null as unknown as string, payloadsFromFixtures());
    expect(attempted).toBeGreaterThan(0);

    // 2. Re-map: load payloads → re-run mappers + tagging → write raw_reviews. No scrape.
    const res = await remapHotel(admin, hotelId, null, { replace: true });
    expect(res.attempted).toBeGreaterThan(0);

    // 3. raw_reviews now exist, regenerated purely from the stored payloads.
    const { data: rr } = await admin
      .from('raw_reviews')
      .select('source, reviewer_name, rating, is_family, is_indian')
      .eq('hotel_id', hotelId);
    expect((rr ?? []).length).toBe(res.attempted);
    expect((rr ?? []).some((r) => r.source === 'tripadvisor')).toBe(true);
    expect((rr ?? []).some((r) => r.source === 'google')).toBe(true);
    // The real TA row's reviewer came from the nested user object (username fallback).
    expect((rr ?? []).some((r) => r.reviewer_name === '647ANANDP')).toBe(true);
  });

  it('replace=true regenerates rather than appends (idempotent re-run)', async () => {
    const before = await admin.from('raw_reviews').select('id').eq('hotel_id', hotelId);
    // Re-run the same remap with replace → same row count, not doubled.
    await remapHotel(admin, hotelId, null, { replace: true });
    const after = await admin.from('raw_reviews').select('id').eq('hotel_id', hotelId);
    expect((after.data ?? []).length).toBe((before.data ?? []).length);
  });

  it('dedup: re-storing the same payloads (same external_id) does not duplicate', async () => {
    const countBefore = (await admin.from('raw_review_payloads').select('id').eq('hotel_id', hotelId)).data?.length ?? 0;
    await storeRawPayloads(admin, hotelId, null as unknown as string, payloadsFromFixtures());
    const countAfter = (await admin.from('raw_review_payloads').select('id').eq('hotel_id', hotelId)).data?.length ?? 0;
    expect(countAfter).toBe(countBefore);
  });
});
