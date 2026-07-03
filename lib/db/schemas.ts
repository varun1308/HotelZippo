/* Zod schemas mirroring the database tables (canonical: Notion 07 / docs/data-model.md).
 * These are the contract-test source for the Phase 1 gate "all 10 tables schema-valid"
 * (specs/15-test-strategy.md) and are reused by the seed + recommendation contracts. */
import { z } from 'zod';

export const DESTINATIONS = ['Phuket', 'Singapore', 'Tokyo', 'Orlando', 'Bali'] as const;
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
  // migration 0021 — the synthesis gate's overall outcome (nullable: seed rows predate the gate);
  // optional so narrow selects (e.g. the consumption query) still parse.
  confidence: z.enum(['high', 'medium', 'low']).nullable().optional(),
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
  // migration 0021 — partial-scrape gaps ([{source, error}]) + the medium-confidence review queue.
  scrape_gaps: z.unknown().nullable().optional(),
  review_queue: z.boolean().optional(),
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
  // migration 0020 — stored GENERATED column disambiguating anonymous+undated reviews in the
  // NULLS-NOT-DISTINCT dedup index (md5(review_text) when reviewer_name AND review_date are
  // both null, else ''). Optional: inserts never supply it.
  anon_text_hash: z.string().optional(),
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

// --- later-phase tables (additive migrations 0009–0021; spec 07 §Later-phase tables) ---
// Pragmatic row-shape schemas (spec 07 action item 3: every table ships a Zod schema + a
// contract test). Columns mirror the migrations exactly; jsonb columns stay z.unknown()
// like the core schemas. NOTE: the job-ledger / webhook / booking libs keep their own
// domain types today — wiring them through these schemas is a future step.

/** raw_review_payloads (migration 0009) — untouched Apify actor items, service-role only. */
export const rawReviewPayloadSchema = z.object({
  id: uuid,
  hotel_id: uuid,
  pipeline_run_id: uuid.nullable(),
  source: z.string(), // tripadvisor | google (no DB check constraint)
  external_id: z.string().nullable(),
  payload: z.unknown(),
  scraped_at: ts,
});

/** routestack_destinations (migration 0011) — cached stable RouteStack destination handles. */
export const routestackDestinationSchema = z.object({
  destination: z.enum(DESTINATIONS),
  rs_destination_id: z.string(),
  rs_destination_type: z.string().nullable(),
  lat: z.number(),
  long: z.number(),
  resolved_at: ts,
});

/** routestack_hotels (migration 0011) — RouteStack hotel id ↔ our hotels row (PK hotel_id+provider). */
export const routestackHotelSchema = z.object({
  hotel_id: uuid,
  provider: z.string(), // default 'routestack'
  rs_hotel_id: z.string(),
  rs_hotel_name: z.string().nullable(),
  resolved_at: ts,
});

export const APIFY_RUN_PURPOSES = ['curation_search', 'ta_reviews', 'google_reviews'] as const;
export const APIFY_RUN_STATUSES = ['pending', 'running', 'succeeded', 'failed', 'ingested'] as const;

/** apify_runs (migration 0012) — the Apify run ledger (see 12h). */
export const apifyRunSchema = z.object({
  id: uuid,
  actor_id: z.string(),
  purpose: z.enum(APIFY_RUN_PURPOSES),
  scope_type: z.enum(['destination', 'hotel']),
  scope_value: z.string(),
  input: z.unknown(),
  apify_run_id: z.string().nullable(),
  apify_dataset_id: z.string().nullable(),
  status: z.enum(APIFY_RUN_STATUSES),
  item_count: z.number().int().nullable(),
  ingested_at: ts.nullable(),
  error: z.string().nullable(),
  cost_estimate: z.number().nullable(),
  started_at: ts,
  finished_at: ts.nullable(),
});

/** preview_seeds (migration 0014) — per-destination runtime-seed latch (12i-C), service-role only. */
export const previewSeedSchema = z.object({
  destination: z.enum(DESTINATIONS),
  status: z.enum(['running', 'done', 'failed']),
  hotel_count: z.number().int().nullable(),
  error: z.string().nullable(),
  started_at: ts,
  finished_at: ts.nullable(),
});

export const ROUTESTACK_PAYLOAD_STEPS = [
  'search_destinations',
  'search_hotels',
  'get_hotel_details_and_rates',
  'revalidate',
  'get_payment_url',
] as const;

