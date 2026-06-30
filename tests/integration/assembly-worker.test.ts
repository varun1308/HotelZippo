/* Assembly worker route + recommendation_jobs RLS (specs/03c) against LOCAL Supabase.
 *
 * Proves the WORKER ROUTE logic in isolation from hotel-seed contents: (1) POST /api/assembly/run claims
 * a pending job and drives it to `succeeded` with the hydrated result persisted; (2) a duplicate kick is
 * a no-op (idempotent claim); (3) a no-eligible-hotels outcome → failed; (4) a thrown model error →
 * failed(model_failed); (5) owner-read RLS — user A cannot SELECT user B's job.
 *
 * `runAssembly` is MOCKED so the test is independent of which hotels are seeded (CI's integration DB has
 * NO hotel rows → the real runAssembly would always short-circuit to no_eligible_hotels before the model
 * mock). The job ledger writes still hit the REAL local DB. `hydrateHotels` passes through (no hotels to
 * hydrate in the mocked result). Key-free (no Anthropic). */
jest.mock('@/lib/recommendations/run-assembly', () => ({
  runAssembly: jest.fn(),
}));
jest.mock('@/lib/chat/agent', () => ({
  hydrateHotels: jest.fn(async (_c: unknown, a: unknown) => a),
}));

import { POST } from '@/app/api/assembly/run/route';
import { runAssembly } from '@/lib/recommendations/run-assembly';
import { AssemblyError } from '@/lib/recommendations/assemble';
import { createJob, loadJob } from '@/lib/recommendations/job-ledger';
import { serviceClient, createTestUser, deleteTestUser } from './helpers';

jest.setTimeout(30_000);
const admin = serviceClient();
const mockAssemble = runAssembly as unknown as jest.Mock;

const HASH = `worker-test-${Date.now()}`;
const SUCCESS_ASSEMBLY = {
  top_pick: { hotel_id: 'h-top', hotel_name: 'Mock Top', summary: 's', why_for_you: 'w', hard_flags: [] },
  other_picks: [],
  destination: 'Phuket',
};

function post(jobId: string) {
  return POST(new Request('http://localhost/api/assembly/run', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jobId }),
  }));
}

async function cleanup() {
  await admin.from('recommendation_jobs').delete().like('input_hash', 'worker-test-%');
}
beforeEach(() => mockAssemble.mockReset());
afterAll(cleanup);

describe('POST /api/assembly/run', () => {
  it('claims a pending job and drives it to succeeded with the hydrated result', async () => {
    mockAssemble.mockResolvedValue(SUCCESS_ASSEMBLY);
    const job = await createJob(admin, {
      destination: 'Phuket',
      inputHash: `${HASH}-ok`,
      input: { family_profile: { budget_tier: 'comfort' }, trip_brief: { destination: 'Phuket' } },
    });

    const res = await post(job.id);
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe('succeeded');

    const final = await loadJob(admin, job.id);
    expect(final?.status).toBe('succeeded');
    expect(final?.stage).toBe('done');
    expect((final?.result as { top_pick: { hotel_id: string } }).top_pick.hotel_id).toBe('h-top');
  });

  it('is idempotent — a second kick of an already-claimed job is a no-op', async () => {
    mockAssemble.mockResolvedValue(SUCCESS_ASSEMBLY);
    const job = await createJob(admin, { destination: 'Bali', inputHash: `${HASH}-dup`, input: { trip_brief: { destination: 'Bali' } } });
    await post(job.id); // runs it → succeeded
    mockAssemble.mockClear();
    const res2 = await post(job.id); // job no longer pending → claim returns null → skipped
    expect(res2.status).toBe(200);
    expect((await res2.json()).skipped).toBe('succeeded');
    expect(mockAssemble).not.toHaveBeenCalled();
  });

  it('a no-eligible-hotels outcome → failed(no_eligible_hotels)', async () => {
    mockAssemble.mockResolvedValue({ error: 'no_eligible_hotels', reason: 'none' });
    const job = await createJob(admin, { destination: 'Tokyo', inputHash: `${HASH}-none`, input: { trip_brief: { destination: 'Tokyo' } } });
    const res = await post(job.id);
    expect((await res.json()).error_kind).toBe('no_eligible_hotels');
    const final = await loadJob(admin, job.id);
    expect(final?.status).toBe('failed');
    expect(final?.errorKind).toBe('no_eligible_hotels');
  });

  it('a thrown model error → failed(model_failed)', async () => {
    mockAssemble.mockRejectedValue(new AssemblyError('boom', 'model_call_failed'));
    const job = await createJob(admin, { destination: 'Phuket', inputHash: `${HASH}-fail`, input: { trip_brief: { destination: 'Phuket' } } });
    const res = await post(job.id);
    expect((await res.json()).error_kind).toBe('model_failed');
    const final = await loadJob(admin, job.id);
    expect(final?.status).toBe('failed');
  });

  it('400s without a jobId', async () => {
    const res = await POST(new Request('http://localhost/api/assembly/run', { method: 'POST', body: '{}' }));
    expect(res.status).toBe(400);
  });
});

describe('recommendation_jobs owner-read RLS', () => {
  it('user A cannot SELECT user B job', async () => {
    const a = await createTestUser('asm-a');
    const b = await createTestUser('asm-b');
    try {
      // B owns a job (service insert with B's user_id).
      const { data: bJob } = await admin
        .from('recommendation_jobs')
        .insert({ user_id: b.id, destination: 'Phuket', input_hash: `${HASH}-rls`, input: {}, status: 'pending', stage: 'queued' })
        .select('id')
        .single();

      // A reads via their RLS-scoped client → zero rows (owner-read keys on auth.uid()).
      const { data: aSees } = await a.client.from('recommendation_jobs').select('id').eq('id', bJob!.id);
      expect(aSees ?? []).toHaveLength(0);

      // B reads their own → visible.
      const { data: bSees } = await b.client.from('recommendation_jobs').select('id').eq('id', bJob!.id);
      expect(bSees).toHaveLength(1);
    } finally {
      await deleteTestUser(a.id);
      await deleteTestUser(b.id);
    }
  });
});
