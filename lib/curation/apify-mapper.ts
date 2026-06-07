/* Curation hotel-SEARCH adapter (Phase 1 live Apify, specs/12a). Isolates ALL knowledge of the
 * TripAdvisor-search actor's I/O shape so swapping actors = editing this file + env, not core
 * logic. `buildSearchInput` produces the actor input; `mapSearchItem` converts one dataset row
 * into a `FetchedHotel` (or null to skip a malformed row).
 *
 * INPUT keys (`buildSearchInput`) are VERIFIED against the founder's real actor input docs
 * (2026-06-07). The OUTPUT field reads (`mapSearchItem`) are still modelled on a standard public
 * TripAdvisor-search row and are the remaining founder-verifiable detail: when the real actor's
 * dataset differs, adjust the field reads here + the test fixture — nothing else changes. */
import { fetchedHotelSchema, type FetchedHotel } from './types';
import { DESTINATIONS, PRICE_TIERS } from '@/lib/db/schemas';

type Destination = (typeof DESTINATIONS)[number];

/** Build the TripAdvisor-search actor input for one destination. `maxResults` doubles as the
 * "top N by traveller ranking" cap — TA search returns results in ranking order, so the top N
 * fall out naturally. Keys match the real actor's input schema (founder-supplied 2026-06-07):
 * `query` is a LOCATION name (actor scrapes that location); `maxItemsPerQuery` is the per-query
 * cap; the `include*` toggles default TRUE for hotels/attractions/restaurants, so we MUST set
 * attractions+restaurants false to get hotels-only. `startUrls`, check-in/out dates (price offers
 * are off + under maintenance), and the paid `leadsEnrichment*` add-ons are intentionally omitted. */
export function buildSearchInput(destination: string, maxResults: number): Record<string, unknown> {
  return {
    query: destination, // location name → the actor scrapes hotels for that location
    maxItemsPerQuery: maxResults, // per-query cap (the real actor's cap key; min 1)
    includeHotels: true,
    includeAttractions: false, // hotels-only (actor defaults attractions/restaurants TRUE)
    includeRestaurants: false,
    includeNearbyResults: false, // keep results to the queried location
    includePriceOffers: false, // no rates at curation time (also "under maintenance" upstream)
    includeAiReviewsSummary: false, // slows runs; not needed for curation
    language: 'en',
    currency: 'USD',
  };
}

function asString(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  // Some actor builds wrap URLs in angle brackets ("<https://…>"); strip them defensively.
  const s = v.trim().replace(/^<(.*)>$/, '$1').trim();
  return s.length > 0 ? s : null;
}

/** A finite float (lat/long) — unlike asInt, does NOT round and accepts negatives. */
function asNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function asInt(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.round(v);
  if (typeof v === 'string') {
    const n = Number(v.replace(/[^0-9.]/g, ''));
    return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
  }
  return null;
}

/** Coerce a raw rating/stars value to the canonical 3 | 4 | 5, else null. */
function asStarRating(v: unknown): 3 | 4 | 5 | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  if (n >= 5) return 5;
  if (n >= 4) return 4;
  if (n >= 3) return 3;
  return null;
}

/** Coerce a raw price-level value → our price_tier enum. Accepts our own enum strings (mock
 * fixtures) AND TripAdvisor's "$"-scale: $/$$ → mid-range, $$$ → luxury, $$$$ → ultra-luxury.
 * (The founder can override per-hotel in curation before publishing.) */
function asPriceTier(v: unknown): (typeof PRICE_TIERS)[number] | null {
  const s = asString(v)?.toLowerCase();
  if (!s) return null;
  if ((PRICE_TIERS as readonly string[]).includes(s)) return s as (typeof PRICE_TIERS)[number];
  const dollars = (s.match(/\$/g) ?? []).length;
  if (dollars >= 4) return 'ultra-luxury';
  if (dollars === 3) return 'luxury';
  if (dollars >= 1) return 'mid-range';
  return null;
}

/** Collect image URLs from a few likely fields (single `image`, `photos[]`, or `images[]`). */
function asImages(item: Record<string, unknown>): string[] {
  const out: string[] = [];
  const single = asString(item.image) ?? asString(item.thumbnail);
  if (single) out.push(single);
  for (const key of ['photos', 'images'] as const) {
    const arr = item[key];
    if (Array.isArray(arr)) for (const p of arr) { const s = asString(p); if (s) out.push(s); }
  }
  return out;
}

/** Map one TripAdvisor-search dataset item → FetchedHotel. Returns null (skip) on a row missing
 * a usable name or failing schema validation, so one bad row never kills the whole fetch. The
 * `destination` is always taken from the caller (the validated enum), never trusted from the row. */
export function mapSearchItem(item: unknown, destination: Destination): FetchedHotel | null {
  if (!item || typeof item !== 'object') return null;
  const row = item as Record<string, unknown>;

  const name = asString(row.name) ?? asString(row.title) ?? asString(row.hotelName);
  if (!name) return null;

  const candidate = {
    name,
    destination,
    tripadvisor_url: asString(row.url) ?? asString(row.tripadvisorUrl) ?? asString(row.webUrl),
    tripadvisor_rank: asInt(row.rankingPosition) ?? asInt(row.rank),
    review_count: asInt(row.numberOfReviews) ?? asInt(row.reviewsCount) ?? asInt(row.review_count),
    google_place_id: null, // a TA search actor does not return a Google place id (see plan: Option A)
    brand: asString(row.brand) ?? asString(row.chain),
    price_tier: asPriceTier(row.priceTier ?? row.priceLevel),
    star_rating: asStarRating(row.hotelClass ?? row.stars ?? row.rating),
    images: asImages(row),
    // Geo — matching inputs for the Google Place-ID resolver (lat/long bias is the strongest key).
    latitude: asNumber(row.latitude),
    longitude: asNumber(row.longitude),
    address: asString(row.address) ?? addressFromObj(row.addressObj),
  };

  const parsed = fetchedHotelSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

/** Build a flat address string from the actor's structured addressObj, when no flat `address`. */
function addressFromObj(obj: unknown): string | null {
  if (!obj || typeof obj !== 'object') return null;
  const a = obj as Record<string, unknown>;
  const parts = [a.street1, a.street2, a.city, a.state, a.postalcode, a.country]
    .map((p) => asString(p))
    .filter(Boolean);
  return parts.length ? parts.join(', ') : null;
}
