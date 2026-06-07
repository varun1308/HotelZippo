/* Review-scraper mappers (lib/review-intelligence/apify-mapper.ts). Pure: fixture dataset items →
 * RawReviewInput, exercising source hard-coding, date normalisation (ISO / epoch / unparseable),
 * rating normalisation (10-scale → 5-scale), and skip-on-no-signal. jsdom-safe, no network. */
import {
  buildTripadvisorReviewsInput,
  buildGoogleReviewsInput,
  mapTripadvisorReviewItem,
  mapGoogleReviewItem,
} from '@/lib/review-intelligence/apify-mapper';
import taItems from '../fixtures/apify/tripadvisor-reviews.json';
import gItems from '../fixtures/apify/google-reviews.json';

describe('build*ReviewsInput', () => {
  const since = new Date('2025-06-07T00:00:00.000Z');
  it('TripAdvisor input carries the url, cap, and date floor', () => {
    const input = buildTripadvisorReviewsInput('https://ta/x', { maxResults: 600, since });
    expect(input.startUrls).toEqual([{ url: 'https://ta/x' }]);
    expect(input.maxReviews).toBe(600);
    expect(input.lastReviewDate).toBe('2025-06-07');
  });
  it('Google input carries the place id + cap', () => {
    const input = buildGoogleReviewsInput('place-1', { maxResults: 600, since });
    expect(input.placeIds).toEqual(['place-1']);
    expect(input.maxReviews).toBe(600);
  });
});

describe('mapTripadvisorReviewItem', () => {
  it('maps an ISO-date item, hard-codes source=tripadvisor', () => {
    const r = mapTripadvisorReviewItem(taItems[0])!;
    expect(r).toEqual({
      source: 'tripadvisor',
      review_date: '2026-05-18',
      reviewer_name: 'Meera Iyer',
      review_text: expect.stringContaining('kids club'),
      rating: 5,
    });
  });

  it('normalises a 10-scale rating (45 → 4.5) and alt field names', () => {
    const r = mapTripadvisorReviewItem(taItems[1])!;
    expect(r.rating).toBe(4.5);
    expect(r.reviewer_name).toBe('David Lee');
    expect(r.review_date).toBe('2026-04-02');
  });

  it('keeps a row with an unparseable date but drops the date to null; skips no-signal rows', () => {
    // taItems[2] has no text and no rating → no signal → null.
    expect(mapTripadvisorReviewItem(taItems[2])).toBeNull();
    expect(mapTripadvisorReviewItem(null)).toBeNull();
  });
});

describe('mapGoogleReviewItem', () => {
  it('maps an ISO-date item, hard-codes source=google', () => {
    const r = mapGoogleReviewItem(gItems[0])!;
    expect(r.source).toBe('google');
    expect(r.review_date).toBe('2026-03-10');
    expect(r.reviewer_name).toBe('Priya Sharma');
    expect(r.rating).toBe(4);
  });

  it('normalises an epoch-seconds date + string rating', () => {
    const r = mapGoogleReviewItem(gItems[1])!;
    expect(r.review_date).toBe('2025-01-01'); // 1735689600s = 2025-01-01
    expect(r.rating).toBe(5);
    expect(r.review_text).toBe('Great location near the beach.');
  });
});
