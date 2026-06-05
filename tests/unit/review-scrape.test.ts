/* Phase 6 · TC-P1..P4 (scraping). scrapeHotelReviews degradation + failure handling, with
 * injected source scrapers so no network/Apify is touched. The mock-fixture path is also
 * exercised against the real fixture file. */
jest.mock('server-only', () => ({}));

import { scrapeHotelReviews, type ScrapeTarget } from '@/lib/review-intelligence/apify';

const target: ScrapeTarget = {
  hotelId: '00000000-0000-0000-0000-000000000001',
  hotelName: 'Mock Test Resort',
  tripadvisorUrl: 'https://tripadvisor.com/x',
  googlePlaceId: 'place-1',
};

describe('scrapeHotelReviews', () => {
  it('TC-P4 fallback chain: with no Apify creds, reads the mock fixture for both sources', async () => {
    const res = await scrapeHotelReviews(target); // default chain → mock (mock-test-resort.json)
    expect(res.reviews.length).toBe(4);
    // Each source filtered to its own rows (one fixture file, both sources).
    const ta = res.reviews.filter((r) => r.source === 'tripadvisor');
    const g = res.reviews.filter((r) => r.source === 'google');
    expect(ta.length).toBe(2);
    expect(g.length).toBe(2);
    expect(res.partial).toBe(false);
  });

  it('TC-P1 zero reviews: a hotel with no fixture yields an empty set (no error)', async () => {
    const res = await scrapeHotelReviews({ ...target, hotelName: 'Nonexistent Hotel XYZ' });
    expect(res.reviews).toHaveLength(0);
    expect(res.partial).toBe(false);
  });

  it('TC-P3 partial failure: one source throws (timeout) → proceed with the other, flag partial', async () => {
    const scrapeSource = async (_t: ScrapeTarget, source: 'tripadvisor' | 'google') => {
      if (source === 'google') throw new Error('actor timeout');
      return [
        { source: 'tripadvisor' as const, review_date: '2026-05-01', reviewer_name: 'A', review_text: 'Nice rooms and pool', rating: 5 },
      ];
    };
    const res = await scrapeHotelReviews(target, { scrapeSource });
    expect(res.partial).toBe(true);
    expect(res.reviews).toHaveLength(1);
    const googleOutcome = res.sources.find((s) => s.source === 'google');
    expect(googleOutcome?.ok).toBe(false);
    expect(googleOutcome?.error).toMatch(/timeout/);
  });

  it('TC-P2 actor timeout on both sources → zero reviews, both outcomes failed, not partial', async () => {
    const scrapeSource = async () => {
      throw new Error('actor timeout');
    };
    const res = await scrapeHotelReviews(target, { scrapeSource });
    expect(res.reviews).toHaveLength(0);
    expect(res.partial).toBe(false); // both failed → not "partial"
    expect(res.sources.every((s) => !s.ok)).toBe(true);
  });
});
