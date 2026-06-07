/* Phase 6 · worker end-to-end (08a-6): processRun drives hotels through the full chain
 * against local Supabase, with an injected fixture synthesis model (key-free) and the mock
 * scrape path. Covers: e2e completion, per-hotel status transitions, hotel_intelligence
 * written + confidence gate, zero-reviews→failed+continue (TC-P1), single-active-run
 * (TC-P19), and per-hotel retry reusing the row (TC-P21). */
import { serviceClient } from './helpers';
import { processRun, processActiveRun, processHotel, type WorkerDeps } from '@/lib/review-intelligence/worker';
import type { SynthesisOutput } from '@/lib/review-intelligence/synthesis';

jest.setTimeout(40_000);
const admin = serviceClient();

const SYNTH: SynthesisOutput = {
  confidence: { overall: 'high', rooms: 'strong', facilities: 'strong', food: 'strong', location: 'strong' },
  rooms_summary: 'Spacious, clean family rooms.',
  facilities_summary: 'Great kids club and pool.',
  food_summary: 'Generous breakfast.',
  location_summary: 'Calm beach.',
  hard_flags: [],
  conflicting_signals: { rooms: 'No conflicting signals detected.', facilities: 'No conflicting signals detected.', food: 'No conflicting signals detected.', location: 'No conflicting signals detected.' },
  family_signal_strength: { rooms: 'strong', facilities: 'strong', food: 'strong', location: 'strong' },
  supporting_phrases: { rooms: [], facilities: [], food: [], location: [] },
  indian_food_signal: 'No reviews from Indian guests found for this hotel.',
  review_count_family: 1,
  review_count_total: 2,
};

// Deterministic deps: fixture synthesis model, no inter-hotel delay, fixed clock so the
// mock fixtures' 2026 dates pass the 12-month filter.
const deps: WorkerDeps = {
  synth: { callModel: async () => JSON.stringify(SYNTH), systemPrompt: 'stub' },
  interHotelDelayMs: 0,
  now: () => new Date('2026-06-05T00:00:00Z'),
};

let hotelA: string;
let hotelZeroReviews: string;

beforeAll(async () => {
  const { data: a } = await admin
    .from('hotels')
    .insert({ name: 'Worker Hotel A', destination: 'Bali', star_rating: 5, price_tier: 'luxury' })
    .select('id')
    .single();
  hotelA = a!.id;
  // A hotel with NO matching fixture file → zero reviews → TC-P1 failed path.
  const { data: z } = await admin
    .from('hotels')
    .insert({ name: 'Worker Hotel No Fixture', destination: 'Bali', star_rating: 4, price_tier: 'luxury' })
    .select('id')
    .single();
  hotelZeroReviews = z!.id;
});

afterAll(async () => {
  await admin.from('raw_reviews').delete().in('hotel_id', [hotelA, hotelZeroReviews]);
  await admin.from('raw_review_payloads').delete().in('hotel_id', [hotelA, hotelZeroReviews]);
  await admin.from('hotel_intelligence').delete().in('hotel_id', [hotelA, hotelZeroReviews]);
  await admin.from('pipeline_run_hotels').delete().in('hotel_id', [hotelA, hotelZeroReviews]);
  // pipeline_runs cleaned per-test below; sweep any stragglers for these scopes.
  await admin.from('pipeline_runs').delete().in('scope_value', [hotelA, hotelZeroReviews]);
  await admin.from('hotels').delete().in('id', [hotelA, hotelZeroReviews]);
});

async function newRun(scopeValue: string, scopeType = 'hotel'): Promise<string> {
  const { data } = await admin
    .from('pipeline_runs')
    .insert({ scope_type: scopeType, scope_value: scopeValue, status: 'running' })
    .select('id')
    .single();
  return data!.id;
}

