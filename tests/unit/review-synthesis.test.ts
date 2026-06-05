/* Phase 6 · TC-P12 (confidence gate) + TC-P14 (malformed JSON → fail, no partial) +
 * synthesis output validation. Uses an injected fixture model so it runs key-free. The
 * prompt-text invariants (08a-3 cases) are covered by tests/contract/synthesis-prompt.test.ts;
 * here we test the call/parse/validate/gate mechanics. */
jest.mock('server-only', () => ({}));

import {
  synthesise,
  confidenceGate,
  synthesisOutputSchema,
  SynthesisError,
  type SynthesisOutput,
} from '@/lib/review-intelligence/synthesis';

const VALID: SynthesisOutput = {
  confidence: { overall: 'high', rooms: 'strong', facilities: 'strong', food: 'strong', location: 'strong' },
  rooms_summary: 'Spacious family rooms, consistently well kept.',
  facilities_summary: 'Strong kids club and pools.',
  food_summary: 'Good breakfast variety including vegetarian.',
  location_summary: 'Calm beach, shallow water.',
  hard_flags: [],
  conflicting_signals: {
    rooms: 'No conflicting signals detected.',
    facilities: 'No conflicting signals detected.',
    food: 'No conflicting signals detected.',
    location: 'No conflicting signals detected.',
  },
  family_signal_strength: { rooms: 'strong', facilities: 'strong', food: 'strong', location: 'strong' },
  supporting_phrases: { rooms: [], facilities: [], food: [], location: [] },
  indian_food_signal: 'Indian and vegetarian options praised at breakfast.',
  review_count_family: 45,
  review_count_total: 420,
};

const modelReturning = (text: string) => async () => text;

describe('confidenceGate (TC-P12 / 08a-2)', () => {
  it('high → publish (no flags)', () => {
    expect(confidenceGate('high')).toEqual({ lowConfidence: false, reviewQueue: false, alert: false });
  });
  it('medium → publish + review queue', () => {
    expect(confidenceGate('medium')).toEqual({ lowConfidence: false, reviewQueue: true, alert: false });
  });
  it('low → publish with low_confidence + Dash0 alert', () => {
    expect(confidenceGate('low')).toEqual({ lowConfidence: true, reviewQueue: false, alert: true });
  });
});

describe('synthesise', () => {
  it('parses valid JSON and applies the gate', async () => {
    const { output, gate } = await synthesise('INPUT', {
      callModel: modelReturning(JSON.stringify(VALID)),
      systemPrompt: 'stub',
    });
    expect(output.confidence.overall).toBe('high');
    expect(gate.lowConfidence).toBe(false);
  });

  it('strips a ```json fence the model may add', async () => {
    const { output } = await synthesise('INPUT', {
      callModel: modelReturning('```json\n' + JSON.stringify(VALID) + '\n```'),
      systemPrompt: 'stub',
    });
    expect(output.review_count_total).toBe(420);
  });

  it('low confidence output → gate sets low_confidence + alert', async () => {
    const low = { ...VALID, confidence: { ...VALID.confidence, overall: 'low' as const } };
    const { gate } = await synthesise('INPUT', { callModel: modelReturning(JSON.stringify(low)), systemPrompt: 'stub' });
    expect(gate).toEqual({ lowConfidence: true, reviewQueue: false, alert: true });
  });

  it('TC-P14: malformed JSON → SynthesisError(malformed_output), raw retained, no partial', async () => {
    await expect(
      synthesise('INPUT', { callModel: modelReturning('not json at all'), systemPrompt: 'stub' }),
    ).rejects.toMatchObject({ code: 'malformed_output' });
  });

  it('schema-invalid JSON (missing a field) → malformed_output', async () => {
    const { confidence, ...broken } = VALID;
    void confidence;
    await expect(
      synthesise('INPUT', { callModel: modelReturning(JSON.stringify(broken)), systemPrompt: 'stub' }),
    ).rejects.toMatchObject({ code: 'malformed_output' });
  });

  it('wraps a model failure in SynthesisError(model_call_failed)', async () => {
    await expect(
      synthesise('INPUT', {
        callModel: async () => {
          throw new Error('network');
        },
        systemPrompt: 'stub',
      }),
    ).rejects.toMatchObject({ code: 'model_call_failed' });
  });
});

describe('synthesisOutputSchema rejects extra keys (strict)', () => {
  it('fails on an unknown field', () => {
    expect(synthesisOutputSchema.safeParse({ ...VALID, bogus: 1 }).success).toBe(false);
  });
});
