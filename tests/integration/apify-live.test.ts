/* OPTIONAL live Apify smoke — validates the real actor I/O against the mappers. OPT-IN: runs ONLY
 * when APIFY_LIVE_SMOKE=1 is set (in addition to the creds below), so it does NOT make slow, PAID,
 * non-deterministic actor runs during a routine `npm run test:integration` (now that .env.local
 * carries working Apify creds). It NEVER runs in CI (CI sets neither the flag nor the creds). Run it
 * deliberately, once, to confirm the live dataset shape matches the fixtures:
 *   APIFY_LIVE_SMOKE=1 npx jest --selectProjects integration tests/integration/apify-live.test.ts
 * if a field differs, adjust the mapper + its unit fixture. This makes a real, paid actor run. */
import { fetchHotels } from '@/lib/curation/fetch';
import { scrapeHotelReviews, type ScrapeTarget } from '@/lib/review-intelligence/apify';

jest.setTimeout(300_000);

// Live, paid actor calls are opt-in — a routine integration run must not trigger them.
const LIVE_SMOKE = process.env.APIFY_LIVE_SMOKE === '1';
const hasSearch =
  LIVE_SMOKE && !!process.env.APIFY_API_TOKEN && !!process.env.APIFY_TRIPADVISOR_SEARCH_ACTOR_ID;
const hasReviews =
  LIVE_SMOKE && !!process.env.APIFY_API_TOKEN && !!process.env.APIFY_TRIPADVISOR_REVIEWS_ACTOR_ID;

const describeSearch = hasSearch ? describe : describe.skip;
const describeReviews = hasReviews ? describe : describe.skip;

describeSearch('Apify live — curation search', () => {
  it('fetches real Phuket candidates via the live actor (source=apify)', async () => {
    const res = await fetchHotels('Phuket');
    expect(res.source).toBe('apify');
    expect(res.hotels.length).toBeGreaterThan(0);
    // Every mapped hotel must satisfy the published-row essentials.
    for (const h of res.hotels) {
      expect(h.name.length).toBeGreaterThan(0);
      expect(h.destination).toBe('Phuket');
    }
  });
});

describeReviews('Apify live — review scrape', () => {
  it('scrapes real TripAdvisor reviews for a known hotel page', async () => {
    // Replace with a real TripAdvisor hotel URL when running locally.
    const target: ScrapeTarget = {
      hotelId: '00000000-0000-0000-0000-000000000001',
      hotelName: 'Live Smoke Hotel',
      tripadvisorUrl: process.env.APIFY_LIVE_TEST_TRIPADVISOR_URL ?? null,
      googlePlaceId: null,
    };
    if (!target.tripadvisorUrl) {
      console.warn('set APIFY_LIVE_TEST_TRIPADVISOR_URL to exercise the live review scrape');
      return;
    }
    const res = await scrapeHotelReviews(target);
    const ta = res.sources.find((s) => s.source === 'tripadvisor');
    expect(ta?.via).toBe('apify');
    expect(res.reviews.every((r) => r.source === 'tripadvisor' || r.source === 'google')).toBe(true);
  });
});
