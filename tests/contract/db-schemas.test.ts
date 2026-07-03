/* Contract tests for the later-phase table Zod schemas (spec 07 action item 3:
 * every table ships a Zod schema + a contract test; migrations 0009–0021).
 * Validates STRUCTURE against representative rows shaped exactly like the migrations
 * (PostgREST serialisation: uuids/timestamps as strings, jsonb as unknown). Pure Zod —
 * no DB, no keys (the cross-DB round-trip lives in tests/integration/schema.test.ts). */
import {
  laterTableSchemas,
  rawReviewPayloadSchema,
  routestackDestinationSchema,
  routestackHotelSchema,
  apifyRunSchema,
  previewSeedSchema,
  rawRoutestackPayloadSchema,
  bookingOrderSchema,
  webhookEventSchema,
  recommendationJobSchema,
  rawReviewSchema,
  pipelineRunHotelSchema,
  hotelIntelligenceSchema,
  type LaterTableName,
} from '@/lib/db/schemas';

const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';
const NOW = '2026-07-03T10:00:00.000Z';

/** One representative row per later-phase table, mirroring its migration's columns. */
const ROWS: Record<LaterTableName, unknown> = {
  // 0009 — untouched Apify actor item
  raw_review_payloads: {
    id: U1,
    hotel_id: U2,
    pipeline_run_id: null,
    source: 'tripadvisor',
    external_id: 'ta-rev-991',
    payload: { title: 'Great kids club', rating: 5 },
    scraped_at: NOW,
  },
  // 0011 — cached RouteStack destination handle
  routestack_destinations: {
    destination: 'Phuket',
    rs_destination_id: '328057',
    rs_destination_type: 'State',
    lat: 7.8804,
    long: 98.3923,
    resolved_at: NOW,
  },
  // 0011 — RouteStack hotel id ↔ hotels row
  routestack_hotels: {
    hotel_id: U1,
    provider: 'routestack',
    rs_hotel_id: 'RS-HOTEL-42',
    rs_hotel_name: 'Anantara Mai Khao Phuket Villas',
    resolved_at: NOW,
  },
  // 0012 — Apify run ledger
  apify_runs: {
    id: U1,
    actor_id: 'maxcopell~tripadvisor',
    purpose: 'ta_reviews',
    scope_type: 'hotel',
    scope_value: U2,
    input: { maxItems: 600 },
    apify_run_id: 'run-abc',
    apify_dataset_id: 'ds-def',
    status: 'succeeded',
    item_count: 412,
    ingested_at: null,
    error: null,
    cost_estimate: 1.23,
    started_at: NOW,
    finished_at: NOW,
  },
  // 0014 — runtime preview-seed latch
  preview_seeds: {
    destination: 'Tokyo',
    status: 'done',
    hotel_count: 8,
    error: null,
    started_at: NOW,
    finished_at: NOW,
  },
  // 0015 — redacted RouteStack call debug log (hotel_id is RS's id STRING, no FK)
  raw_routestack_payloads: {
    id: U1,
    step: 'search_hotels',
    path: '/mcp/hotel/search-hotels',
    request: { destinationId: '328057', checkIn: '2026-08-01' },
    response: { success: true, code: null },
    success: true,
    code: null,
    duration_ms: 1840,
    error: null,
    hotel_id: 'RS-HOTEL-42',
    trace_id: '4bf92f3577b34da6a3ce929d0e0e4736',
    created_at: NOW,
  },
  // 0016 — booking order lifecycle row (pending → tracked)
  booking_orders: {
    id: U1,
    user_id: U2,
    user_email: 'raj@example.com',
    hotel_id: 'RS-HOTEL-42',
    hotel_name: 'Anantara Mai Khao Phuket Villas',
    destination: 'Phuket',
    check_in: '2026-08-01',
    check_out: '2026-08-05',
    correlation_id: 'corr-123',
    currency: 'USD',
    rs_order_id: 'RSA-1234567890',
    order_status: 'CONFIRMED',
    payment_status: 'COMPLETED',
    last_event: 'BOOKING_SUCCESS',
    billing_email: 'raj@example.com',
    price: 100,
    linked: true,
    created_at: NOW,
    updated_at: NOW,
  },
  // 0016 — inbound-webhook audit log (payload already REDACTED)
  webhook_events: {
    id: U1,
    source: 'routestack',
    event: 'BOOKING_SUCCESS',
    rs_order_id: 'RSA-1234567890',
    booking_order_id: U2,
    matched: true,
    payload: { event: 'BOOKING_SUCCESS', billing_name: '[redacted]', billing_email: '[redacted]' },
    received_at: NOW,
  },
  // 0018 + 0019 — async-assembly job ledger
  recommendation_jobs: {
    id: U1,
    user_id: U2,
    trip_brief_id: null,
    conversation_id: 'conv-abc123',
    destination: 'Phuket',
    input_hash: 'a'.repeat(32),
    input: { family_profile: { budget_tier: 'comfort' }, trip_brief: { destination: 'Phuket' } },
    status: 'succeeded',
    stage: 'done',
    result: { top_pick: { hotel_id: U2 } },
    error_kind: null,
    attempts: 1,
    created_at: NOW,
    started_at: NOW,
    finished_at: NOW,
  },
};

describe('contract — every later-phase table row parses through its Zod schema', () => {
  it.each(Object.keys(laterTableSchemas) as LaterTableName[])('%s parses', (table) => {
    const parsed = laterTableSchemas[table].safeParse(ROWS[table]);
    if (!parsed.success) throw new Error(`${table}: ${parsed.error.message}`);
    expect(parsed.success).toBe(true);
  });
});

