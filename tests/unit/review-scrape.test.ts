/* Phase 6 · TC-P1..P4 (scraping). scrapeHotelReviews degradation + failure handling, with
 * injected source scrapers so no network/Apify is touched. The mock-fixture path is also
 * exercised against the real fixture file. */
jest.mock('server-only', () => ({}));

import { scrapeHotelReviews, type ScrapeTarget } from '@/lib/review-intelligence/apify';

// Pin the env: next/jest loads .env.local, so a dev machine may carry real Apify creds (the
// chain would then attempt a live call) and NODE_ENV=dev. These tests exercise the key-free
// fixture path, which since L27 requires the explicit PIPELINE_ALLOW_MOCK opt-in.
const env = process.env as Record<string, string | undefined>;
const savedEnv = {
  token: env.APIFY_API_TOKEN,
  ta: env.APIFY_TRIPADVISOR_REVIEWS_ACTOR_ID,
  google: env.APIFY_GOOGLE_REVIEWS_ACTOR_ID,
  allow: env.PIPELINE_ALLOW_MOCK,
};
beforeEach(() => {
  delete env.APIFY_API_TOKEN;
  delete env.APIFY_TRIPADVISOR_REVIEWS_ACTOR_ID;
  delete env.APIFY_GOOGLE_REVIEWS_ACTOR_ID;
  env.PIPELINE_ALLOW_MOCK = '1';
});
afterAll(() => {
  for (const [k, v] of [
    ['APIFY_API_TOKEN', savedEnv.token],
    ['APIFY_TRIPADVISOR_REVIEWS_ACTOR_ID', savedEnv.ta],
    ['APIFY_GOOGLE_REVIEWS_ACTOR_ID', savedEnv.google],
    ['PIPELINE_ALLOW_MOCK', savedEnv.allow],
  ] as const) {
    if (v === undefined) delete env[k];
    else env[k] = v;
  }
});

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
    // Raw payloads captured too (one per review for the mock path; payload = the review itself).
    expect(res.payloads.length).toBe(4);
    expect(res.payloads.every((p) => p.external_id === null)).toBe(true);
    expect(res.payloads[0].payload).toEqual(res.reviews.find((r) => r.source === res.payloads[0].source));
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
    // The fake keeps its RawReviewInput[] signature; payloads are synthesised from the reviews.
    expect(res.payloads).toHaveLength(1);
    expect(res.payloads[0]).toMatchObject({ source: 'tripadvisor', external_id: null });
  });

  it('TC-P2 actor timeout on both sources → zero reviews, both outcomes failed, not partial', async () => {
    const scrapeSource = async () => {
      throw new Error('actor timeout');
    };
    const res = await scrapeHotelReviews(target, { scrapeSource });
    expect(res.reviews).toHaveLength(0);
    expect(res.partial).toBe(false); // both failed → not "partial"
    expect(res.sources.every((s) => !s.ok)).toBe(true);
    expect(res.payloads).toHaveLength(0);
  });

  // L27 (TC-P4): mock fixtures are dev/test ONLY. Outside Jest, without the explicit
  // PIPELINE_ALLOW_MOCK=1 opt-in, a missing token must FAIL the sources loudly — never
  // silently store fixture reviews as real data for real hotels.
  describe('mock fallback gating (TC-P4)', () => {
    const savedNodeEnv = env.NODE_ENV;
    afterEach(() => {
      env.NODE_ENV = savedNodeEnv;
    });

    it('outside dev/test without the opt-in: sources fail loudly instead of serving fixtures', async () => {
      env.NODE_ENV = 'production';
      delete env.PIPELINE_ALLOW_MOCK;
      const res = await scrapeHotelReviews(target); // no Apify creds either
      expect(res.reviews).toHaveLength(0);
      expect(res.sources.every((s) => !s.ok)).toBe(true);
      expect(res.sources[0].error).toMatch(/mock fixtures are disabled/i);
    });

    it('PIPELINE_ALLOW_MOCK=1 re-enables the fixture fallback explicitly', async () => {
      env.NODE_ENV = 'production';
      env.PIPELINE_ALLOW_MOCK = '1';
      const res = await scrapeHotelReviews(target);
      expect(res.reviews.length).toBe(4); // mock-test-resort.json served
      expect(res.sources.every((s) => s.ok && s.via === 'mock')).toBe(true);
    });
  });
});
