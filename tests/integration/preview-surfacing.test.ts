/* 12i-B integration: runAssembly's preview fallback against local Supabase. Seeds a `source='preview'`
 * hotel (NO hotel_intelligence) under an otherwise-empty destination and asserts runAssembly surfaces
 * it as `preview_recommendations` (the curated path returns 0, the LLM-free preview path kicks in).
 * Also asserts: a destination with neither intelligence NOR preview → no_eligible_hotels. No LLM:
 * the preview branch never calls the assemble dep, so this is key-free. */
import { serviceClient } from './helpers';
import { runAssembly } from '@/lib/recommendations/run-assembly';

jest.setTimeout(30_000);
const admin = serviceClient();
const DEST = 'Tokyo'; // not in the demo seed → owned by this test
const OWN = ['ZZ Preview Villa', 'ZZ Preview Lagoon'];

// The assemble dep should NEVER be called on the preview path — fail loudly if it is.
const failingAssemble = {
  model: { doGenerate: async () => { throw new Error('assemble must NOT run on the preview path'); } },
} as never;

async function cleanup() {
  await admin.from('hotels').delete().eq('destination', DEST).in('name', OWN);
}
beforeEach(cleanup);
afterAll(cleanup);

describe('runAssembly — preview surfacing (12i-B)', () => {
  it('preview-only destination → preview_recommendations (no intelligence, no LLM)', async () => {
    await admin.from('hotels').insert([
      { name: OWN[0], destination: DEST, price_tier: 'luxury', star_rating: 5, images: ['https://cdn/x.jpg'], source: 'preview' },
      { name: OWN[1], destination: DEST, price_tier: 'mid-range', star_rating: 4, images: null, source: 'preview' },
    ]);

    const out = await runAssembly(
      admin,
      { family_profile: { budget_tier: 'comfort' }, trip_brief: { destination: DEST } },
      failingAssemble,
    );

    expect((out as { result?: string }).result).toBe('preview_recommendations');
    const r = out as { top_pick: { hotel_name: string; _hotel: { source: string } }; other_picks: unknown[] };
    // budget 'comfort' → mid-range|luxury, so both seed hotels are eligible; top pick has an image.
    expect(r.top_pick.hotel_name).toBe(OWN[0]);
    expect(r.top_pick._hotel.source).toBe('preview');
    expect(r.other_picks).toHaveLength(1);
  });

  it('destination with neither intelligence NOR preview → no_eligible_hotels', async () => {
    // nothing seeded for DEST
    const out = await runAssembly(
      admin,
      { family_profile: { budget_tier: 'comfort' }, trip_brief: { destination: DEST } },
      failingAssemble,
    );
    expect((out as { error?: string }).error).toBe('no_eligible_hotels');
  });
});