describe('contract — nullable lifecycle variants parse', () => {
  it('raw_review_payloads: null external_id (no dedup handle) parses', () => {
    const row = { ...(ROWS.raw_review_payloads as Record<string, unknown>), external_id: null };
    expect(rawReviewPayloadSchema.safeParse(row).success).toBe(true);
  });

  it('booking_orders: the freshly-written PENDING row (unlinked, no order yet) parses', () => {
    const row = {
      ...(ROWS.booking_orders as Record<string, unknown>),
      rs_order_id: null,
      order_status: null,
      payment_status: null,
      last_event: null,
      billing_email: null,
      price: null,
      linked: false,
    };
    expect(bookingOrderSchema.safeParse(row).success).toBe(true);
  });

  it('webhook_events: an UNMATCHED delivery (no order, matched=false) parses', () => {
    const row = {
      ...(ROWS.webhook_events as Record<string, unknown>),
      rs_order_id: null,
      booking_order_id: null,
      matched: false,
    };
    expect(webhookEventSchema.safeParse(row).success).toBe(true);
  });

  it('recommendation_jobs: a FAILED budget_mismatch job (0019 variant) parses', () => {
    const row = {
      ...(ROWS.recommendation_jobs as Record<string, unknown>),
      status: 'failed',
      stage: 'writing',
      error_kind: 'budget_mismatch',
      result: { error: 'budget_mismatch', reason: 'only ultra-luxury', available_tiers: ['ultra-luxury'] },
    };
    expect(recommendationJobSchema.safeParse(row).success).toBe(true);
  });

  it('preview_seeds: a RUNNING latch (no finish yet) parses', () => {
    const row = {
      ...(ROWS.preview_seeds as Record<string, unknown>),
      status: 'running',
      hotel_count: null,
      finished_at: null,
    };
    expect(previewSeedSchema.safeParse(row).success).toBe(true);
  });

  it('raw_routestack_payloads: a transport-failure row (success unknown) parses', () => {
    const row = {
      ...(ROWS.raw_routestack_payloads as Record<string, unknown>),
      response: null,
      success: null,
      code: null,
      error: 'fetch failed',
    };
    expect(rawRoutestackPayloadSchema.safeParse(row).success).toBe(true);
  });
});

describe('contract — enum/CHECK-constraint violations are rejected', () => {
  it('routestack_destinations: a non-enum destination is rejected', () => {
    const row = { ...(ROWS.routestack_destinations as Record<string, unknown>), destination: 'Bangkok' };
    expect(routestackDestinationSchema.safeParse(row).success).toBe(false);
  });

  it('apify_runs: an unknown status is rejected', () => {
    const row = { ...(ROWS.apify_runs as Record<string, unknown>), status: 'archived' };
    expect(apifyRunSchema.safeParse(row).success).toBe(false);
  });

  it('preview_seeds: an unknown latch status is rejected', () => {
    const row = { ...(ROWS.preview_seeds as Record<string, unknown>), status: 'queued' };
    expect(previewSeedSchema.safeParse(row).success).toBe(false);
  });

  it('recommendation_jobs: an unknown error_kind is rejected', () => {
    const row = { ...(ROWS.recommendation_jobs as Record<string, unknown>), error_kind: 'oops' };
    expect(recommendationJobSchema.safeParse(row).success).toBe(false);
  });

  it('routestack_hotels: a non-uuid hotel_id is rejected', () => {
    const row = { ...(ROWS.routestack_hotels as Record<string, unknown>), hotel_id: 'RS-HOTEL-42' };
    expect(routestackHotelSchema.safeParse(row).success).toBe(false);
  });
});

describe('contract — post-review core-table columns (migrations 0019–0021)', () => {
  it('raw_reviews: the generated anon_text_hash column parses (present and absent)', () => {
    const base = {
      id: U1,
      hotel_id: U2,
      pipeline_run_id: null,
      source: 'google',
      review_date: null,
      reviewer_name: null,
      review_text: 'Anonymous but useful review of the pool area.',
      rating: 4,
      is_family: true,
      is_indian: null,
      scraped_at: NOW,
    };
    expect(rawReviewSchema.safeParse(base).success).toBe(true); // inserts never supply it
    expect(
      rawReviewSchema.safeParse({ ...base, anon_text_hash: 'd41d8cd98f00b204e9800998ecf8427e' }).success,
    ).toBe(true);
  });

  it('pipeline_run_hotels: scrape_gaps + review_queue (0021) parse', () => {
    const row = {
      id: U1,
      run_id: U2,
      hotel_id: U2,
      status: 'complete',
      error_reason: null,
      reviews_scraped: 118,
      started_at: NOW,
      finished_at: NOW,
      scrape_gaps: [{ source: 'google', error: 'actor timeout' }],
      review_queue: true,
    };
    expect(pipelineRunHotelSchema.safeParse(row).success).toBe(true);
  });

  it('hotel_intelligence: the confidence gate column (0021) parses and rejects junk', () => {
    const row = {
      id: U1,
      hotel_id: U2,
      rooms_summary: 'Families consistently report spacious rooms.',
      facilities_summary: null,
      food_summary: null,
      location_summary: null,
      hard_flags: [],
      conflicting_signals: null,
      family_signal_strength: null,
      supporting_phrases: null,
      indian_food_signal: null,
      review_count_family: 12,
      review_count_total: 118,
      last_refreshed: NOW,
      low_confidence: false,
      confidence: 'medium',
    };
    expect(hotelIntelligenceSchema.safeParse(row).success).toBe(true);
    expect(hotelIntelligenceSchema.safeParse({ ...row, confidence: 'shaky' }).success).toBe(false);
  });
});
