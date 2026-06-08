/* Credit-safe live test for the curation external calls (lib/curation): the Apify TripAdvisor
 * SEARCH actor + the Google Places place-id RESOLVER.
 *
 * Both cost money (Apify credits / Google quota), so this script BANKS each call's output once and
 * replays it for free thereafter — the same "bank once, re-map later" idea as raw_review_payloads,
 * but at the dev-script layer for curation.
 *
 *   npm run dev:curation -- --destination Phuket               # replay from cache (NO network)
 *   npm run dev:curation -- --destination Phuket --live        # call the actor ONCE, cache, then map
 *   npm run dev:curation -- --destination Phuket --live --force # re-run even if a cache file exists
 *   npm run dev:curation -- --destination Phuket --max 10       # cap actor results (credit control)
 *   npm run dev:curation -- --destination Phuket --places       # ALSO resolve Google place ids (cached)
 *   npm run dev:curation -- --destination Phuket --reviews      # ALSO scrape reviews for ONE hotel (cached)
 *   npm run dev:curation -- --destination Phuket --reviews --hotel "Splash Beach Resort"
 *
 * Default (no --live) NEVER touches the actor: it reads scripts/dev/.cache/apify/curation-<dest>.json
 * and runs mapSearchItem over it. With --places, each mapped hotel is resolved to a Google place id
 * via Text Search — also cached (scripts/dev/.cache/google/places-<dest>.json), keyed per hotel, so a
 * second run reuses cached ids and only resolves hotels not yet cached. With --reviews, ONE hotel
 * (the top-ranked one carrying both a TripAdvisor url and a resolved place id, or --hotel "<name>")
 * is scraped on BOTH reviews actors; raw output is cached per hotel+source under
 * scripts/dev/.cache/reviews/ so re-runs replay for free. The cache dir is git-ignored.
 * Run via tsx so .env.local (APIFY_API_TOKEN + actor ids + GOOGLE_PLACES_API_KEY) is loaded. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { runActorGetItems } from '@/lib/apify/client';
import { buildSearchInput, mapSearchItem } from '@/lib/curation/apify-mapper';
import { resolveGooglePlaceId, GooglePlacesError } from '@/lib/curation/google-places';
import {
  buildTripadvisorReviewsInput,
  buildGoogleReviewsInput,
  mapTripadvisorReviewItem,
  mapGoogleReviewItem,
} from '@/lib/review-intelligence/apify-mapper';
import type { RawReviewInput } from '@/lib/review-intelligence/tagging';
import { DESTINATIONS } from '@/lib/db/schemas';
import type { FetchedHotel } from '@/lib/curation/types';

type Destination = (typeof DESTINATIONS)[number];

const CACHE_DIR = path.join(process.cwd(), 'scripts', 'dev', '.cache', 'apify');
const PLACES_CACHE_DIR = path.join(process.cwd(), 'scripts', 'dev', '.cache', 'google');
const REVIEWS_CACHE_DIR = path.join(process.cwd(), 'scripts', 'dev', '.cache', 'reviews');
const TWELVE_MONTHS_MS = 365 * 24 * 60 * 60 * 1000;

function slug(destination: string): string {
  return destination.toLowerCase().replace(/\s+/g, '-');
}

function cachePath(destination: string): string {
  return path.join(CACHE_DIR, `curation-${slug(destination)}.json`);
}

function placesCachePath(destination: string): string {
  return path.join(PLACES_CACHE_DIR, `places-${slug(destination)}.json`);
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const has = (name: string) => process.argv.includes(`--${name}`);

async function readCache(destination: string): Promise<unknown[] | null> {
  try {
    const raw = await fs.readFile(cachePath(destination), 'utf8');
    return JSON.parse(raw) as unknown[];
  } catch {
    return null;
  }
}

async function writeCache(destination: string, items: unknown[]): Promise<void> {
  await fs.mkdir(CACHE_DIR, { recursive: true });
  await fs.writeFile(cachePath(destination), JSON.stringify(items, null, 2), 'utf8');
}

/** Call the real Apify actor ONCE and bank its raw output. Guard against accidental double-spend:
 * refuses to run if a cache file already exists unless --force is passed. */
