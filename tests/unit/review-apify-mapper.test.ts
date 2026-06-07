/* Review-scraper mappers (lib/review-intelligence/apify-mapper.ts). Pure: fixture dataset items →
 * RawReviewInput, exercising source hard-coding, date normalisation (ISO / epoch / unparseable),
 * rating normalisation (10-scale → 5-scale), and skip-on-no-signal. jsdom-safe, no network. */
import {
  buildTripadvisorReviewsInput,
  buildGoogleReviewsInput,
  mapTripadvisorReviewItem,
  mapGoogleReviewItem,
  extractReviewExternalId,
} from '@/lib/review-intelligence/apify-mapper';
import taItems from '../fixtures/apify/tripadvisor-reviews.json';
import gItems from '../fixtures/apify/google-reviews.json';

describe('extractReviewExternalId', () => {
  it('reads the actor item id (TripAdvisor review id)', () => {
    expect(extractReviewExternalId(taItems[0])).toBe('895958274');
  });
  it('falls back to reviewId, returns null when absent / non-object', () => {
    expect(extractReviewExternalId({ reviewId: 'g-42' })).toBe('g-42');
    expect(extractReviewExternalId({ text: 'no id here' })).toBeNull();
    expect(extractReviewExternalId(null)).toBeNull();
  });
});

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
  // taItems[0] is a REAL TripAdvisor reviews-actor row: nested `user` object (name=null,
  // username set), tz-offset publishedDate, integer rating.
  it('maps a real actor row: nested user → username, tz-offset publishedDate → ISO date, source=tripadvisor', () => {
    const r = mapTripadvisorReviewItem(taItems[0])!;
    expect(r).toEqual({
      source: 'tripadvisor',
      review_date: '2023-06-19',
      reviewer_name: '647ANANDP', // user.name is null → falls back to user.username
      review_text: expect.stringContaining('magnificent views'),
      rating: 3,
    });
  });

  it('normalises a 10-scale rating to an integer (45 → 4.5 → 5) and alt flat field names', () => {
    const r = mapTripadvisorReviewItem(taItems[1])!;
    expect(r.rating).toBe(5); // raw_reviews.rating is integer; exact 4.5 stays in the payload
    expect(r.reviewer_name).toBe('David Lee');
    expect(r.review_date).toBe('2023-04-02');
  });

  it('skips a no-signal row (no text, no rating; user.name + username both null)', () => {
    expect(mapTripadvisorReviewItem(taItems[2])).toBeNull();
    expect(mapTripadvisorReviewItem(null)).toBeNull();
  });
});

describe('mapGoogleReviewItem', () => {
  // gItems[0] is derived from a REAL Google-Maps-reviews dataset row (a Spanish review with an
  // English `textTranslated`): verifies field names + value formats against the live actor.
  it('maps a real actor row: prefers textTranslated over the original-language text, source=google', () => {
    const r = mapGoogleReviewItem(gItems[0])!;
    expect(r.source).toBe('google');
    // The original `text` is "Genial" (Spanish); we surface the English translation for synthesis.
    expect(r.review_text).toBe('Brilliant');
    // Real ISO timestamp from `publishedAtDate` — NOT the relative `publishAt` ("51 minutes ago").
    expect(r.review_date).toBe('2026-03-10');
    expect(r.reviewer_name).toBe('TALENTO HUMANO');
    // The live actor carries the star value in `stars`; `rating` is null and must not win.
    expect(r.rating).toBe(4);
  });

  it('falls back to the original text when there is no translation', () => {
    const r = mapGoogleReviewItem(gItems[1])!;
    expect(r.review_text).toBe('Lovely pool and very helpful staff with our toddler.');
    expect(r.review_date).toBe('2026-03-08');
    expect(r.rating).toBe(5);
    expect(r.reviewer_name).toBe('Priya Sharma');
  });

  it('handles epoch-seconds dates + string ratings + flat `user` (alternative actor builds)', () => {
    const r = mapGoogleReviewItem({
      user: 'John Smith',
      review: 'Great location near the beach.',
      publishAt: 1735689600,
      rating: '5',
    })!;
    expect(r.review_date).toBe('2025-01-01'); // 1735689600s = 2025-01-01
    expect(r.rating).toBe(5);
    expect(r.review_text).toBe('Great location near the beach.');
    expect(r.reviewer_name).toBe('John Smith');
  });
});
