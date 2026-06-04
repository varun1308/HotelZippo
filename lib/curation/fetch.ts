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

function slug(destination: string): string {
  return destination.toLowerCase().replace(/\s+/g, '-');
}

async function fetchFromMock(destination: string): Promise<FetchedHotel[]> {
  const file = path.join(process.cwd(), 'scripts', 'seed', 'fixtures', `${slug(destination)}.json`);
  const raw = await fs.readFile(file, 'utf8');
  const parsed = JSON.parse(raw);
  return fetchedHotelSchema.array().parse(parsed);
}

// Placeholder — wired in full when a live Apify token + search-actor id exist.
async function fetchFromApify(_destination: string): Promise<FetchedHotel[]> {
  throw new Error('apify-not-configured');
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