async function fetchLive(destination: Destination, max: number): Promise<unknown[]> {
  const token = process.env.APIFY_API_TOKEN;
  const actorId = process.env.APIFY_TRIPADVISOR_SEARCH_ACTOR_ID;
  if (!token) throw new Error('APIFY_API_TOKEN is not set (.env.local)');
  if (!actorId) throw new Error('APIFY_TRIPADVISOR_SEARCH_ACTOR_ID is not set (.env.local)');

  if ((await readCache(destination)) && !has('force')) {
    throw new Error(
      `A cache already exists at ${cachePath(destination)}. Replay it (drop --live) or pass --force to re-spend credits.`,
    );
  }

  console.log(`[curation] LIVE actor run: ${actorId} · ${destination} · max=${max} (spends Apify credits)…`);
  const items = await runActorGetItems({ actorId, input: buildSearchInput(destination, max), limit: max });
  await writeCache(destination, items);
  console.log(`[curation] banked ${items.length} raw items → ${path.relative(process.cwd(), cachePath(destination))}`);
  return items;
}

/** Map of "<hotel name>" → resolved place id (or null = resolved-but-no-match). Cached so a second
 * --places run reuses ids and only resolves hotels NOT yet present (incremental, never re-spends). */
type PlacesCache = Record<string, string | null>;

async function readPlacesCache(destination: string): Promise<PlacesCache> {
  try {
    return JSON.parse(await fs.readFile(placesCachePath(destination), 'utf8')) as PlacesCache;
  } catch {
    return {};
  }
}

async function writePlacesCache(destination: string, cache: PlacesCache): Promise<void> {
  await fs.mkdir(PLACES_CACHE_DIR, { recursive: true });
  await fs.writeFile(placesCachePath(destination), JSON.stringify(cache, null, 2), 'utf8');
}

/** Resolve each mapped hotel → Google place id, using a per-hotel disk cache. Only hotels missing
 * from the cache hit the live Text Search API (lat/long-biased when geo present). Returns the
 * resolved map and a count of how many were freshly resolved (i.e. cost quota this run). */
async function resolvePlaces(
  destination: Destination,
  hotels: FetchedHotel[],
): Promise<{ ids: PlacesCache; fresh: number }> {
  const cache = await readPlacesCache(destination);
  let fresh = 0; // freshly resolved (cached this run)
  let attempted = 0; // hit the live API this run (resolved OR failed)
  let failed = 0; // hit the API but errored (left uncached to retry)
  for (const h of hotels) {
    if (h.name in cache) continue; // already resolved (id or null) — reuse, no spend
    attempted += 1;
    try {
      const id = await resolveGooglePlaceId({
        name: h.name,
        destination,
        latitude: h.latitude,
        longitude: h.longitude,
      });
      cache[h.name] = id;
      fresh += 1;
      console.log(`[places] live resolve: ${h.name} → ${id ?? '(no match)'}`);
    } catch (e) {
      if (e instanceof GooglePlacesError && e.kind === 'no_key') {
        throw new Error('GOOGLE_PLACES_API_KEY is not set (.env.local) — cannot run --places');
      }
      // A transient HTTP error for one hotel shouldn't abort the batch; leave it uncached to retry.
      failed += 1;
      console.error(`[places] FAILED ${h.name}: ${e instanceof Error ? e.message : e}`);
    }
  }
  if (fresh > 0) await writePlacesCache(destination, cache);
  if (attempted === 0) console.log('[places] all hotels already cached — no live calls');
  else if (failed > 0) console.log(`[places] ${failed}/${attempted} live calls failed (left uncached — re-run to retry)`);
  return { ids: cache, fresh };
}

function summarizePlaces(hotels: FetchedHotel[], ids: PlacesCache, fresh: number): void {
  const resolved = hotels.filter((h) => ids[h.name]).length;
  const noMatch = hotels.filter((h) => h.name in ids && ids[h.name] === null).length;
  console.log(`\n[places] resolved ${resolved}/${hotels.length} (no-match ${noMatch}); ${fresh} freshly resolved this run\n`);
  hotels.forEach((h, i) => {
    const id = ids[h.name];
    const status = id ? id : h.name in ids ? '(no match)' : '(unresolved)';
    console.log(`  ${String(i + 1).padStart(2)}. ${h.name} → ${status}`);
  });
}

/* ── Reviews scrape (one hotel, both sources) ──────────────────────────────────────────────── */

function reviewsCachePath(destination: string, hotelName: string, source: 'tripadvisor' | 'google'): string {
  return path.join(REVIEWS_CACHE_DIR, `${slug(destination)}__${slug(hotelName)}__${source}.json`);
}

/** Run ONE reviews actor for ONE hotel, banking the raw items. Replays from cache unless --force;
 * refuses to re-spend on an existing cache without --force (same guard as the curation actor). */
