/* Re-map core (lib/review-intelligence/remap.ts → remapPayloads). Pure, no DB, no Apify: stored
 * payloads → re-run mappers + tagging → TaggedReview[]. This is the "change a mapper, regenerate
 * raw_reviews WITHOUT re-scraping" proof at the unit level. */
import { remapPayloads } from '@/lib/review-intelligence/remap';
import { mapTripadvisorReviewItem, mapGoogleReviewItem } from '@/lib/review-intelligence/apify-mapper';
import taItems from '../fixtures/apify/tripadvisor-reviews.json';
import gItems from '../fixtures/apify/google-reviews.json';

describe('remapPayloads', () => {
  it('reproduces what the live scrape would map+tag, dispatching on source', () => {
    const payloads = [
      ...taItems.map((payload) => ({ source: 'tripadvisor' as const, payload })),
      ...gItems.map((payload) => ({ source: 'google' as const, payload })),
    ];
    const out = remapPayloads(payloads, { indian: true });

    // Same count as mapping each source directly + dropping nulls (the no-signal TA row).
    const expectedTa = taItems.map(mapTripadvisorReviewItem).filter(Boolean).length;
    const expectedG = gItems.map(mapGoogleReviewItem).filter(Boolean).length;
    expect(out).toHaveLength(expectedTa + expectedG);

    // Tagging ran: the TA row mentioning the reviewer from Singapore + the family/diet text is
    // surfaced; each remapped row carries is_family / is_indian booleans.
    expect(out.every((r) => typeof r.is_family === 'boolean' && typeof r.is_indian === 'boolean')).toBe(true);
    // Sources preserved (hard-coded by the mappers).
    expect(out.some((r) => r.source === 'tripadvisor')).toBe(true);
    expect(out.some((r) => r.source === 'google')).toBe(true);
  });

  it('a no-signal payload is retained for re-map (skipped now, rescuable by a future mapper)', () => {
    // taItems[2] is a no-signal row the current mapper skips — but it is still a stored payload,
    // so remap simply drops it today; a future mapper that extracts signal would pick it up.
    const out = remapPayloads([{ source: 'tripadvisor', payload: taItems[2] }]);
    expect(out).toHaveLength(0);
    // The payload itself is intact (the caller still holds it) — that's the re-scrape-free guarantee.
    expect(taItems[2]).toBeDefined();
  });

  it('honours the indian-tagging opt-out', () => {
    const out = remapPayloads([{ source: 'tripadvisor', payload: taItems[0] }], { indian: false });
    expect(out).toHaveLength(1);
    expect(out[0].is_indian).toBe(false);
  });

  // L25: mock/test-fake scrapes bank the RawReviewInput ITSELF (snake_case fields the live
  // mappers don't read). Remap must pass those through — not produce null/degraded rows that a
  // --replace would then write over the hotel's real raw_reviews.
  it('passes a mock-shaped (RawReviewInput) payload through unchanged', () => {
    const mockPayload = {
      source: 'tripadvisor' as const,
      review_date: '2026-05-01',
      reviewer_name: 'Raj Mehta',
      review_text: 'kids loved the pool, great veg options',
      rating: 5,
    };
    const out = remapPayloads([{ source: 'tripadvisor', payload: mockPayload }], { indian: true });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject(mockPayload); // fields intact, NOT re-read via live field names
    expect(typeof out[0].is_family).toBe('boolean'); // tagging still ran
  });

  it('a mock-shaped payload carrying only a rating is not half-read by the live mapper', () => {
    // Regression: mapTripadvisorReviewItem reads row.rating, so before the shape check this row
    // remapped into a degraded {text:null,date:null,name:null,rating} row instead of itself.
    const mockPayload = {
      source: 'tripadvisor' as const,
      review_date: '2026-04-02',
      reviewer_name: null,
      review_text: null,
      rating: 4,
    };
    const out = remapPayloads([{ source: 'tripadvisor', payload: mockPayload }]);
    expect(out).toHaveLength(1);
    expect(out[0].review_date).toBe('2026-04-02'); // preserved, not nulled
  });

  it('drops a mock-shaped payload whose embedded source disagrees with the stored source', () => {
    const mockPayload = { source: 'google' as const, review_date: null, reviewer_name: null, review_text: 'x'.repeat(30), rating: 4 };
    const out = remapPayloads([{ source: 'tripadvisor', payload: mockPayload }]);
    expect(out).toHaveLength(0);
  });
});
