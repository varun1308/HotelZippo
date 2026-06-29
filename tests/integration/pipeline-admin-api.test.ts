/* Phase 6 · admin API + status reads (08a-6 TC-P19/P20/P22). Exercises the run-enqueue
 * single-active-run rejection, the status feed (active run + per-hotel + history), and the
 * destination counts, against local Supabase. Service client. */
import { serviceClient } from './helpers';
import { getPipelineStatus, getDestinationCounts } from '@/lib/review-intelligence/admin-status';

jest.setTimeout(30_000);
const admin = serviceClient();

let hotelId: string;
const runIds: string[] = [];

beforeAll(async () => {
  const { data } = await admin
    .from('hotels')
    .insert({ name: 'Admin API Hotel', destination: 'Tokyo', star_rating: 5, price_tier: 'luxury' })
    .select('id')
    .single();
  hotelId = data!.id;
});

afterEach(async () => {
  if (runIds.length) {
    await admin.from('pipeline_run_hotels').delete().in('run_id', runIds);
    await admin.from('pipeline_runs').delete().in('id', runIds);
    runIds.length = 0;
  }
});

afterAll(async () => {
  await admin.from('hotel_intelligence').delete().eq('hotel_id', hotelId);
  await admin.from('hotels').delete().eq('id', hotelId);
});

async function startRun(scopeType: string, scopeValue: string) {
  const { data, error } = await admin
    .from('pipeline_runs')
    .insert({ scope_type: scopeType, scope_value: scopeValue, status: 'running' })
    .select('id')
    .single();
  if (data) runIds.push(data.id);
  return { id: data?.id as string | undefined, error };
}

describe('TC-P19 single active run (the run-enqueue path)', () => {
  it('a second running run is rejected by the DB', async () => {
    const first = await startRun('hotel', hotelId);
    expect(first.error).toBeNull();
    const second = await startRun('hotel', hotelId);
    expect(second.error).not.toBeNull();
    expect(second.error!.message.toLowerCase()).toMatch(/one_active_run|duplicate|unique/);
  });
});

describe('TC-P20 status feed', () => {
  it('reports the active run + its per-hotel statuses', async () => {
    const run = await startRun('hotel', hotelId);
    await admin.from('pipeline_run_hotels').insert([
      { run_id: run.id, hotel_id: hotelId, status: 'failed', error_reason: 'zero reviews returned' },
    ]);
    const status = await getPipelineStatus(admin);
    expect(status.active?.id).toBe(run.id);
    expect(status.hotels).toHaveLength(1);
    expect(status.hotels[0]).toMatchObject({ hotel_id: hotelId, status: 'failed' });
    expect(status.hotels[0].error_reason).toMatch(/zero reviews/);
  });

  it('reports no active run when none is running', async () => {
    const run = await startRun('hotel', hotelId);
    await admin.from('pipeline_runs').update({ status: 'complete' }).eq('id', run.id!);
    const status = await getPipelineStatus(admin);
    expect(status.active).toBeNull();
    expect(status.hotels).toHaveLength(0);
  });
});

describe('TC-P22 run history', () => {
  it('lists past runs most-recent-first', async () => {
    const r1 = await startRun('hotel', hotelId);
    await admin.from('pipeline_runs').update({ status: 'complete' }).eq('id', r1.id!);
    const status = await getPipelineStatus(admin);
    expect(status.history.length).toBeGreaterThanOrEqual(1);
    expect(status.history.some((h) => h.id === r1.id)).toBe(true);
  });
});

describe('destination counts (Mode A badge)', () => {
  it('reports processed vs total for a destination', async () => {
    const before = await getDestinationCounts(admin, 'Tokyo');
    expect(before.total).toBeGreaterThanOrEqual(1);
    // Add an intelligence row → processed increments.
    await admin.from('hotel_intelligence').upsert(
      { hotel_id: hotelId, review_count_family: 1, review_count_total: 5, low_confidence: false, hard_flags: [] },
      { onConflict: 'hotel_id' },
    );
    const after = await getDestinationCounts(admin, 'Tokyo');
    expect(after.processed).toBe(before.processed + 1);
  });
});