async function scrapeReviewsSource(
  destination: string,
  hotelName: string,
  source: 'tripadvisor' | 'google',
  input: Record<string, unknown>,
  maxResults: number,
): Promise<unknown[]> {
  const file = reviewsCachePath(destination, hotelName, source);
  if (!has('live')) {
    try {
      const cached = JSON.parse(await fs.readFile(file, 'utf8')) as unknown[];
      console.log(`[reviews:${source}] REPLAY from cache (${cached.length} items, no actor call)`);
      return cached;
    } catch {
      throw new Error(
        `No ${source} reviews cache for "${hotelName}". Do one live run first:\n` +
          `  npm run dev:curation -- --destination ${destination} --reviews --hotel "${hotelName}" --live`,
      );
    }
  }
  try {
    await fs.access(file);
    if (!has('force')) {
      throw new Error(`A ${source} cache already exists at ${file}. Replay (drop --live) or pass --force.`);
    }
  } catch (e) {
    if (e instanceof Error && e.message.includes('already exists')) throw e; // re-throw our guard
    /* no cache yet → proceed to live run */
  }
  const actorId =
    source === 'tripadvisor'
      ? process.env.APIFY_TRIPADVISOR_REVIEWS_ACTOR_ID
      : process.env.APIFY_GOOGLE_REVIEWS_ACTOR_ID;
  if (!actorId) throw new Error(`${source} reviews actor id env var is not set (.env.local)`);

  console.log(`[reviews:${source}] LIVE actor run: ${actorId} · "${hotelName}" · max=${maxResults} (spends credits)…`);
  const items = await runActorGetItems({ actorId, input, limit: maxResults });
  await fs.mkdir(REVIEWS_CACHE_DIR, { recursive: true });
  await fs.writeFile(file, JSON.stringify(items, null, 2), 'utf8');
  console.log(`[reviews:${source}] banked ${items.length} raw items → ${path.relative(process.cwd(), file)}`);
  return items;
}

/** Pick the target hotel: --hotel "<name>" if given, else the first (top-ranked) hotel that carries
 * BOTH a TripAdvisor url and a resolved Google place id (so both sources can be exercised). */
function pickReviewHotel(hotels: FetchedHotel[], placeIds: PlacesCache): FetchedHotel | null {
  const wanted = arg('hotel');
  if (wanted) return hotels.find((h) => h.name.toLowerCase() === wanted.toLowerCase()) ?? null;
  return hotels.find((h) => !!h.tripadvisor_url && !!placeIds[h.name]) ?? hotels.find((h) => !!h.tripadvisor_url) ?? null;
}

async function scrapeReviews(destination: Destination, hotel: FetchedHotel, placeId: string | null): Promise<void> {
  const maxResults = Number(arg('max') ?? process.env.APIFY_REVIEWS_MAX_RESULTS ?? 30);
  const since = new Date(Date.now() - TWELVE_MONTHS_MS);
  console.log(`\n[reviews] target: "${hotel.name}" — TA url ${hotel.tripadvisor_url ? '✓' : '✗'}, place id ${placeId ? '✓' : '✗'}\n`);

  const out: { source: 'tripadvisor' | 'google'; raw: number; mapped: RawReviewInput[] }[] = [];

  if (hotel.tripadvisor_url) {
    const raw = await scrapeReviewsSource(
      destination, hotel.name, 'tripadvisor',
      buildTripadvisorReviewsInput(hotel.tripadvisor_url, { maxResults, since }), maxResults,
    );
    out.push({ source: 'tripadvisor', raw: raw.length, mapped: raw.map(mapTripadvisorReviewItem).filter((r): r is RawReviewInput => r !== null) });
  } else {
    console.log('[reviews:tripadvisor] skipped — hotel has no tripadvisor_url');
  }

  if (placeId) {
    const raw = await scrapeReviewsSource(
      destination, hotel.name, 'google',
      buildGoogleReviewsInput(placeId, { maxResults, since }), maxResults,
    );
    out.push({ source: 'google', raw: raw.length, mapped: raw.map(mapGoogleReviewItem).filter((r): r is RawReviewInput => r !== null) });
  } else {
    console.log('[reviews:google] skipped — no resolved place id (run --places first)');
  }

  console.log('');
  for (const o of out) {
    const dated = o.mapped.filter((r) => r.review_date).length;
    const rated = o.mapped.filter((r) => r.rating != null).length;
    const texted = o.mapped.filter((r) => r.review_text).length;
    console.log(`[reviews:${o.source}] raw ${o.raw} → mapped ${o.mapped.length} (dropped ${o.raw - o.mapped.length}); dated=${dated} rated=${rated} text=${texted}`);
    const sample = o.mapped[0];
    if (sample) {
      const t = sample.review_text ? `"${sample.review_text.slice(0, 80).replace(/\s+/g, ' ')}…"` : '(no text)';
      console.log(`    e.g. ${sample.review_date ?? '????-??-??'} · ${sample.rating ?? '?'}★ · ${sample.reviewer_name ?? 'anon'} · ${t}`);
    }
  }
  const total = out.reduce((n, o) => n + o.mapped.length, 0);
  console.log(`\n[reviews] total mapped reviews across both sources: ${total}`);
}

