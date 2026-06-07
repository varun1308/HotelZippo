/* Review scraping layer (Phase 6 · specs/02 Stage 2 / 08a-6 TC-P1..P4). Per hotel, pulls
 * reviews from two sources with graceful degradation, mirroring the curation fetch pattern:
 *   1. apify      — TripAdvisor Reviews + Google Maps Reviews actors (needs APIFY_API_TOKEN
 *                   + the two actor-id env vars). Each source is independent.
 *   2. playwright — fallback scraper (stub for now; throws → next source).
 *   3. mock       — static fixtures at /scripts/pipeline/fixtures/reviews/<hotel-slug>.json
 * v1 is mock-first so the whole pipeline is testable without Apify credentials; the live
 * Apify path is wired but exercised once a token + actor ids are provided.
 *
 * PER-SOURCE independence (TC-P3 partial failure): TripAdvisor and Google are scraped
 * separately; if one source fails we proceed with the other and RECORD the gap, rather than
 * failing the whole hotel. Zero reviews overall is a distinct signal (TC-P1) handled by the
 * caller (worker): review_count_total = 0 → skip synthesis, mark failed, continue. */
// No `import 'server-only'`: this module is part of the worker chain (run by the standalone
// Node worker via tsx, where that guard throws). Server-side by construction; never imported
// by a client component.
import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { trace, SpanStatusCode } from '@opentelemetry/api';
import type { RawReviewInput } from './tagging';
import { runActorGetItems } from '@/lib/apify/client';
import {
  buildTripadvisorReviewsInput,
  buildGoogleReviewsInput,
  mapTripadvisorReviewItem,
  mapGoogleReviewItem,
} from './apify-mapper';

export type ReviewSource = 'tripadvisor' | 'google';

/** Inputs the scraper needs for one hotel (from its `hotels` row). */
export interface ScrapeTarget {
  hotelId: string;
  hotelName: string;
  tripadvisorUrl: string | null;
  googlePlaceId: string | null;
}

export interface SourceOutcome {
  source: ReviewSource;
  ok: boolean;
  reviews: RawReviewInput[];
  /** When ok=false, why — recorded as the gap for partial-failure reporting. */
  error?: string;
  /** Which layer produced the reviews. */
  via?: 'apify' | 'playwright' | 'mock';
}

export interface ScrapeResult {
  hotelId: string;
  reviews: RawReviewInput[];
  /** Per-source outcomes (for the gap record on partial failure). */
  sources: SourceOutcome[];
  /** True if at least one source failed while another succeeded (TC-P3). */
  partial: boolean;
}

const rawReviewSchema = z.object({
  source: z.enum(['tripadvisor', 'google']),
  review_date: z.string().nullable(),
  reviewer_name: z.string().nullable(),
  review_text: z.string().nullable(),
  rating: z.number().nullable(),
});

function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/** Mock fixtures: a hotel's reviews keyed by source. Missing file → no reviews (not an error
 * for mock; lets a hotel with no fixture behave as "zero reviews" for TC-P1). */
async function scrapeFromMock(target: ScrapeTarget): Promise<RawReviewInput[]> {
  const file = path.join(process.cwd(), 'scripts', 'pipeline', 'fixtures', 'reviews', `${slug(target.hotelName)}.json`);
  let raw: string;
  try {
    raw = await fs.readFile(file, 'utf8');
  } catch {
    return []; // no fixture → zero reviews
  }
  return rawReviewSchema.array().parse(JSON.parse(raw));
}

// Live Apify per-source scrape — only runs when a token + the source's actor id exist (hasApifyFor).
// Each source maps to one actor; throws on failure (incl. a missing url/place_id) so the per-source
// chain records the gap and the run continues. Over-fetches the last 12 months; format.ts re-filters
// to 12mo + per-segment caps at synthesis, so the wide window here is safe.
const TWELVE_MONTHS_MS = 365 * 24 * 60 * 60 * 1000;

