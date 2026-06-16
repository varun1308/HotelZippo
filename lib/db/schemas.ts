/* Zod schemas mirroring the database tables (canonical: Notion 07 / docs/data-model.md).
 * These are the contract-test source for the Phase 1 gate "all 10 tables schema-valid"
 * (specs/15-test-strategy.md) and are reused by the seed + recommendation contracts. */
import { z } from 'zod';

export const DESTINATIONS = ['Phuket', 'Hong Kong', 'Singapore', 'Maldives', 'Bali'] as const;
export const BUDGET_TIERS = ['value', 'comfort', 'luxury'] as const;
export const PRICE_TIERS = ['mid-range', 'luxury', 'ultra-luxury'] as const;
export const STAR_RATINGS = [3, 4, 5] as const;
export const FLAG_SEVERITIES = ['moderate', 'severe'] as const;
export const SIGNAL_STRENGTHS = ['strong', 'thin', 'none'] as const;

const uuid = z.string().uuid();
const ts = z.string(); // timestamptz serialised as ISO string from PostgREST

// --- shared sub-schemas ----------------------------------------------------
export const hardFlagSchema = z.object({
  category: z.string(),
  description: z.string(),
  severity: z.enum(FLAG_SEVERITIES),
  review_evidence_count: z.number().int().nonnegative().optional(),
});

const categoryRecord = <T extends z.ZodTypeAny>(v: T) =>
  z.object({ rooms: v, facilities: v, food: v, location: v });

// --- core tables (10) ------------------------------------------------------
export const userSchema = z.object({
  id: uuid,
  email: z.string().email().nullable(),
  created_at: ts,
});

export const familyProfileSchema = z.object({
  id: uuid,
  user_id: uuid,
  name: z.string().nullable(),
  hometown: z.string().nullable(),
  family_members: z.unknown().nullable(),
  food_preferences: z.array(z.string()).nullable(),
  budget_tier: z.enum(BUDGET_TIERS).nullable(),
  brand_preferences: z.array(z.string()).nullable(),
  freestyle_notes: z.string().nullable(),
  created_at: ts,
  updated_at: ts,
});

export const tripBriefSchema = z.object({
  id: uuid,
  user_id: uuid,
  destination: z.enum(DESTINATIONS).nullable(),
  travel_dates: z.unknown().nullable(),
  trip_type: z.string().nullable(),
  focus_areas: z.array(z.string()).nullable(),
  pre_shortlisted_hotels: z.array(z.string()).nullable(),
  evaluate_only: z.boolean(),
  created_at: ts,
});

export const hotelSchema = z.object({
  id: uuid,
  name: z.string(),
  destination: z.enum(DESTINATIONS),
  area: z.string().nullable(),
  star_rating: z.union([z.literal(3), z.literal(4), z.literal(5)]).nullable(),
  brand: z.string().nullable(),
  tripadvisor_url: z.string().nullable(),
  google_place_id: z.string().nullable(),
  images: z.array(z.string()).nullable(),
  price_tier: z.enum(PRICE_TIERS).nullable(),
  source: z.enum(['curated', 'preview']).default('curated'), // 12i — provenance tier (migration 0013)
  created_at: ts,
});

export const hotelIntelligenceSchema = z.object({
  id: uuid,
  hotel_id: uuid,
  rooms_summary: z.string().nullable(),
  facilities_summary: z.string().nullable(),
  food_summary: z.string().nullable(),
  location_summary: z.string().nullable(),
  hard_flags: z.array(hardFlagSchema),
  conflicting_signals: z.unknown().nullable(),
  family_signal_strength: categoryRecord(z.enum(SIGNAL_STRENGTHS)).nullable(),
  supporting_phrases: z.unknown().nullable(),
  indian_food_signal: z.string().nullable(),
  review_count_family: z.number().int().nonnegative(),
  review_count_total: z.number().int().nonnegative(),
  last_refreshed: ts.nullable(),
  low_confidence: z.boolean(),
});

export const sessionSchema = z.object({
  id: uuid,
  user_id: uuid,
  session_summary: z.string().nullable(),
  last_active: ts,
  trip_brief_id: uuid.nullable(),
});

export const shortlistSchema = z.object({
  id: uuid,
  user_id: uuid,
  trip_brief_id: uuid.nullable(),
  hotel_ids: z.array(uuid),
  share_token: z.string().nullable(),
  created_at: ts,
});

export const pipelineRunSchema = z.object({
  id: uuid,
  scope_type: z.string(),
  scope_value: z.string(),
  status: z.string(),
  hotels_total: z.number().int().nullable(),
  hotels_complete: z.number().int(),
  hotels_failed: z.number().int(),
  started_at: ts,
  finished_at: ts.nullable(),
});

export const pipelineRunHotelSchema = z.object({
  id: uuid,
  run_id: uuid.nullable(),
  hotel_id: uuid.nullable(),
  status: z.string(),
  error_reason: z.string().nullable(),
  reviews_scraped: z.number().int().nullable(),
  started_at: ts.nullable(),
  finished_at: ts.nullable(),
});

export const rawReviewSchema = z.object({
  id: uuid,
  hotel_id: uuid,
  pipeline_run_id: uuid.nullable(),
  source: z.string(),
  review_date: z.string().nullable(),
  reviewer_name: z.string().nullable(),
  review_text: z.string().nullable(),
  rating: z.number().int().nullable(),
  is_family: z.boolean().nullable(),
  is_indian: z.boolean().nullable(),
  scraped_at: ts,
});

// --- staging (not part of the core 10) -------------------------------------
export const curationHotelSchema = z.object({
  id: uuid,
  name: z.string(),
  destination: z.string(),
  tripadvisor_url: z.string().nullable(),
  tripadvisor_rank: z.number().int().nullable(),
  review_count: z.number().int().nullable(),
  google_place_id: z.string().nullable(),
  brand: z.string().nullable(),
  price_tier: z.string().nullable(),
  star_rating: z.number().int().nullable(),
  images: z.array(z.string()).nullable(),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
  address: z.string().nullable(),
  status: z.string(),
  fetch_source: z.string().nullable(),
  fetched_at: ts,
  updated_at: ts,
});

/** The 10 core tables, keyed by table name — drives the Phase 1 schema-valid gate. */
export const coreTableSchemas = {
  users: userSchema,
  family_profiles: familyProfileSchema,
  trip_briefs: tripBriefSchema,
  hotels: hotelSchema,
  hotel_intelligence: hotelIntelligenceSchema,
  sessions: sessionSchema,
  shortlists: shortlistSchema,
  pipeline_runs: pipelineRunSchema,
  pipeline_run_hotels: pipelineRunHotelSchema,
  raw_reviews: rawReviewSchema,
} as const;

export type CoreTableName = keyof typeof coreTableSchemas;