describe('pipeline worker — single hotel', () => {
  it('processes a hotel end-to-end → complete, hotel_intelligence written', async () => {
    const runId = await newRun(hotelA);
    try {
      const summary = await processRun(admin, runId, deps);
      expect(summary).toMatchObject({ total: 1, complete: 1, failed: 0 });

      const { data: prh } = await admin
        .from('pipeline_run_hotels')
        .select('status, reviews_scraped')
        .eq('run_id', runId)
        .eq('hotel_id', hotelA)
        .single();
      expect(prh!.status).toBe('complete');
      expect(prh!.reviews_scraped).toBe(2);

      const { data: intel } = await admin
        .from('hotel_intelligence')
        .select('rooms_summary, low_confidence')
        .eq('hotel_id', hotelA)
        .single();
      expect(intel!.rooms_summary).toContain('family rooms');
      expect(intel!.low_confidence).toBe(false); // high confidence → gate publishes

      const { data: rr } = await admin.from('raw_reviews').select('id').eq('hotel_id', hotelA);
      expect((rr ?? []).length).toBe(2);

      // Raw payloads banked for re-map (mock fixture → 2 items, even on the key-free path).
      const { data: pl } = await admin
        .from('raw_review_payloads')
        .select('id, source, payload')
        .eq('hotel_id', hotelA);
      expect((pl ?? []).length).toBe(2);
      expect((pl ?? []).every((p) => p.payload != null)).toBe(true);

      // The run itself is finalised complete.
      const { data: run } = await admin.from('pipeline_runs').select('status').eq('id', runId).single();
      expect(run!.status).toBe('complete');
    } finally {
      await admin.from('pipeline_runs').delete().eq('id', runId);
    }
  });

  it('TC-P1 zero reviews → hotel failed with reason, run continues', async () => {
    const runId = await newRun(hotelZeroReviews);
    try {
      const summary = await processRun(admin, runId, deps);
      expect(summary).toMatchObject({ total: 1, complete: 0, failed: 1 });
      const { data: prh } = await admin
        .from('pipeline_run_hotels')
        .select('status, error_reason')
        .eq('run_id', runId)
        .eq('hotel_id', hotelZeroReviews)
        .single();
      expect(prh!.status).toBe('failed');
      expect(prh!.error_reason).toMatch(/zero reviews/i);
      // No intelligence written.
      const { data: intel } = await admin.from('hotel_intelligence').select('hotel_id').eq('hotel_id', hotelZeroReviews);
      expect(intel ?? []).toHaveLength(0);
    } finally {
      await admin.from('pipeline_runs').delete().eq('id', runId);
    }
  });

  it('TC-P21 per-hotel retry reuses the same status row (no duplicate)', async () => {
    const runId = await newRun(hotelA);
    try {
      await processHotel(admin, runId, { id: hotelA, name: 'Worker Hotel A', destination: 'Bali', tripadvisor_url: null, google_place_id: null }, deps);
      await processHotel(admin, runId, { id: hotelA, name: 'Worker Hotel A', destination: 'Bali', tripadvisor_url: null, google_place_id: null }, deps);
      const { data } = await admin.from('pipeline_run_hotels').select('id').eq('run_id', runId).eq('hotel_id', hotelA);
      expect(data).toHaveLength(1); // upsert on (run_id, hotel_id) — one row, not two
    } finally {
      await admin.from('pipeline_run_hotels').delete().eq('run_id', runId);
      await admin.from('pipeline_runs').delete().eq('id', runId);
    }
  });
});

describe('TC-P19 single active run (DB-enforced)', () => {
  it('a second running run is rejected by the one_active_run index', async () => {
    const runId = await newRun(hotelA);
    try {
      // Inserting a second status='running' row must violate the partial unique index.
      const { error } = await admin
        .from('pipeline_runs')
        .insert({ scope_type: 'hotel', scope_value: hotelA, status: 'running' });
      expect(error).not.toBeNull();
      expect(error!.message.toLowerCase()).toMatch(/one_active_run|duplicate|unique/);
    } finally {
      await admin.from('pipeline_runs').delete().eq('id', runId);
    }
  });

  it('processActiveRun picks up the running run and finalises it', async () => {
    const runId = await newRun(hotelA);
    try {
      const res = await processActiveRun(admin, deps);
      expect(res?.runId).toBe(runId);
      const { data: run } = await admin.from('pipeline_runs').select('status').eq('id', runId).single();
      expect(run!.status).toBe('complete');
      // Now no run is active.
      expect(await processActiveRun(admin, deps)).toBeNull();
    } finally {
      await admin.from('pipeline_run_hotels').delete().eq('run_id', runId);
      await admin.from('raw_reviews').delete().eq('hotel_id', hotelA);
      await admin.from('pipeline_runs').delete().eq('id', runId);
    }
  });
});