/** raw_routestack_payloads (migration 0015) — redacted RouteStack call debug log, service-role only.
 * `step` has no DB check constraint; the canonical values are ROUTESTACK_PAYLOAD_STEPS. `hotel_id`
 * is RouteStack's id STRING (deliberately not a uuid FK). */
export const rawRoutestackPayloadSchema = z.object({
  id: uuid,
  step: z.string(),
  path: z.string(),
  request: z.unknown().nullable(),
  response: z.unknown().nullable(),
  success: z.boolean().nullable(),
  code: z.number().int().nullable(),
  duration_ms: z.number().int().nullable(),
  error: z.string().nullable(),
  hotel_id: z.string().nullable(),
  trace_id: z.string().nullable(),
  created_at: ts,
});

/** booking_orders (migration 0016) — one row per booking; pending at handoff, tracked on webhook
 * match (10d). Owner-READ RLS; writes via service role. `hotel_id` is RouteStack's id string. */
export const bookingOrderSchema = z.object({
  id: uuid,
  user_id: uuid.nullable(),
  user_email: z.string().nullable(),
  hotel_id: z.string().nullable(),
  hotel_name: z.string().nullable(),
  destination: z.string().nullable(),
  check_in: z.string().nullable(), // date serialised YYYY-MM-DD
  check_out: z.string().nullable(),
  correlation_id: z.string().nullable(),
  currency: z.string().nullable(),
  rs_order_id: z.string().nullable(), // UNIQUE — redelivered events upsert
  order_status: z.string().nullable(), // INCOMPLETE | CONFIRMED | CANCELLED (latest)
  payment_status: z.string().nullable(), // AUTHORIZED | COMPLETED | INCOMPLETE | REFUNDED (latest)
  last_event: z.string().nullable(),
  billing_email: z.string().nullable(),
  price: z.number().nullable(),
  linked: z.boolean(),
  created_at: ts,
  updated_at: ts,
});

/** webhook_events (migration 0016) — append-only inbound-webhook audit log (REDACTED payload),
 * service-role only. */
export const webhookEventSchema = z.object({
  id: uuid,
  source: z.string(), // default 'routestack'
  event: z.string(),
  rs_order_id: z.string().nullable(),
  booking_order_id: uuid.nullable(),
  matched: z.boolean(),
  payload: z.unknown(),
  received_at: ts,
});

export const RECOMMENDATION_JOB_STATUSES = ['pending', 'running', 'succeeded', 'failed'] as const;
export const RECOMMENDATION_JOB_STAGES = [
  'queued',
  'finding_hotels',
  'checking_intelligence',
  'writing',
  'done',
] as const;
export const RECOMMENDATION_JOB_ERROR_KINDS = [
  'no_eligible_hotels',
  'budget_mismatch',
  'model_failed',
  'timeout',
  'unknown',
] as const;

/** recommendation_jobs (migrations 0018 + 0019) — the async-assembly job ledger (03c).
 * Owner-READ RLS; worker writes via service role. Mirrors lib/recommendations/job-ledger.ts. */
export const recommendationJobSchema = z.object({
  id: uuid,
  user_id: uuid.nullable(),
  trip_brief_id: uuid.nullable(),
  conversation_id: z.string().nullable(), // migration 0019 — specs/14 correlation id
  destination: z.string(),
  input_hash: z.string(),
  input: z.unknown(),
  status: z.enum(RECOMMENDATION_JOB_STATUSES),
  stage: z.enum(RECOMMENDATION_JOB_STAGES),
  result: z.unknown().nullable(),
  error_kind: z.enum(RECOMMENDATION_JOB_ERROR_KINDS).nullable(),
  attempts: z.number().int().nonnegative(),
  created_at: ts,
  started_at: ts.nullable(),
  finished_at: ts.nullable(),
});

/** The later-phase tables (additive migrations), keyed by table name — drives the
 * db-schemas contract test (spec 07 action item 3). */
export const laterTableSchemas = {
  raw_review_payloads: rawReviewPayloadSchema,
  routestack_destinations: routestackDestinationSchema,
  routestack_hotels: routestackHotelSchema,
  apify_runs: apifyRunSchema,
  preview_seeds: previewSeedSchema,
  raw_routestack_payloads: rawRoutestackPayloadSchema,
  booking_orders: bookingOrderSchema,
  webhook_events: webhookEventSchema,
  recommendation_jobs: recommendationJobSchema,
} as const;

export type LaterTableName = keyof typeof laterTableSchemas;

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
