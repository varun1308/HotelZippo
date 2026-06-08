/* Zero-spend pre-seed: copy the banked payloads written by `npm run dev:curation` (script caches)
 * into the ROUTE cache (scripts/dev/.cache/routes/) under the keys the admin routes/clients use, so
 * the curation UI replays them with CURATION_USE_CACHE=1 and NO live calls.
 *
 *   npm run dev:preseed-cache -- --destination Phuket --hotel "Splash Beach Resort"
 *
 * The route cache keys on (label, scope, input). We reconstruct the EXACT inputs the routes send via
 * the real input builders + cacheKeyFor (the same fn the live wrapper uses → no drift). `max` must
 * match what the UI sends, i.e. the route defaults below (keep .env.local's APIFY_*_MAX_RESULTS in
 * sync, or pass --max / --reviews-max). No network. Idempotent. Run via tsx. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { cacheKeyFor } from '@/lib/dev/actor-cache';
import { buildSearchInput, mapSearchItem } from '@/lib/curation/apify-mapper';
import {
  buildTripadvisorReviewsInput,
  buildGoogleReviewsInput,
} from '@/lib/review-intelligence/apify-mapper';
import { buildTextSearchBody, type PlaceQuery } from '@/lib/curation/google-places-mapper';
import { mapTextSearchResponse } from '@/lib/curation/google-places-mapper';
import { DESTINATIONS } from '@/lib/db/schemas';
import type { FetchedHotel } from '@/lib/curation/types';

type Destination = (typeof DESTINATIONS)[number];
const ROOT = process.cwd();
const SCRIPT = path.join(ROOT, 'scripts', 'dev', '.cache');
const ROUTES = path.join(SCRIPT, 'routes');
const TWELVE_MONTHS_MS = 365 * 24 * 60 * 60 * 1000;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function slug(s: string): string {
  return s.toLowerCase().replace(/\s+/g, '-');
}
async function readJson<T>(p: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(p, 'utf8')) as T;
  } catch {
    return null;
  }
}
async function writeRoute(file: string, value: unknown): Promise<void> {
  await fs.mkdir(ROUTES, { recursive: true });
  await fs.writeFile(path.join(ROUTES, file), JSON.stringify(value, null, 2), 'utf8');
  console.log(`  ✓ ${file}`);
}

async function main() {
  const dest = (arg('destination') ?? 'Phuket') as Destination;
  if (!(DESTINATIONS as readonly string[]).includes(dest)) throw new Error(`unknown destination ${dest}`);
  const searchMax = Number(arg('max') ?? process.env.APIFY_SEARCH_MAX_RESULTS ?? 10);
  const reviewsMax = Number(arg('reviews-max') ?? process.env.APIFY_REVIEWS_MAX_RESULTS ?? 30);
  const since = new Date(Date.now() - TWELVE_MONTHS_MS); // volatile keys are stripped from the cache key anyway

  const searchActor = process.env.APIFY_TRIPADVISOR_SEARCH_ACTOR_ID ?? 'maxcopell~tripadvisor';
  const taReviewsActor = process.env.APIFY_TRIPADVISOR_REVIEWS_ACTOR_ID ?? 'maxcopell~tripadvisor-reviews';
  const googleReviewsActor = process.env.APIFY_GOOGLE_REVIEWS_ACTOR_ID ?? 'compass~google-maps-reviews-scraper';

  console.log(`[preseed] ${dest} — searchMax=${searchMax} reviewsMax=${reviewsMax}\n`);

  // 1) Curation search: apify / <searchActor> / buildSearchInput(dest, searchMax)
  const search = await readJson<unknown[]>(path.join(SCRIPT, 'apify', `curation-${slug(dest)}.json`));
  let mapped: FetchedHotel[] = [];
  if (search) {
    await writeRoute(cacheKeyFor('apify', searchActor, buildSearchInput(dest, searchMax)), search);
    mapped = search.map((it) => mapSearchItem(it, dest)).filter((h): h is FetchedHotel => h !== null);
  } else {
    console.log('  (no curation search cache — run: npm run dev:curation -- --destination ' + dest + ' --live)');
  }

  // 2) Places: places / searchText / PlaceQuery(per hotel). The resolver caches the RAW Google
  //    response; we only have the extracted id, so synthesise the minimal response the mapper reads
  //    ({ places: [{ id }] }) — mapTextSearchResponse(that) === id, identical to a live HIT.
  const places = await readJson<Record<string, string | null>>(path.join(SCRIPT, 'google', `places-${slug(dest)}.json`));
  if (places && mapped.length) {
    let n = 0;
    for (const h of mapped) {
      const id = places[h.name];
      if (!id) continue;
      const q: PlaceQuery = { name: h.name, destination: dest, latitude: h.latitude, longitude: h.longitude };
      const synthetic = { places: [{ id }] };
      // sanity: the mapper must extract exactly this id from our synthetic response
      if (mapTextSearchResponse(synthetic) !== id) throw new Error(`synthetic places response mismatch for ${h.name}`);
      // The resolver wraps resolveGooglePlaceIdLive (returns the id string), and withActorCache caches
      // the RETURN VALUE of that — i.e. the id string itself, not the raw response. So cache the id.
      await writeRoute(cacheKeyFor('places', 'searchText', q), id);
      n += 1;
    }
    console.log(`  (places: ${n} ids seeded)`);
  }

  // 3) Reviews for one hotel (both sources): apify / <reviewsActor> / build*ReviewsInput(...)
  const hotelName = arg('hotel');
  if (hotelName) {
    const hotel = mapped.find((h) => h.name.toLowerCase() === hotelName.toLowerCase());
    const ta = await readJson<unknown[]>(path.join(SCRIPT, 'reviews', `${slug(dest)}__${slug(hotelName)}__tripadvisor.json`));
    const gg = await readJson<unknown[]>(path.join(SCRIPT, 'reviews', `${slug(dest)}__${slug(hotelName)}__google.json`));
    if (ta && hotel?.tripadvisor_url) {
      await writeRoute(
        cacheKeyFor('apify', taReviewsActor, buildTripadvisorReviewsInput(hotel.tripadvisor_url, { maxResults: reviewsMax, since })),
        ta,
      );
    }
    const placeId = hotel ? places?.[hotel.name] : undefined;
    if (gg && placeId) {
      await writeRoute(
        cacheKeyFor('apify', googleReviewsActor, buildGoogleReviewsInput(placeId, { maxResults: reviewsMax, since })),
        gg,
      );
    }
  }

  console.log(`\n[preseed] done → ${path.relative(ROOT, ROUTES)}`);
}

main().catch((e) => {
  console.error(`[preseed] ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
