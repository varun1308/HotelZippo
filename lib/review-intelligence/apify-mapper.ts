/* Review-scraper adapters (Phase 6 live Apify, specs/02 Stage 2). Isolates ALL knowledge of the
 * TripAdvisor-reviews and Google-Maps-reviews actor I/O shapes. Each `build*Input` produces an
 * actor input; each `map*ReviewItem` converts one dataset row → RawReviewInput (or null to skip).
 *
 * CRITICAL: each mapper hard-codes its own `source`. `scrapeHotelReviews` (apify.ts) filters
 * each source's outcome with `r.source === o.source`, so a wrong/absent source silently drops
 * the review.
 *
 * The exact actor input keys / dataset field names are the founder-verifiable detail (modelled on
 * standard public actors): when the real actor's dataset differs, adjust the field reads here +
 * the test fixtures — nothing else changes. */
import type { RawReviewInput } from './tagging';

export interface ReviewFetchOpts {
  /** Per-source over-fetch cap. format.ts re-filters to 12mo + per-segment caps at synthesis. */
  maxResults: number;
  /** 12-month cutoff — passed to the actor's date filter where it has one. */
  since: Date;
}

/** TripAdvisor-reviews actor input for one hotel page URL. */
export function buildTripadvisorReviewsInput(url: string, opts: ReviewFetchOpts): Record<string, unknown> {
  return {
    startUrls: [{ url }],
    maxReviews: opts.maxResults,
    reviewsLanguages: ['en'],
    sortBy: 'newest',
    lastReviewDate: toIsoDate(opts.since), // best-effort actor-side date floor
  };
}

/** Google-Maps-reviews actor input for one place id. */
export function buildGoogleReviewsInput(placeId: string, opts: ReviewFetchOpts): Record<string, unknown> {
  return {
    placeIds: [placeId],
    maxReviews: opts.maxResults,
    reviewsSort: 'newest',
    language: 'en',
  };
}

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function asString(v: unknown): string | null {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : null;
}

/** Normalise a date value → ISO YYYY-MM-DD, or null. Handles ISO strings, epoch millis/seconds,
 * and plain date strings; rejects unparseable / relative ("3 months ago") values. */
function normaliseDate(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === 'number' && Number.isFinite(v)) {
    // Heuristic: seconds vs millis.
    const ms = v < 1e12 ? v * 1000 : v;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : toIsoDate(d);
  }
  if (typeof v === 'string') {
    const s = v.trim();
    if (!s) return null;
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : toIsoDate(d);
  }
  return null;
}

/** Normalise a rating to a 1–5 number, or null. TripAdvisor sometimes reports a 0–50 (×10)
 * scale; collapse >5 by dividing by 10. Out-of-range → null. */
function normaliseRating(v: unknown): number | null {
  let n: number;
  if (typeof v === 'number') n = v;
  else if (typeof v === 'string') n = Number(v);
  else return null;
  if (!Number.isFinite(n)) return null;
  if (n > 5) n = n / 10; // 10-scale (e.g. 45 → 4.5)
  if (n < 0 || n > 5) return null;
  return n;
}

function pickText(row: Record<string, unknown>): string | null {
  return asString(row.text) ?? asString(row.review) ?? asString(row.reviewText) ?? asString(row.body);
}

function pickName(row: Record<string, unknown>): string | null {
  return (
    asString(row.user) ??
    asString(row.userName) ??
    asString(row.name) ??
    asString(row.reviewerName) ??
    asString(row.author)
  );
}

/** Map one TripAdvisor-reviews dataset item → RawReviewInput (source='tripadvisor'). */
export function mapTripadvisorReviewItem(item: unknown): RawReviewInput | null {
  if (!item || typeof item !== 'object') return null;
  const row = item as Record<string, unknown>;
  const review_text = pickText(row);
  const review_date = normaliseDate(row.publishedDate ?? row.date ?? row.reviewDate);
  const rating = normaliseRating(row.rating ?? row.score ?? row.bubbleRating);
  // A row with neither text nor rating carries no signal — skip.
  if (review_text == null && rating == null) return null;
  return { source: 'tripadvisor', review_date, reviewer_name: pickName(row), review_text, rating };
}

/** Map one Google-Maps-reviews dataset item → RawReviewInput (source='google'). */
export function mapGoogleReviewItem(item: unknown): RawReviewInput | null {
  if (!item || typeof item !== 'object') return null;
  const row = item as Record<string, unknown>;
  const review_text = pickText(row);
  const review_date = normaliseDate(row.publishedAtDate ?? row.publishAt ?? row.date ?? row.reviewDate);
  const rating = normaliseRating(row.stars ?? row.rating ?? row.score);
  if (review_text == null && rating == null) return null;
  return { source: 'google', review_date, reviewer_name: pickName(row), review_text, rating };
}
