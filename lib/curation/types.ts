/* Curation Tool types + Zod schemas (12a / specs/12a-curation-tool.md).
 * A fetched candidate is staged in curation_hotels, curated, then Publish-to-Hotels
 * upserts approved rows into public.hotels (on name+destination). */
import { z } from 'zod';
import { DESTINATIONS, PRICE_TIERS, STAR_RATINGS } from '@/lib/db/schemas';

export const CURATION_STATUSES = ['pending', 'approved', 'rejected'] as const;
export const FETCH_SOURCES = ['apify', 'playwright', 'manual', 'mock'] as const;

/** Minimum reviews for a hotel to be eligible for approval (12 / 12a rule). */
export const MIN_REVIEWS = 100;

/** A candidate as returned by a fetch source (pre-staging). */
export const fetchedHotelSchema = z.object({
  name: z.string().min(1),
  destination: z.enum(DESTINATIONS),
  tripadvisor_url: z.string().url().nullable().optional(),
  tripadvisor_rank: z.number().int().positive().nullable().optional(),
  review_count: z.number().int().nonnegative().nullable().optional(),
  google_place_id: z.string().nullable().optional(),
  brand: z.string().nullable().optional(),
  price_tier: z.enum(PRICE_TIERS).nullable().optional(),
  star_rating: z.union([z.literal(3), z.literal(4), z.literal(5)]).nullable().optional(),
  images: z.array(z.string()).nullable().optional(),
  // Geo (from the TripAdvisor search actor) — matching inputs for the Google Place-ID resolver.
  latitude: z.number().nullable().optional(),
  longitude: z.number().nullable().optional(),
  address: z.string().nullable().optional(),
});
export type FetchedHotel = z.infer<typeof fetchedHotelSchema>;

/** A staged curation_hotels row (as stored / edited). */
export const curationRowSchema = fetchedHotelSchema.extend({
  id: z.string().uuid(),
  status: z.enum(CURATION_STATUSES),
  fetch_source: z.enum(FETCH_SOURCES).nullable().optional(),
});
export type CurationRow = z.infer<typeof curationRowSchema>;

export interface FetchHotelsResult {
  source: (typeof FETCH_SOURCES)[number];
  hotels: FetchedHotel[];
}
