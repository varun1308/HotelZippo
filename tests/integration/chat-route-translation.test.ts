/* The /api/chat route translates streamText's fullStream → our NDJSON StreamChunk
 * protocol. We mock runConversation to yield the (stable) public fullStream part
 * shapes and assert the emitted NDJSON. No AI SDK call, no DB, no API key. */
import type { StreamChunk } from '@/lib/chat/types';

jest.mock('server-only', () => ({}));

// Mock the agent so the route's translation is the unit under test.
const mockRunConversation = jest.fn();
jest.mock('@/lib/chat/agent', () => ({
  runConversation: (...args: unknown[]) => mockRunConversation(...args),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { POST } = require('@/app/api/chat/route');

function fullStreamOf(parts: unknown[]) {
  return {
    fullStream: (async function* () {
      for (const p of parts) yield p;
    })(),
  };
}

async function readNdjson(res: Response): Promise<StreamChunk[]> {
  const text = await res.text();
  return text
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as StreamChunk);
}

function req(body: unknown): Request {
  return new Request('http://localhost/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const userMsg = { messages: [{ id: 'u0', role: 'user', parts: [{ type: 'text', text: 'hi' }] }] };

afterEach(() => mockRunConversation.mockReset());

describe('/api/chat NDJSON translation', () => {
  it('400s when messages are missing', async () => {
    const res = await POST(req({}));
    expect(res.status).toBe(400);
  });

  it('translates text-delta parts into text-delta chunks, ending with done', async () => {
    mockRunConversation.mockResolvedValue(
      fullStreamOf([
        { type: 'text-delta', text: 'Hello ' },
        { type: 'text-delta', text: 'there.' },
        { type: 'finish' },
      ]),
    );
    const res = await POST(req(userMsg));
    expect(res.headers.get('content-type')).toMatch(/x-ndjson/);
    const chunks = await readNdjson(res);
    expect(chunks[0]).toEqual({ type: 'typing' });
    const deltas = chunks.filter((c) => c.type === 'text-delta');
    expect(deltas.map((d) => (d as { delta: string }).delta)).toEqual(['Hello ', 'there.']);
    expect(chunks[chunks.length - 1]).toEqual({ type: 'done' });
  });

  it('translates an assemble_recommendations tool-result into a recommendation-set component chunk', async () => {
    const assembly = {
      top_pick: {
        hotel_id: '00000000-0000-0000-0000-000000000001',
        hotel_name: 'JW Marriott Phuket',
        verdict: 'v',
        category_summaries: { rooms: 'r', facilities: 'f', food: 'fo', location: 'l' },
        hard_flags: [],
        brand_note: null,
        supporting_phrases: { rooms: [], facilities: [], food: [], location: [] },
        why_top_pick: 'w',
        _hotel: { destination: 'Phuket', area: null, price_tier: 'luxury', star_rating: 5, images: [] },
      },
      other_picks: [],
      recommendation_notes: null,
      evaluate_only_applied: false,
      alternatives_introduced: false,
    };
    mockRunConversation.mockResolvedValue(
      fullStreamOf([
        { type: 'tool-result', toolName: 'assemble_recommendations', output: assembly },
        { type: 'text-delta', text: 'Here you go.' },
        { type: 'finish' },
      ]),
    );
    const res = await POST(req(userMsg));
    const chunks = await readNdjson(res);
    const comp = chunks.find((c) => c.type === 'component') as
      | { type: 'component'; component: string; props: { topPick: { hotelName: string } } }
      | undefined;
    expect(comp).toBeTruthy();
    expect(comp!.component).toBe('recommendation-set');
    expect(comp!.props.topPick.hotelName).toBe('JW Marriott Phuket');
  });

  it('translates an update_profile tool-result into a profile-update component chunk', async () => {
    mockRunConversation.mockResolvedValue(
      fullStreamOf([
        { type: 'tool-result', toolName: 'update_profile', output: { updated: ['budget'] } },
        { type: 'text-delta', text: 'Done.' },
        { type: 'finish' },
      ]),
    );
    const res = await POST(req(userMsg));
    const chunks = await readNdjson(res);
    const comp = chunks.find((c) => c.type === 'component') as
      | { type: 'component'; component: string; props: { updated: string[] } }
      | undefined;
    expect(comp).toBeTruthy();
    expect(comp!.component).toBe('profile-update');
    expect(comp!.props.updated).toEqual(['budget']);
  });

  it('does NOT emit a chunk for an update_profile no-op (empty updated)', async () => {
    mockRunConversation.mockResolvedValue(
      fullStreamOf([
        { type: 'tool-result', toolName: 'update_profile', output: { updated: [] } },
        { type: 'finish' },
      ]),
    );
    const res = await POST(req(userMsg));
    const chunks = await readNdjson(res);
    expect(chunks.some((c) => c.type === 'component')).toBe(false);
  });

  it('emits a warm error chunk if fullStream throws mid-stream, still ending with done', async () => {
    mockRunConversation.mockResolvedValue({
      fullStream: (async function* () {
        yield { type: 'text-delta', text: 'partial' };
        throw new Error('boom');
      })(),
    });
    const res = await POST(req(userMsg));
    const chunks = await readNdjson(res);
    expect(chunks[chunks.length - 1]).toEqual({ type: 'done' });
    expect(chunks.some((c) => c.type === 'text-delta')).toBe(true);
  });

  it('502s warmly if runConversation itself rejects', async () => {
    mockRunConversation.mockRejectedValue(new Error('model down'));
    const res = await POST(req(userMsg));
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toBe('chat_failed');
  });
});

describe('buildSystem context injection (08b-1)', () => {
  // Pure module — no AI SDK import, safe in jsdom.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { buildSystem } = require('@/lib/chat/build-system');

  it('injects family_profile + session_snapshot blocks (always present)', () => {
    const out = buildSystem('BASE', {
      familyProfile: { name: 'Raj', budget_tier: 'comfort' },
      sessionSnapshot: 'prior summary',
    });
    expect(out).toContain('BASE');
    expect(out).toMatch(/<family_profile>[\s\S]*Raj[\s\S]*<\/family_profile>/);
    expect(out).toMatch(/<session_snapshot>[\s\S]*prior summary[\s\S]*<\/session_snapshot>/);
  });

  it('emits EMPTY blocks for a new user (no profile/snapshot)', () => {
    const out = buildSystem('BASE', {});
    // Both blocks present but empty — the signal for a new user (08b-1).
    expect(out).toMatch(/<family_profile>\s*<\/family_profile>/);
    expect(out).toMatch(/<session_snapshot>\s*<\/session_snapshot>/);
  });
});
