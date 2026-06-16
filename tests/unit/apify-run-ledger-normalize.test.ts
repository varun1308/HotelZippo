/* normalizeInput (12h · run ledger reuse guard) — pure key logic, no DB. Two same-query inputs must
 * compare equal regardless of key order or a shifting volatile date floor, so findReusable matches. */
import { normalizeInput } from '@/lib/apify/run-ledger';

describe('normalizeInput', () => {
  it('is key-order independent', () => {
    expect(normalizeInput({ a: 1, b: 2 })).toBe(normalizeInput({ b: 2, a: 1 }));
  });

  it('strips volatile keys (lastReviewDate / since) so a shifting date floor still matches', () => {
    const a = { query: 'Phuket', maxItems: 50, lastReviewDate: '2026-06-16' };
    const b = { query: 'Phuket', maxItems: 50, lastReviewDate: '2025-06-16' };
    expect(normalizeInput(a)).toBe(normalizeInput(b));
  });

  it('distinguishes genuinely different queries', () => {
    expect(normalizeInput({ query: 'Phuket' })).not.toBe(normalizeInput({ query: 'Bali' }));
  });

  it('handles nested objects and arrays', () => {
    const a = { q: 'X', opts: { z: 1, a: [3, 2, 1] } };
    const b = { opts: { a: [3, 2, 1], z: 1 }, q: 'X' };
    expect(normalizeInput(a)).toBe(normalizeInput(b));
  });
});
