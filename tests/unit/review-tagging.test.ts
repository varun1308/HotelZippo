/* Phase 6 · TC-P8/P9 (tagging). The canonical 08a-2 family keyword list + optional Indian
 * tagging, on a small labelled set. Pure function tests — no DB. */
import { isFamilyReview, isIndianReview, tagReviews, FAMILY_KEYWORDS } from '@/lib/review-intelligence/tagging';

describe('family tagging (M3 — canonical 08a-2 keywords)', () => {
  it('tags reviews mentioning any canonical keyword (case-insensitive, word-boundary)', () => {
    expect(isFamilyReview('Travelled with our KIDS and they loved the pool')).toBe(true);
    expect(isFamilyReview('Our toddler napped while we relaxed')).toBe(true);
    expect(isFamilyReview('Great for a family of five')).toBe(true);
    expect(isFamilyReview('My daughter adored the kids club')).toBe(true);
    expect(isFamilyReview('grandchildren had a blast')).toBe(true);
  });

  it('does NOT tag on substrings or unrelated words', () => {
    // "babylon" must not match "baby"; "children" boundary ok but "schildren" not.
    expect(isFamilyReview('We visited the Babylon exhibit nearby')).toBe(false);
    expect(isFamilyReview('A quiet romantic getaway for two')).toBe(false);
    expect(isFamilyReview('')).toBe(false);
    expect(isFamilyReview(null)).toBe(false);
  });

  it('uses exactly the canonical list (no v1.1 expansion like playground/cot/pram)', () => {
    expect(isFamilyReview('There was a playground and we brought a cot and pram')).toBe(false);
    expect([...FAMILY_KEYWORDS]).toEqual([
      'kids', 'children', 'family', 'toddler', 'baby', 'infant',
      'little ones', 'child', 'daughter', 'son', 'grandchildren',
    ]);
  });
});

describe('Indian tagging (O1 — optional, conservative)', () => {
  it('tags on reviewer-name signal', () => {
    expect(isIndianReview({ reviewerName: 'Priya Sharma', text: 'Lovely stay' })).toBe(true);
  });
  it('tags on text signal (city / food / festival)', () => {
    expect(isIndianReview({ text: 'We flew in from Mumbai for Diwali' })).toBe(true);
    expect(isIndianReview({ text: 'Good vegetarian and paneer options' })).toBe(true);
  });
  it('does not tag neutral reviews', () => {
    expect(isIndianReview({ reviewerName: 'John Smith', text: 'Nice beach' })).toBe(false);
  });
});

describe('tagReviews batch + O1 disable', () => {
  const raw = [
    { source: 'tripadvisor' as const, review_date: '2026-05-01', reviewer_name: 'Anita Patel', review_text: 'Our kids loved it', rating: 5 },
    { source: 'google' as const, review_date: '2026-04-01', reviewer_name: 'Jane Doe', review_text: 'Quiet couples retreat', rating: 4 },
  ];
  it('applies both tags by default', () => {
    const tagged = tagReviews(raw);
    expect(tagged[0]).toMatchObject({ is_family: true, is_indian: true });
    expect(tagged[1]).toMatchObject({ is_family: false, is_indian: false });
  });
  it('disabling O1 forces is_indian=false (canonical no-Indian fallback path)', () => {
    const tagged = tagReviews(raw, { indian: false });
    expect(tagged[0].is_indian).toBe(false);
    expect(tagged[0].is_family).toBe(true); // family tagging unaffected
  });
});
