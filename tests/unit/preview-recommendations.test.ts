/* Preview recommendations (12i-B) — surface source='preview' hotels as bookable cards without
 * intelligence/LLM. Fake Supabase client; asserts the result shape, ordering, budget pre-filter, and
 * the empty → no_preview_hotels marker. */
jest.mock('server-only', () => ({}));

import { previewRecommendations, PREVIEW_VERDICT } from '@/lib/preview/preview-recommendations';
import type { SupabaseClient } from '@supabase/supabase-js';

type Row = { id: string; name: string; destination: string; area: string | null; price_tier: string | null; star_rating: number | null; images: string[] | null };

/** Fake client capturing the query chain (.eq().eq().in()) and returning `rows`. */
function fakeClient(rows: Row[]) {
  const calls = { eqs: [] as Array<[string, unknown]>, ins: [] as Array<[string, unknown[]]> };
  const builder = {
    eq(col: string, val: unknown) { calls.eqs.push([col, val]); return builder; },
    in(col: string, vals: unknown[]) { calls.ins.push([col, vals]); return builder; },
    then(resolve: (v: { data: Row[]; error: null }) => void) { resolve({ data: rows, error: null }); },
  };
  const client = { from() { return { select() { return builder; } }; } } as unknown as SupabaseClient;
  return { client, calls };
}

const row = (over: Partial<Row>): Row => ({ id: 'h', name: 'H', destination: 'Bali', area: null, price_tier: 'mid-range', star_rating: 4, images: ['img'], ...over });

describe('previewRecommendations', () => {
  it('returns a preview_recommendations result with a top pick + others, isPreview via _hotel.source', async () => {
    const { client } = fakeClient([
      row({ id: 'a', name: 'With Image 5star', star_rating: 5, images: ['x'] }),
      row({ id: 'b', name: 'No Image', star_rating: 4, images: null }),
    ]);
    const res = await previewRecommendations(client, 'Bali');
    if (res.result !== 'preview_recommendations') throw new Error('expected preview result');
    // Top pick = the one with an image (display ordering, not a quality claim).
    expect(res.top_pick.hotel_name).toBe('With Image 5star');
    expect(res.top_pick.verdict).toBe(PREVIEW_VERDICT);
    expect(res.top_pick._hotel.source).toBe('preview');
    // No fabricated intelligence: no category_summaries, empty hard_flags.
    expect((res.top_pick as unknown as Record<string, unknown>).category_summaries).toBeUndefined();
    expect(res.top_pick.hard_flags).toEqual([]);
    expect(res.other_picks).toHaveLength(1);
    expect(res.other_picks[0].summary).toMatch(/bookable/i);
  });

  it('returns no_preview_hotels when there are none', async () => {
    const { client } = fakeClient([]);
    const res = await previewRecommendations(client, 'Bali');
    expect(res.result).toBe('no_preview_hotels');
  });

  it('applies the budget→price_tier pre-filter (value → mid-range only)', async () => {
    const { client, calls } = fakeClient([row({})]);
    await previewRecommendations(client, 'Bali', { budgetTier: 'value' });
    expect(calls.eqs).toContainEqual(['source', 'preview']);
    expect(calls.eqs).toContainEqual(['destination', 'Bali']);
    expect(calls.ins).toContainEqual(['price_tier', ['mid-range']]);
  });

  it('no budget → no price_tier filter', async () => {
    const { client, calls } = fakeClient([row({})]);
    await previewRecommendations(client, 'Bali');
    expect(calls.ins).toHaveLength(0);
  });
});
