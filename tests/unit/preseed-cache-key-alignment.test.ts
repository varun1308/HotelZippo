/* M18(b) — dev preseed ↔ live path cache-key alignment. CURATION_USE_CACHE replay only works if
 * scripts/dev/preseed-route-cache.ts banks under the EXACT (label, scope, input) keys the live
 * paths compute. Both sides now share ONE builder + env default per input (buildLiveSearchInput /
 * reviewsMaxResults); this suite locks that contract so a divergent default (the old 10-vs-500 /
 * 30-vs-600 guaranteed-miss bug) can't silently come back. */
import { cacheKeyFor } from '@/lib/dev/actor-cache';
import { buildSearchInput, buildLiveSearchInput, searchPoolSize } from '@/lib/curation/apify-mapper';
import {
  buildTripadvisorReviewsInput,
  buildGoogleReviewsInput,
  reviewsMaxResults,
} from '@/lib/review-intelligence/apify-mapper';

const savedEnv = { ...process.env };
afterEach(() => {
  process.env = { ...savedEnv };
});

describe('curation search input', () => {
  it('preseed input === live input (fetch.ts / run-start build with the POOL size, default 500)', () => {
    delete process.env.APIFY_SEARCH_POOL_SIZE;
    // The live paths call buildLiveSearchInput; a correct preseed banks the same thing.
    expect(searchPoolSize()).toBe(500);
    expect(buildLiveSearchInput('Phuket')).toEqual(buildSearchInput('Phuket', 500));
    expect(cacheKeyFor('apify', 'maxcopell~tripadvisor', buildLiveSearchInput('Phuket'))).toBe(
      cacheKeyFor('apify', 'maxcopell~tripadvisor', buildSearchInput('Phuket', 500)),
    );
  });

  it('honours APIFY_SEARCH_POOL_SIZE on BOTH sides via the shared builder', () => {
    process.env.APIFY_SEARCH_POOL_SIZE = '123';
    expect(searchPoolSize()).toBe(123);
    expect(buildLiveSearchInput('Bali')).toEqual(buildSearchInput('Bali', 123));
  });

  it('a different cap produces a DIFFERENT key (why the old preseed default of 10/50 always missed)', () => {
    delete process.env.APIFY_SEARCH_POOL_SIZE;
    expect(cacheKeyFor('apify', 'maxcopell~tripadvisor', buildSearchInput('Phuket', 50))).not.toBe(
      cacheKeyFor('apify', 'maxcopell~tripadvisor', buildLiveSearchInput('Phuket')),
    );
  });
});

describe('reviews inputs', () => {
  const URL = 'https://www.tripadvisor.com/Hotel_Review-x.html';

  it('shares the live default (600) so preseed keys match the scraper', () => {
    delete process.env.APIFY_REVIEWS_MAX_RESULTS;
    expect(reviewsMaxResults()).toBe(600);
    const live = buildTripadvisorReviewsInput(URL, { maxResults: reviewsMaxResults(), since: new Date('2025-07-01') });
    const preseed = buildTripadvisorReviewsInput(URL, { maxResults: 600, since: new Date('2025-01-01') });
    // `since`/`lastReviewDate` is volatile — stripped from the key — so differing floors still HIT.
    expect(cacheKeyFor('apify', 'maxcopell~tripadvisor-reviews', live)).toBe(
      cacheKeyFor('apify', 'maxcopell~tripadvisor-reviews', preseed),
    );
  });

  it('honours APIFY_REVIEWS_MAX_RESULTS and aligns the Google input too', () => {
    process.env.APIFY_REVIEWS_MAX_RESULTS = '250';
    expect(reviewsMaxResults()).toBe(250);
    const live = buildGoogleReviewsInput('place-1', { maxResults: reviewsMaxResults(), since: new Date('2025-07-01') });
    const preseed = buildGoogleReviewsInput('place-1', { maxResults: 250, since: new Date('2025-06-01') });
    expect(cacheKeyFor('apify', 'compass~google-maps-reviews-scraper', live)).toBe(
      cacheKeyFor('apify', 'compass~google-maps-reviews-scraper', preseed),
    );
  });

  it('the old preseed default (30) produced a different key than the live path (the M18 miss)', () => {
    delete process.env.APIFY_REVIEWS_MAX_RESULTS;
    const old = buildTripadvisorReviewsInput(URL, { maxResults: 30, since: new Date('2025-07-01') });
    const live = buildTripadvisorReviewsInput(URL, { maxResults: reviewsMaxResults(), since: new Date('2025-07-01') });
    expect(cacheKeyFor('apify', 'maxcopell~tripadvisor-reviews', old)).not.toBe(
      cacheKeyFor('apify', 'maxcopell~tripadvisor-reviews', live),
    );
  });
});
