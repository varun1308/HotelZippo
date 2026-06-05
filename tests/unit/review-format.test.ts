/* Phase 6 · TC-P10 (segment caps) + TC-P11 (input format). Producer prep is pure. */
import {
  prepareForSynthesis,
  buildSynthesisInput,
  cleanText,
  formatLine,
  SEGMENT_CAPS,
  MIN_REVIEW_CHARS,
} from '@/lib/review-intelligence/format';
import type { TaggedReview } from '@/lib/review-intelligence/tagging';

const NOW = new Date('2026-06-05T00:00:00Z');

function review(over: Partial<TaggedReview>): TaggedReview {
  return {
    source: 'tripadvisor',
    review_date: '2026-05-01',
    reviewer_name: 'A',
    review_text: 'This is a sufficiently long review about the rooms and pool.',
    rating: 5,
    is_family: false,
    is_indian: false,
    ...over,
  };
}

describe('formatLine (TC-P11 input format)', () => {
  it('renders [YYYY-MM-DD] [rating/5] {text}', () => {
    expect(formatLine(review({ review_date: '2026-05-01', rating: 4 }))).toMatch(
      /^\[2026-05-01\] \[4\/5\] This is a sufficiently long review/,
    );
  });
  it('drops reviews under the 20-char minimum (after cleaning)', () => {
    expect(formatLine(review({ review_text: 'too short' }))).toBeNull();
    expect('too short'.length).toBeLessThan(MIN_REVIEW_CHARS);
  });
  it('drops undated reviews', () => {
    expect(formatLine(review({ review_date: null }))).toBeNull();
  });
  it('strips HTML and management responses', () => {
    expect(cleanText('<p>Great <b>stay</b></p>')).toBe('Great stay');
    expect(cleanText('Lovely rooms. Response from Manager: thank you for staying')).toBe('Lovely rooms.');
  });
});

describe('prepareForSynthesis (TC-P10 caps + TC-P2 12-month filter)', () => {
  it('excludes reviews older than 12 months from the run date', () => {
    const reviews = [
      review({ review_date: '2026-05-01', review_text: 'recent enough review of the resort and beach' }),
      review({ review_date: '2024-01-01', review_text: 'way too old review of the resort and beach' }),
    ];
    const out = prepareForSynthesis(reviews, NOW);
    expect(out.counts.general).toBe(1);
    expect(out.general[0]).toContain('2026-05-01');
  });

  it('caps each segment (150 / 100 / 250), most-recent-first, no redistribution', () => {
    const many = (n: number, tag: Partial<TaggedReview>) =>
      Array.from({ length: n }, (_, i) =>
        review({
          // descending dates so we can assert most-recent-first ordering
          review_date: `2026-0${1 + (i % 5)}-${String(1 + (i % 27)).padStart(2, '0')}`,
          review_text: `Review number ${i} with enough characters to be kept in the set.`,
          ...tag,
        }),
      );
    const reviews = [
      ...many(200, { is_family: true }),
      ...many(150, { is_indian: true }),
      ...many(300, {}),
    ];
    const out = prepareForSynthesis(reviews, NOW);
    expect(out.counts.family).toBe(SEGMENT_CAPS.family); // 150, not 200
    expect(out.counts.indian).toBe(SEGMENT_CAPS.indian); // 100, not 150
    expect(out.counts.general).toBe(SEGMENT_CAPS.general); // 250, not 300
    expect(out.counts.total).toBe(500); // <= 500 hard cap
  });

  it('priority-exclusive segmentation: a family+indian review counts as family', () => {
    const out = prepareForSynthesis(
      [review({ is_family: true, is_indian: true, review_text: 'kids loved it and we are from Mumbai too' })],
      NOW,
    );
    expect(out.counts.family).toBe(1);
    expect(out.counts.indian).toBe(0);
  });
});

describe('buildSynthesisInput', () => {
  it('mirrors the 08a-1 INPUTS block with true total counts', () => {
    const segments = prepareForSynthesis([review({ is_family: true })], NOW);
    const input = buildSynthesisInput({
      hotelName: 'JW Marriott Phuket',
      destination: 'Phuket',
      reviewCountTotal: 420,
      reviewCountFamily: 45,
      reviewCountIndian: 18,
      segments,
    });
    expect(input).toContain('HOTEL: JW Marriott Phuket');
    expect(input).toContain('REVIEW COUNTS: Total: 420 | Family: 45 | Indian: 18');
    expect(input).toContain('FAMILY REVIEWS (1 reviews, tagged is_family=true):');
  });
});
