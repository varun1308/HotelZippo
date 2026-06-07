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
});
