/* Review tagging (Phase 6 · specs/02-review-intelligence-pipeline.md Stage 4 / 08a-2 M3+O1).
 * Pure functions — no DB, no network — so they're trivially unit-testable.
 *
 * M3 family tagging uses the CANONICAL 08a-2 keyword list, case-insensitive, matched on
 * word boundaries. Do NOT expand it for v1 (the broader amenity/age-pattern terms —
 * playground, pram, cot, "5-year-old" — are parked as a v1.1 candidate in 08a-7).
 *
 * O1 Indian tagging is OPTIONAL: name-list + text signals (Indian city mentions, common
 * Hindi/food terms, festivals). If a hotel has no is_indian reviews, synthesis emits the
 * canonical "No reviews from Indian guests found for this hotel." — the pipeline still
 * produces valid output, so O1 is best-effort and conservative (precision over recall). */

/** Canonical 08a-2 family keyword list. Frozen — do not expand for v1. */
export const FAMILY_KEYWORDS = [
  'kids',
  'children',
  'family',
  'toddler',
  'baby',
  'infant',
  'little ones',
  'child',
  'daughter',
  'son',
  'grandchildren',
] as const;

/** Indian text signals (O1) — conservative. City mentions, common food/diet terms, festivals. */
const INDIAN_CITY_TERMS = [
  'mumbai',
  'delhi',
  'bengaluru',
  'bangalore',
  'chennai',
  'hyderabad',
  'kolkata',
  'pune',
  'ahmedabad',
];
const INDIAN_FOOD_TERMS = ['vegetarian', 'jain', 'paneer', 'dal', 'roti', 'masala', 'curd', 'idli', 'dosa'];
const INDIAN_FESTIVAL_TERMS = ['diwali', 'holi', 'navratri', 'pongal'];

/** Build a case-insensitive word-boundary matcher for a list of terms (terms may contain
 * spaces, e.g. "little ones"). Escapes regex metachars. */
function boundaryMatcher(terms: readonly string[]): RegExp {
  const escaped = terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`\\b(?:${escaped.join('|')})\\b`, 'i');
}

const FAMILY_RE = boundaryMatcher(FAMILY_KEYWORDS);
const INDIAN_TEXT_RE = boundaryMatcher([
  ...INDIAN_CITY_TERMS,
  ...INDIAN_FOOD_TERMS,
  ...INDIAN_FESTIVAL_TERMS,
]);

/** True if the review text mentions any canonical family keyword (M3). */
export function isFamilyReview(text: string | null | undefined): boolean {
  if (!text) return false;
  return FAMILY_RE.test(text);
}

/** Optional Indian-name list signal (O1). Curated, conservative — common Indian given
 * names; matched against the reviewer name only. Kept small to favour precision. */
const INDIAN_NAME_HINTS = [
  'patel',
  'sharma',
  'gupta',
  'singh',
  'kumar',
  'reddy',
  'iyer',
  'nair',
  'rao',
  'mehta',
  'shah',
  'desai',
  'agarwal',
  'banerjee',
  'chowdhury',
];
const INDIAN_NAME_RE = boundaryMatcher(INDIAN_NAME_HINTS);

/** True if the review shows an Indian-guest signal via reviewer name OR text (O1).
 * Conservative: a single positive signal is enough, but the term lists are curated small
 * to avoid false positives. */
export function isIndianReview(args: {
  text?: string | null;
  reviewerName?: string | null;
}): boolean {
  const { text, reviewerName } = args;
  if (reviewerName && INDIAN_NAME_RE.test(reviewerName)) return true;
  if (text && INDIAN_TEXT_RE.test(text)) return true;
  return false;
}

/** A raw review as it arrives from scraping, pre-tag. */
export interface RawReviewInput {
  source: 'tripadvisor' | 'google';
  review_date: string | null; // ISO YYYY-MM-DD
  reviewer_name: string | null;
  review_text: string | null;
  rating: number | null;
}

/** A review with the family/Indian tags applied. */
export interface TaggedReview extends RawReviewInput {
  is_family: boolean;
  is_indian: boolean;
}

/** Tag a batch of raw reviews (M3 + O1). O1 can be disabled (e.g. before it's validated)
 * via { indian: false }, in which case is_indian is always false and synthesis falls back
 * to the canonical no-Indian-reviews string. */
export function tagReviews(
  reviews: RawReviewInput[],
  opts: { indian?: boolean } = {},
): TaggedReview[] {
  const indianEnabled = opts.indian !== false;
  return reviews.map((r) => ({
    ...r,
    is_family: isFamilyReview(r.review_text),
    is_indian: indianEnabled ? isIndianReview({ text: r.review_text, reviewerName: r.reviewer_name }) : false,
  }));
}
