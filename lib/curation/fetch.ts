/* Fetch layer for the Curation Tool (12a). Three sources with graceful degradation:
 *   1. apify      — TripAdvisor Hotel Search actor (needs APIFY_API_TOKEN + actor id)
 *   2. playwright — fallback scraper (stub for now)
 *   3. mock       — static fixtures at /scripts/seed/fixtures/<destination>.json
 * v1 builds mock-first so the tool + Publish path are fully testable without Apify
 * credentials; the live Apify path is wired but exercised once a token is provided. */
import 'server-only';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fetchedHotelSchema, type FetchHotelsResult, type FetchedHotel } from './types';
import { runActorGetItems } from '@/lib/apify/client';
import { buildSearchInput, mapSearchItem } from './apify-mapper';
import { selectTopHotels } from './select';
import { DESTINATIONS } from '@/lib/db/schemas';

function slug(destination: string): string {
  return destination.toLowerCase().replace(/\s+/g, '-');
}

async function fetchFromMock(destination: string): Promise<FetchedHotel[]> {
  const file = path.join(process.cwd(), 'scripts', 'seed', 'fixtures', `${slug(destination)}.json`);
  const raw = await fs.readFile(file, 'utf8');
  const parsed = JSON.parse(raw);
  return fetchedHotelSchema.array().parse(parsed);
}

/** Live TripAdvisor-search fetch. Fetches a LARGE pool (~APIFY_SEARCH_POOL_SIZE) then selects the
 * top N (APIFY_SEARCH_MAX_RESULTS, default 50): prefer 4&5-star by Traveller Ranking, backfill with
 * the next-best-ranked if fewer than N (see lib/curation/select). The ≥100-review gate stays at
 * approve-time (canApprove), not here. Throws on missing actor id / Apify failure →
 * fetchHotels() catch degrades to playwright→mock. */
async function fetchFromApify(destination: string): Promise<FetchedHotel[]> {
  const actorId = process.env.APIFY_TRIPADVISOR_SEARCH_ACTOR_ID;
  if (!actorId) throw new Error('APIFY_TRIPADVISOR_SEARCH_ACTOR_ID is not set');
  if (!(DESTINATIONS as readonly string[]).includes(destination)) {
    throw new Error(`unknown destination: ${destination}`);
  }
  const poolSize = Number(process.env.APIFY_SEARCH_POOL_SIZE ?? 500);
  const items = await runActorGetItems({
    actorId,
    input: buildSearchInput(destination, poolSize),
    limit: poolSize,
  });
  const pool = items
    .map((it) => mapSearchItem(it, destination as (typeof DESTINATIONS)[number]))
    .filter((h): h is FetchedHotel => h !== null);
  const topN = Number(process.env.APIFY_SEARCH_MAX_RESULTS ?? 50);
  return selectTopHotels(pool, { topN });
}

async function fetchFromPlaywright(_destination: string): Promise<FetchedHotel[]> {
  throw new Error('playwright-not-implemented');
}

/** Fetch candidates for a destination, degrading apify → playwright → mock. */
export async function fetchHotels(destination: string): Promise<FetchHotelsResult> {
  const hasApify =
    !!process.env.APIFY_API_TOKEN && !!process.env.APIFY_TRIPADVISOR_SEARCH_ACTOR_ID;

  if (hasApify) {
    try {
      return { source: 'apify', hotels: await fetchFromApify(destination) };
    } catch {
      try {
        return { source: 'playwright', hotels: await fetchFromPlaywright(destination) };
      } catch {
        /* fall through to mock */
      }
    }
  }
  return { source: 'mock', hotels: await fetchFromMock(destination) };
}