async function scrapeFromApify(target: ScrapeTarget, source: ReviewSource): Promise<RawReviewInput[]> {
  const since = new Date(Date.now() - TWELVE_MONTHS_MS);
  const maxResults = Number(process.env.APIFY_REVIEWS_MAX_RESULTS ?? 600);

  if (source === 'tripadvisor') {
    if (!target.tripadvisorUrl) throw new Error('no tripadvisor_url for hotel');
    const actorId = process.env.APIFY_TRIPADVISOR_REVIEWS_ACTOR_ID!;
    const items = await runActorGetItems({
      actorId,
      input: buildTripadvisorReviewsInput(target.tripadvisorUrl, { maxResults, since }),
      limit: maxResults,
    });
    return items.map(mapTripadvisorReviewItem).filter((r): r is RawReviewInput => r !== null);
  }

  // google
  if (!target.googlePlaceId) throw new Error('no google_place_id for hotel');
  const actorId = process.env.APIFY_GOOGLE_REVIEWS_ACTOR_ID!;
  const items = await runActorGetItems({
    actorId,
    input: buildGoogleReviewsInput(target.googlePlaceId, { maxResults, since }),
    limit: maxResults,
  });
  return items.map(mapGoogleReviewItem).filter((r): r is RawReviewInput => r !== null);
}

async function scrapeFromPlaywright(_target: ScrapeTarget, _source: ReviewSource): Promise<RawReviewInput[]> {
  throw new Error('playwright-not-implemented');
}

/** Injectable source scrapers (tests pass fakes to simulate timeout / partial failure /
 * zero reviews without touching the network). Defaults run the apify→playwright→mock chain. */
export interface ScrapeDeps {
  scrapeSource?: (target: ScrapeTarget, source: ReviewSource) => Promise<RawReviewInput[]>;
}

function hasApifyFor(source: ReviewSource): boolean {
  if (!process.env.APIFY_API_TOKEN) return false;
  return source === 'tripadvisor'
    ? !!process.env.APIFY_TRIPADVISOR_REVIEWS_ACTOR_ID
    : !!process.env.APIFY_GOOGLE_REVIEWS_ACTOR_ID;
}

/** Scrape ONE source for a hotel through the degradation chain. Returns the outcome; never
 * throws (a thrown scrape becomes ok=false so the run continues — TC-P2/P3). */
async function scrapeOneSource(
  target: ScrapeTarget,
  source: ReviewSource,
  deps: ScrapeDeps,
): Promise<SourceOutcome> {
  // A test override replaces the whole chain for that source.
  if (deps.scrapeSource) {
    try {
      return { source, ok: true, reviews: await deps.scrapeSource(target, source), via: 'mock' };
    } catch (e) {
      return { source, ok: false, reviews: [], error: e instanceof Error ? e.message : String(e) };
    }
  }

  if (hasApifyFor(source)) {
    try {
      return { source, ok: true, reviews: await scrapeFromApify(target, source), via: 'apify' };
    } catch {
      try {
        return { source, ok: true, reviews: await scrapeFromPlaywright(target, source), via: 'playwright' };
      } catch {
        /* fall through to mock */
      }
    }
  }
  try {
    return { source, ok: true, reviews: await scrapeFromMock(target), via: 'mock' };
  } catch (e) {
    return { source, ok: false, reviews: [], error: e instanceof Error ? e.message : String(e) };
  }
}

/** Scrape both sources for a hotel. OTEL-traced (hotel_id, review count, success/failure).
 * Partial failure (one source down) proceeds with the other and flags `partial`. */
export async function scrapeHotelReviews(
  target: ScrapeTarget,
  deps: ScrapeDeps = {},
): Promise<ScrapeResult> {
  const tracer = trace.getTracer('hotelzippo');
  return tracer.startActiveSpan('apify.scrape_hotel', async (span) => {
    span.setAttribute('hotel_id', target.hotelId);
    const start = Date.now();
    try {
      // Strictly per-source; mock returns the same file for both, so de-dup by source there.
      const sources: SourceOutcome[] = [];
      for (const source of ['tripadvisor', 'google'] as const) {
        sources.push(await scrapeOneSource(target, source, deps));
      }

      // Mock fixtures carry their own `source` field; filter each outcome to its source so a
      // single fixture file can hold both sources without double-counting.
      for (const o of sources) o.reviews = o.reviews.filter((r) => r.source === o.source);

      const reviews = sources.flatMap((s) => s.reviews);
      const anyOk = sources.some((s) => s.ok);
      const anyFail = sources.some((s) => !s.ok);
      const partial = anyOk && anyFail;

      span.setAttribute('review_count', reviews.length);
      span.setAttribute('partial', partial);
      span.setStatus({ code: SpanStatusCode.OK });
      return { hotelId: target.hotelId, reviews, sources, partial };
    } catch (e) {
      span.recordException(e as Error);
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw e;
    } finally {
      span.setAttribute('duration_ms', Date.now() - start);
      span.end();
    }
  });
}