function summarize(destination: Destination, raw: unknown[], mapped: FetchedHotel[]): void {
  console.log(`\n[curation] raw items: ${raw.length} → mapped hotels: ${mapped.length} (dropped ${raw.length - mapped.length})\n`);
  mapped.forEach((h, i) => {
    const stars = h.star_rating != null ? `${h.star_rating}★` : '—';
    const rank = h.tripadvisor_rank != null ? `#${h.tripadvisor_rank}` : '—';
    const revs = h.review_count != null ? `${h.review_count} revs` : 'no revs';
    const geo = h.latitude != null && h.longitude != null ? '📍' : '∅geo';
    const img = h.images && h.images.length > 0 ? '🖼' : '∅img';
    console.log(
      `  ${String(i + 1).padStart(2)}. ${h.name}\n` +
        `      ${stars} · ${rank} · ${revs} · ${h.price_tier ?? '∅tier'} · ${geo} · ${img}`,
    );
  });
  // Field-coverage tally — quick read on whether the mapper is pulling each field.
  const cov = (pred: (h: FetchedHotel) => boolean) => mapped.filter(pred).length;
  console.log(
    `\n[curation] field coverage (of ${mapped.length}): ` +
      `name=${cov((h) => !!h.name)} url=${cov((h) => !!h.tripadvisor_url)} ` +
      `rank=${cov((h) => h.tripadvisor_rank != null)} reviews=${cov((h) => h.review_count != null)} ` +
      `tier=${cov((h) => !!h.price_tier)} stars=${cov((h) => h.star_rating != null)} ` +
      `geo=${cov((h) => h.latitude != null && h.longitude != null)} ` +
      `images=${cov((h) => !!h.images && h.images.length > 0)} address=${cov((h) => !!h.address)}`,
  );
}

async function main() {
  const dest = arg('destination') ?? 'Phuket';
  if (!(DESTINATIONS as readonly string[]).includes(dest)) {
    throw new Error(`unknown destination "${dest}" — one of: ${DESTINATIONS.join(', ')}`);
  }
  const destination = dest as Destination;
  const max = Number(arg('max') ?? process.env.APIFY_SEARCH_MAX_RESULTS ?? 10);

  // Curation actor: replay from cache whenever one exists (so downstream steps like --reviews/--places
  // can use --live WITHOUT re-spending curation credits); only go live when there's no cache, or when
  // --live is paired with --force to deliberately re-fetch.
  const existing = await readCache(destination);
  let raw: unknown[];
  if (existing && !(has('live') && has('force'))) {
    console.log(`[curation] REPLAY from cache: ${path.relative(process.cwd(), cachePath(destination))} (${existing.length} items, no actor call)`);
    raw = existing;
  } else if (has('live')) {
    raw = await fetchLive(destination, max);
  } else {
    throw new Error(
      `No cache for "${destination}" at ${cachePath(destination)}. Do one live run first:\n` +
        `  npm run dev:curation -- --destination ${destination} --live --max ${max}`,
    );
  }

  const mapped = raw
    .map((it) => mapSearchItem(it, destination))
    .filter((h): h is FetchedHotel => h !== null);

  summarize(destination, raw, mapped);

  // Places ids are needed by the reviews step (google source), so load/resolve them when either
  // --places or --reviews is requested. With --reviews alone we only READ the existing cache.
  let placeIds: PlacesCache = {};
  if (has('places')) {
    const { ids, fresh } = await resolvePlaces(destination, mapped);
    placeIds = ids;
    summarizePlaces(mapped, ids, fresh);
  } else if (has('reviews')) {
    placeIds = await readPlacesCache(destination);
  }

  if (has('reviews')) {
    const hotel = pickReviewHotel(mapped, placeIds);
    if (!hotel) {
      throw new Error(
        arg('hotel')
          ? `--hotel "${arg('hotel')}" not found among the ${mapped.length} mapped hotels.`
          : 'No hotel with a tripadvisor_url found to scrape reviews for.',
      );
    }
    await scrapeReviews(destination, hotel, placeIds[hotel.name] ?? null);
  }
}

main().catch((e) => {
  console.error(`[curation] ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
