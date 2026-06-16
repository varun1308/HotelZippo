/* run-assembly preview fallback (12i-B): when there's no review intelligence for a destination,
 * fall back to preview hotels if any exist; else the existing no_eligible_hotels error. We mock the
 * three collaborators (query, preview, assemble) to test ONLY the branching. */
jest.mock('server-only', () => ({}));

const mockQueryCandidates = jest.fn();
const mockPreviewRecommendations = jest.fn();
const mockAssemble = jest.fn();

jest.mock('@/lib/review-intelligence/query', () => ({ queryCandidates: (...a: unknown[]) => mockQueryCandidates(...a) }));
jest.mock('@/lib/preview/preview-recommendations', () => ({
  previewRecommendations: (...a: unknown[]) => mockPreviewRecommendations(...a),
}));
jest.mock('@/lib/recommendations/assemble', () => ({ assembleRecommendations: (...a: unknown[]) => mockAssemble(...a) }));

import { runAssembly } from '@/lib/recommendations/run-assembly';
import type { SupabaseClient } from '@supabase/supabase-js';

const client = {} as SupabaseClient;
const input = { family_profile: { budget_tier: 'comfort' }, trip_brief: { destination: 'Bali' as const } };

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

  it('no intelligence + NO preview hotels → no_eligible_hotels error', async () => {
    mockQueryCandidates.mockResolvedValue([]);
    mockPreviewRecommendations.mockResolvedValue({ result: 'no_preview_hotels', destination: 'Bali' });
    const out = await runAssembly(client, input);
    expect((out as { error?: string }).error).toBe('no_eligible_hotels');
  });
});
