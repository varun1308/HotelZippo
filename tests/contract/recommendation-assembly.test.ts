/* Contract tests for the recommendation-assembly output (spec 08b-2 / 08b-4 RA-01..05).
 * Validates STRUCTURE, not content (per spec 15). Three layers:
 *  1. Every RA fixture parses through the Zod union (success + error variants).
 *  2. Per-fixture structural invariants (RA-02 empty other_picks, RA-03 evaluate flags,
 *     RA-04 budget_mismatch + available_tiers, RA-05 all flags present).
 *  3. The injectable assembler: a fake model → parsed contract object; malformed → throws.
 * No ANTHROPIC_API_KEY needed — the model seam is injected. */
import {
  recommendationAssemblySchema,
  isRecommendationError,
  type RecommendationAssembly,
} from '@/lib/contracts/recommendation-assembly';
import { RA_FIXTURES, RA01, RA02, RA03, RA04, RA05 } from '@/tests/fixtures/recommendation-assembly';

// assemble.ts imports 'server-only'; alias it to a no-op for the jsdom/contract project.
jest.mock('server-only', () => ({}));
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { assembleRecommendations, AssemblyError } = require('@/lib/recommendations/assemble');

/** Collect every hard flag across top_pick + other_picks of a success output. */
function allFlags(out: RecommendationAssembly) {
  if (isRecommendationError(out)) return [];
  return [...out.top_pick.hard_flags, ...out.other_picks.flatMap((p) => p.hard_flags)];
}

describe('contract — every RA fixture parses through the Zod union', () => {
  it.each(Object.entries(RA_FIXTURES))('%s parses', (_name, fixture) => {
    expect(recommendationAssemblySchema.safeParse(fixture).success).toBe(true);
  });
});

describe('contract — per-fixture structural invariants', () => {
  it('RA-01: top pick + 2 other picks; Holiday Inn severe flag survives', () => {
    expect(isRecommendationError(RA01)).toBe(false);
    if (isRecommendationError(RA01)) return;
    expect(RA01.top_pick.hotel_name).toBeTruthy();
    expect(RA01.other_picks).toHaveLength(2);
    const flags = allFlags(RA01);
    expect(flags.some((f) => f.category === 'refurbishment' && f.severity === 'severe')).toBe(true);
  });

  it('RA-02: low_confidence excluded → single pick, other_picks empty', () => {
    if (isRecommendationError(RA02)) throw new Error('RA-02 should be a success');
    expect(RA02.other_picks).toEqual([]);
  });

  it('RA-03: evaluate_only_applied=true && alternatives_introduced=false', () => {
    if (isRecommendationError(RA03)) throw new Error('RA-03 should be a success');
    expect(RA03.evaluate_only_applied).toBe(true);
    expect(RA03.alternatives_introduced).toBe(false);
  });

  it('RA-04: budget_mismatch error with available_tiers', () => {
    expect(isRecommendationError(RA04)).toBe(true);
    if (!isRecommendationError(RA04)) return;
    expect(RA04.error).toBe('budget_mismatch');
    if (RA04.error === 'budget_mismatch') {
      expect(RA04.available_tiers).toEqual(['ultra-luxury']);
    }
  });

  it('RA-05: all three source hard flags present; notes state all flagged', () => {
    if (isRecommendationError(RA05)) throw new Error('RA-05 should be a success');
    const cats = allFlags(RA05).map((f) => f.category).sort();
    expect(cats).toEqual(['noise', 'pests', 'refurbishment']);
    expect(RA05.recommendation_notes).toMatch(/all available hotels/i);
  });
});

describe('hard-flag survival — every source flag appears in output (CLAUDE.md 1/4)', () => {
  // The source flags that MUST survive into each fixture's output.
  const sourceFlags: Record<string, Array<{ category: string; severity: string }>> = {
    RA01: [{ category: 'refurbishment', severity: 'severe' }],
    RA05: [
      { category: 'noise', severity: 'moderate' },
      { category: 'refurbishment', severity: 'severe' },
      { category: 'pests', severity: 'severe' },
    ],
  };
  it.each(Object.entries(sourceFlags))('%s: all source flags survive', (name, flags) => {
    const out = RA_FIXTURES[name as keyof typeof RA_FIXTURES];
    const present = allFlags(out);
    for (const sf of flags) {
      expect(
        present.some((p) => p.category === sf.category && p.severity === sf.severity),
      ).toBe(true);
    }
  });
});

describe('assembler — injectable model seam', () => {
  const baseInput = { family_profile: { budget_tier: 'comfort' }, trip_brief: { destination: 'Phuket' }, candidates: [] };

  it('returns the parsed contract object from a fake model', async () => {
    const callModel = jest.fn(async () => JSON.stringify(RA01));
    const out = await assembleRecommendations(baseInput, {
      callModel,
      systemPrompt: 'TEST PROMPT',
    });
    expect(callModel).toHaveBeenCalledTimes(1);
    expect(out.top_pick.hotel_name).toBe('Anantara Phuket');
  });

  it('parses a ```json fenced``` model response', async () => {
    const callModel = async () => '```json\n' + JSON.stringify(RA04) + '\n```';
    const out = await assembleRecommendations(baseInput, { callModel, systemPrompt: 'x' });
    expect(isRecommendationError(out)).toBe(true);
  });

  it('throws AssemblyError(malformed_output) on non-JSON', async () => {
    const callModel = async () => 'I think you should book the nice one!';
    await expect(
      assembleRecommendations(baseInput, { callModel, systemPrompt: 'x' }),
    ).rejects.toMatchObject({ name: 'AssemblyError', code: 'malformed_output' });
  });

  it('throws AssemblyError(malformed_output) on JSON that violates the contract', async () => {
    const callModel = async () => JSON.stringify({ top_pick: { hotel_name: 'X' } }); // missing fields
    await expect(
      assembleRecommendations(baseInput, { callModel, systemPrompt: 'x' }),
    ).rejects.toBeInstanceOf(AssemblyError);
  });

  it('propagates a model-call failure as AssemblyError(model_call_failed)', async () => {
    const callModel = async () => {
      throw new Error('network down');
    };
    await expect(
      assembleRecommendations(baseInput, { callModel, systemPrompt: 'x' }),
    ).rejects.toMatchObject({ code: 'model_call_failed' });
  });
});
