/* Unit guard for the E2E /api/chat stub (lib/chat/e2e-stub.ts, specs/15a §1.1).
 *
 * The stub only ever runs under NEXT_PUBLIC_E2E=1, but it carries real logic (turn
 * selection + protocol emission) and a prod-safety default, so it's worth pinning:
 *   • e2eEnabled() defaults FALSE (prod can never accidentally serve the stub).
 *   • the stub speaks the exact NDJSON StreamChunk protocol the live route emits.
 *   • playback is instant (no waits) so E2E stays flake-free.
 *   • turn selection advances by user-turn count and reliably reaches the
 *     recommendation-set turn (the J2 journey depends on this). */
import { e2eEnabled, e2eChatStub } from '@/lib/chat/e2e-stub';
import type { ChatMessage, StreamChunk } from '@/lib/chat/types';

function userMsg(text: string): ChatMessage {
  return { id: `u-${text.length}-${text.slice(0, 4)}`, role: 'user', parts: [{ type: 'text', text }] };
}
function asstMsg(): ChatMessage {
  return { id: 'a', role: 'assistant', parts: [{ type: 'text', text: 'ok' }] };
}

/** Read the whole NDJSON body of a stub Response into parsed StreamChunks. */
async function drain(res: Response): Promise<StreamChunk[]> {
  const text = await res.text();
  return text
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as StreamChunk);
}

describe('e2eEnabled', () => {
  const prev = process.env.NEXT_PUBLIC_E2E;
  afterEach(() => {
    if (prev === undefined) delete process.env.NEXT_PUBLIC_E2E;
    else process.env.NEXT_PUBLIC_E2E = prev;
  });

  it('defaults to false (prod can never serve the stub)', () => {
    delete process.env.NEXT_PUBLIC_E2E;
    expect(e2eEnabled()).toBe(false);
    process.env.NEXT_PUBLIC_E2E = '0';
    expect(e2eEnabled()).toBe(false);
  });

  it('is true only for the exact "1" flag', () => {
    process.env.NEXT_PUBLIC_E2E = '1';
    expect(e2eEnabled()).toBe(true);
  });
});

describe('e2eChatStub', () => {
  it('emits the live NDJSON protocol: typing → text-delta(s) → done', async () => {
    const chunks = await drain(e2eChatStub([userMsg('hi')]));
    expect(chunks[0]).toEqual({ type: 'typing' });
    expect(chunks.at(-1)).toEqual({ type: 'done' });
    expect(chunks.some((c) => c.type === 'text-delta')).toBe(true);
    // Correct content-type so the client adapter parses it as the real route's body.
    const res = e2eChatStub([userMsg('hi')]);
    expect(res.headers.get('content-type')).toContain('application/x-ndjson');
  });

  it('reaches a recommendation-set turn deterministically after several user turns', async () => {
    // Walk the script: the final scripted assistant turn carries the recommendations.
    const history: ChatMessage[] = [];
    let sawReco = false;
    for (let i = 0; i < 8 && !sawReco; i += 1) {
      history.push(userMsg(`turn ${i}`), asstMsg());
      const chunks = await drain(e2eChatStub(history));
      sawReco = chunks.some(
        (c) => c.type === 'component' && c.component === 'recommendation-set',
      );
    }
    expect(sawReco).toBe(true);
  });

  it('the recommendation-set carries a top pick with a hard flag (J2 assertions depend on it)', async () => {
    // Many user turns → clamp to the final (recommendation) turn.
    const history = Array.from({ length: 10 }, (_, i) => userMsg(`m${i}`));
    const chunks = await drain(e2eChatStub(history));
    const reco = chunks.find(
      (c): c is Extract<StreamChunk, { type: 'component' }> =>
        c.type === 'component' && c.component === 'recommendation-set',
    );
    expect(reco).toBeDefined();
    const props = reco!.props as { topPick?: { hardFlags?: unknown[] }; otherPicks?: unknown[] };
    expect(props.topPick).toBeTruthy();
    expect(Array.isArray(props.otherPicks)).toBe(true);
    // At least one hard flag exists across the set (top pick or an alt) for the J2 prominence check.
    const flagCount =
      (props.topPick?.hardFlags?.length ?? 0) +
      (props.otherPicks as Array<{ hardFlags?: unknown[] }>).reduce(
        (n, p) => n + (p.hardFlags?.length ?? 0),
        0,
      );
    expect(flagCount).toBeGreaterThan(0);
  });
});
