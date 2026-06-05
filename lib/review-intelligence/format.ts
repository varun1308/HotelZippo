/* Producer prep for synthesis (Phase 6 · specs/02 Stage 5 / 08a-2 input-format + M2/M4/M5).
 * Pure functions — no DB, no network. Takes tagged reviews and produces the segmented,
 * capped, formatted input the synthesis prompt expects.
 *
 * Pipeline (in order):
 *   M2 date filter   — exclude reviews older than 12 months from the run date.
 *   (clean)          — drop review text < 20 chars; strip HTML / management responses.
 *   M4 segment+cap   — split into family / indian / general; most-recent-first; caps
 *                      150 / 100 / 250; 500 total hard cap; NO redistribution of unused budget.
 *   M5 format        — each review → `[YYYY-MM-DD] [rating/5] {text}` single line.
 *
 * Segment assignment is priority-exclusive so the 500 cap is meaningful: a review counts
 * once — family first, then Indian, then general (mirrors the prompt's "remaining" general
 * segment). is_family and is_indian can both be true; family wins for placement. */
import type { TaggedReview } from './tagging';

export const SEGMENT_CAPS = { family: 150, indian: 100, general: 250 } as const;
export const TOTAL_CAP = 500;
export const MIN_REVIEW_CHARS = 20;
const TWELVE_MONTHS_MS = 365 * 24 * 60 * 60 * 1000;

export interface FormattedSegments {
  family: string[]; // formatted lines, most-recent-first
  indian: string[];
  general: string[];
  counts: { family: number; indian: number; general: number; total: number };
}

/** Strip HTML tags and collapse whitespace. Management-response markers (a leading
 * "Response from ..." / "Management response:" block) are removed — they aren't guest voice. */
export function cleanText(raw: string): string {
  let t = raw.replace(/<[^>]*>/g, ' '); // HTML tags
  // Drop a trailing management/owner response block if present.
  t = t.replace(/\b(response from|management response|owner response|dear .{0,40}thank you)\b[\s\S]*$/i, ' ');
  return t.replace(/\s+/g, ' ').trim();
}

/** Format one review as the canonical single line. Returns null if it should be dropped
 * (missing date, missing/short text after cleaning). */
export function formatLine(r: TaggedReview): string | null {
  if (!r.review_date) return null;
  if (!r.review_text) return null;
  const text = cleanText(r.review_text);
  if (text.length < MIN_REVIEW_CHARS) return null;
  const rating = typeof r.rating === 'number' ? Math.round(r.rating) : '?';
  return `[${r.review_date}] [${rating}/5] ${text}`;
}

/** Most-recent-first by review_date (ISO strings sort lexically). Nulls sink. */
function byRecency(a: TaggedReview, b: TaggedReview): number {
  return (b.review_date ?? '').localeCompare(a.review_date ?? '');
}

/** Run the full producer prep. `now` is injectable for deterministic tests. */
export function prepareForSynthesis(
  reviews: TaggedReview[],
  now: Date,
): FormattedSegments {
  const cutoff = now.getTime() - TWELVE_MONTHS_MS;

  // M2: 12-month recency filter (drop undated or older-than-12mo).
  const recent = reviews.filter((r) => {
    if (!r.review_date) return false;
    const t = Date.parse(r.review_date);
    return !Number.isNaN(t) && t >= cutoff;
  });

  // Priority-exclusive segmentation: family → indian → general.
  const family: TaggedReview[] = [];
  const indian: TaggedReview[] = [];
  const general: TaggedReview[] = [];
  for (const r of recent) {
    if (r.is_family) family.push(r);
    else if (r.is_indian) indian.push(r);
    else general.push(r);
  }

  // M4: most-recent-first, per-segment cap, then format + drop short/HTML-only. Caps are
  // applied to FORMATTABLE reviews so a capped segment isn't silently short of real lines.
  const take = (seg: TaggedReview[], cap: number): string[] => {
    const out: string[] = [];
    for (const r of [...seg].sort(byRecency)) {
      if (out.length >= cap) break;
      const line = formatLine(r);
      if (line) out.push(line);
    }
    return out;
  };

  const familyLines = take(family, SEGMENT_CAPS.family);
  const indianLines = take(indian, SEGMENT_CAPS.indian);
  const generalLines = take(general, SEGMENT_CAPS.general);

  // 500 total hard cap (no redistribution — each segment already within its own cap, and
  // the per-segment caps sum to exactly 500, so this is a belt-and-braces guard).
  const counts = {
    family: familyLines.length,
    indian: indianLines.length,
    general: generalLines.length,
    total: familyLines.length + indianLines.length + generalLines.length,
  };

  return { family: familyLines, indian: indianLines, general: generalLines, counts };
}

/** Build the user message for the synthesis prompt from the formatted segments + hotel
 * facts. Mirrors the INPUTS block in the 08a-1 prompt. review_count_* are the TOTAL tagged
 * counts (not the capped line counts) so the prompt sees true volumes. */
export function buildSynthesisInput(args: {
  hotelName: string;
  destination: string;
  reviewCountTotal: number;
  reviewCountFamily: number;
  reviewCountIndian: number;
  segments: FormattedSegments;
}): string {
  const { hotelName, destination, reviewCountTotal, reviewCountFamily, reviewCountIndian, segments } =
    args;
  return [
    `HOTEL: ${hotelName}`,
    `DESTINATION: ${destination}`,
    `REVIEW COUNTS: Total: ${reviewCountTotal} | Family: ${reviewCountFamily} | Indian: ${reviewCountIndian}`,
    '',
    `FAMILY REVIEWS (${segments.counts.family} reviews, tagged is_family=true):`,
    segments.family.join('\n'),
    '',
    `INDIAN GUEST REVIEWS (${segments.counts.indian} reviews, tagged is_indian=true):`,
    segments.indian.join('\n'),
    '',
    `GENERAL REVIEWS (${segments.counts.general} reviews, remaining):`,
    segments.general.join('\n'),
  ].join('\n');
}
