/* run-assembly preview fallback (12i-B): when there's no review intelligence for a destination,
 * fall back to preview hotels if any exist; else the existing no_eligible_hotels error. We mock the
 * three collaborators (query, preview, assemble) to test ONLY the branching. */
jest.mock('server-only', () => ({}));

const mockQueryCandidates = jest.fn();
const mockPreviewRecommendations = jest.fn();
const mockAssemble = jest.fn();
const mockEnsureSeed = jest.fn();
const mockRuntimeEnabled = jest.fn();

jest.mock('@/lib/review-intelligence/query', () => ({ queryCandidates: (...a: unknown[]) => mockQueryCandidates(...a) }));
jest.mock('@/lib/preview/preview-recommendations', () => ({
  previewRecommendations: (...a: unknown[]) => mockPreviewRecommendations(...a),
}));
jest.mock('@/lib/recommendations/assemble', () => ({ assembleRecommendations: (...a: unknown[]) => mockAssemble(...a) }));
jest.mock('@/lib/preview/runtime-seed', () => ({
  ensurePreviewSeed: (...a: unknown[]) => mockEnsureSeed(...a),
  runtimeSeedEnabled: () => mockRuntimeEnabled(),
}));

import { runAssembly, resolveEligibility } from '@/lib/recommendations/run-assembly';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { BookingDeps } from '@/lib/booking/routestack';

const client = {} as SupabaseClient;
const input = { family_profile: { budget_tier: 'comfort' }, trip_brief: { destination: 'Bali' as const } };
const seedDeps = { bookingDeps: {} as BookingDeps };

beforeEach(() => mockRuntimeEnabled.mockReturnValue(false));
afterEach(() => jest.clearAllMocks());

describe('runAssembly — preview fallback', () => {
  it('intelligence candidates present → normal assembly (no preview path)', async () => {
    mockQueryCandidates.mockResolvedValue([{ hotel_id: 'x' }]);
    mockAssemble.mockResolvedValue({ top_pick: { hotel_id: 'x' }, other_picks: [] });
    const out = await runAssembly(client, input);
    expect(mockAssemble).toHaveBeenCalled();
    expect(mockPreviewRecommendations).not.toHaveBeenCalled();
    expect('top_pick' in out).toBe(true);
  });

  it('no intelligence + preview hotels exist → returns the preview result', async () => {
    mockQueryCandidates.mockResolvedValue([]);
    mockPreviewRecommendations.mockResolvedValue({ result: 'preview_recommendations', destination: 'Bali', top_pick: { hotel_id: 'p' }, other_picks: [] });
    const out = await runAssembly(client, input);
    expect(mockPreviewRecommendations).toHaveBeenCalledWith(client, 'Bali', { budgetTier: 'comfort' });
    expect(mockAssemble).not.toHaveBeenCalled();
    expect((out as { result?: string }).result).toBe('preview_recommendations');
  });

  it('no intelligence + NO preview hotels, runtime seed OFF → no_eligible_hotels error', async () => {
    mockRuntimeEnabled.mockReturnValue(false);
    mockQueryCandidates.mockResolvedValue([]);
    mockPreviewRecommendations.mockResolvedValue({ result: 'no_preview_hotels', destination: 'Bali' });
    const out = await runAssembly(client, input, undefined, seedDeps);
    expect(mockEnsureSeed).not.toHaveBeenCalled();
    expect((out as { error?: string }).error).toBe('no_eligible_hotels');
  });

  it('12i-C: empty + runtime seed ON → seeds, re-queries preview, returns cards SAME turn', async () => {
    mockRuntimeEnabled.mockReturnValue(true);
    mockQueryCandidates.mockResolvedValue([]);
    // 1st preview call: empty. 2nd (after seed): cards.
    mockPreviewRecommendations
      .mockResolvedValueOnce({ result: 'no_preview_hotels', destination: 'Bali' })
      .mockResolvedValueOnce({ result: 'preview_recommendations', destination: 'Bali', top_pick: { hotel_id: 'p' }, other_picks: [] });
    mockEnsureSeed.mockResolvedValue({ state: 'seeded', staged: 5 });
    const out = await runAssembly(client, input, undefined, seedDeps);
    expect(mockEnsureSeed).toHaveBeenCalledWith(client, 'Bali', seedDeps.bookingDeps);
    expect(mockPreviewRecommendations).toHaveBeenCalledTimes(2);
    expect((out as { result?: string }).result).toBe('preview_recommendations');
  });

  it('12i-C: seed in_progress (another request) → preview_seeding (no cards yet)', async () => {
    mockRuntimeEnabled.mockReturnValue(true);
    mockQueryCandidates.mockResolvedValue([]);
    mockPreviewRecommendations.mockResolvedValue({ result: 'no_preview_hotels', destination: 'Bali' });
    mockEnsureSeed.mockResolvedValue({ state: 'in_progress' });
    const out = await runAssembly(client, input, undefined, seedDeps);
    expect((out as { result?: string; state?: string }).result).toBe('preview_seeding');
    expect((out as { state?: string }).state).toBe('in_progress');
  });

  it('12i-C: seed empty (RouteStack had nothing) → no_eligible_hotels', async () => {
    mockRuntimeEnabled.mockReturnValue(true);
    mockQueryCandidates.mockResolvedValue([]);
    mockPreviewRecommendations.mockResolvedValue({ result: 'no_preview_hotels', destination: 'Bali' });
    mockEnsureSeed.mockResolvedValue({ state: 'empty' });
    const out = await runAssembly(client, input, undefined, seedDeps);
    expect((out as { error?: string }).error).toBe('no_eligible_hotels');
  });

  it('12i-C: no seedDeps provided → never seeds (CI/test safe)', async () => {
    mockRuntimeEnabled.mockReturnValue(true);
    mockQueryCandidates.mockResolvedValue([]);
    mockPreviewRecommendations.mockResolvedValue({ result: 'no_preview_hotels', destination: 'Bali' });
    const out = await runAssembly(client, input); // no seedDeps
    expect(mockEnsureSeed).not.toHaveBeenCalled();
    expect((out as { error?: string }).error).toBe('no_eligible_hotels');
  });
});

