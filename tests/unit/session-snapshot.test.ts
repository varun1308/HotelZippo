/* Phase 5 (specs/08b-3-session-snapshot.md): the snapshot GENERATOR. Uses an injected
 * fake model so it runs key-free in CI. Asserts: the full conversation history is passed
 * to the model as a transcript; the output is returned as plain text; an over-ceiling
 * output is still returned (prompt-enforced budget, not a hard truncation); empty output
 * throws. The on-disk prompt's own invariants are covered by the contract test. */
jest.mock('server-only', () => ({}));

import {
  generateSnapshot,
  renderTranscript,
  estimateTokens,
  SnapshotError,
  SNAPSHOT_TOKEN_CEILING,
} from '@/lib/chat/session-snapshot';
import type { ModelMessage } from 'ai';

const history: ModelMessage[] = [
  { role: 'user', content: 'Phuket in December — 2 kids ages 2 and 7, plus grandparents.' },
  { role: 'assistant', content: 'On it — reading recent family reviews.' },
  { role: 'user', content: 'Vegetarian food matters, comfort budget.' },
];

const STUB_PROMPT = 'You are a session state compressor.';

describe('generateSnapshot', () => {
  it('passes the full conversation history to the model as a transcript', async () => {
    let seenTranscript = '';
    const callModel = jest.fn(async ({ transcript }: { transcript: string }) => {
      seenTranscript = transcript;
      return 'Trip brief — partial. Destination: Phuket.';
    });

    await generateSnapshot(history, { callModel, systemPrompt: STUB_PROMPT });

    expect(callModel).toHaveBeenCalledTimes(1);
    // Every user + assistant message's content appears in the transcript.
    expect(seenTranscript).toContain('Phuket in December');
    expect(seenTranscript).toContain('reading recent family reviews');
    expect(seenTranscript).toContain('Vegetarian food matters');
    // Roles are labelled (User / Concierge), per renderTranscript.
    expect(seenTranscript).toMatch(/User:/);
    expect(seenTranscript).toMatch(/Concierge:/);
  });

  it('returns the model output as trimmed plain text', async () => {
    const callModel = async () => '  Trip brief — complete. Destination: Phuket.  \n';
    const out = await generateSnapshot(history, { callModel, systemPrompt: STUB_PROMPT });
    expect(out).toBe('Trip brief — complete. Destination: Phuket.');
  });

  it('uses the on-disk system prompt when none is injected (loads the artifact)', async () => {
    let seenSystem = '';
    const callModel = async ({ system }: { system: string }) => {
      seenSystem = system;
      return 'ok';
    };
    await generateSnapshot(history, { callModel });
    // The real prompt artifact mentions the compressor framing.
    expect(seenSystem.toLowerCase()).toContain('session state compressor');
  });

  it('still returns an over-ceiling summary (prompt-enforced budget, no truncation)', async () => {
    // ~600 tokens of text > the 500 ceiling.
    const long = 'word '.repeat((SNAPSHOT_TOKEN_CEILING + 100) * 4 / 5);
    const callModel = async () => long;
    const out = await generateSnapshot(history, { callModel, systemPrompt: STUB_PROMPT });
    expect(estimateTokens(out)).toBeGreaterThan(SNAPSHOT_TOKEN_CEILING);
    expect(out.length).toBeGreaterThan(0); // not truncated to empty / clipped to a boundary
  });

  it('throws SnapshotError on empty output', async () => {
    const callModel = async () => '   ';
    await expect(generateSnapshot(history, { callModel, systemPrompt: STUB_PROMPT })).rejects.toThrow(
      SnapshotError,
    );
  });

  it('wraps a model failure in SnapshotError(model_call_failed)', async () => {
    const callModel = async () => {
      throw new Error('network down');
    };
    await expect(
      generateSnapshot(history, { callModel, systemPrompt: STUB_PROMPT }),
    ).rejects.toMatchObject({ code: 'model_call_failed' });
  });
});

describe('renderTranscript', () => {
  it('drops empty lines and labels roles', () => {
    const t = renderTranscript([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: '' },
    ]);
    expect(t).toBe('User: hi');
  });
});