// resolveEligibility is the model-free pre-check the ASYNC dispatcher (03c) runs BEFORE creating a job.
// It must return {assemble: candidates} only when there's real work for the model; otherwise it returns
// the TERMINAL result (preview / seeding / no_eligible_hotels) so the agent answers honestly THIS turn
// instead of falsely promising "your cards will appear in a moment" for an unseeded destination.
describe('resolveEligibility — async pre-check (03c, the false-promise fix)', () => {
  it('candidates present → {assemble} (caller dispatches the async job)', async () => {
    mockQueryCandidates.mockResolvedValue([{ hotel_id: 'x' }]);
    const out = await resolveEligibility(client, input);
    expect('assemble' in out && out.assemble).toEqual([{ hotel_id: 'x' }]);
    expect(mockAssemble).not.toHaveBeenCalled(); // pre-check NEVER makes the model call
    expect(mockPreviewRecommendations).not.toHaveBeenCalled();
  });

  it('no candidates + no preview (unseeded Bali) → no_eligible_hotels TERMINAL (no job, no false promise)', async () => {
    mockRuntimeEnabled.mockReturnValue(false);
    mockQueryCandidates.mockResolvedValue([]);
    mockPreviewRecommendations.mockResolvedValue({ result: 'no_preview_hotels', destination: 'Bali' });
    const out = await resolveEligibility(client, input, seedDeps);
    expect('assemble' in out).toBe(false);
    expect((out as { error?: string }).error).toBe('no_eligible_hotels');
  });

  it('no candidates + preview hotels exist → preview cards TERMINAL (no model job)', async () => {
    mockQueryCandidates.mockResolvedValue([]);
    mockPreviewRecommendations.mockResolvedValue({ result: 'preview_recommendations', destination: 'Bali', top_pick: { hotel_id: 'p' }, other_picks: [] });
    const out = await resolveEligibility(client, input);
    expect('assemble' in out).toBe(false);
    expect((out as { result?: string }).result).toBe('preview_recommendations');
  });
});
