/**
 * @jest-environment node
 *
 * POST /api/chat — error/edge branches (specs 08b / 08b-1 / 14 / 15a §1.1).
 *
 * The auth gate is covered by route-auth-gates.test.ts; this suite targets the remaining
 * RED branches: malformed/empty bodies, the E2E-stub seam, the saved-profile-preferred
 * load (08b-1 "never re-ask") incl. its best-effort failure fallback, the warm 502 when
 * the agent itself rejects (spec 14 — trace id, never a raw error), the fullStream →
 * NDJSON translation branches (assembly sync/async, profile chip + no-op, offer-form,
 * stream error part, mid-stream throw), and reconcile-save buffering/flushing.
 *
 * Key-free + network-free: agent, SSR auth, and profile load are mocked; the route's own
 * gating + translation logic is what runs. Asserts observable NDJSON chunks + statuses.
 */
import type { StreamChunk } from '@/lib/chat/types';

jest.mock('server-only', () => ({}));

// Controllable auth seam (house pattern — route-auth-gates.test.ts).
let mockUser: { id: string } | null = null;
jest.mock('next/headers', () => ({
  cookies: async () => ({ getAll: () => [] }),
}));
jest.mock('@/lib/db/ssr', () => ({
  createSupabaseServerClient: () => ({
    auth: { getUser: async () => ({ data: { user: mockUser } }) },
  }),
}));

// Saved-profile load — controllable per test (saved / none / failing).
const mockLoadFamilyProfile = jest.fn();
jest.mock('@/lib/db/persistence/family-profiles', () => ({
  loadFamilyProfile: (...a: unknown[]) => mockLoadFamilyProfile(...a),
}));

// The agent — the route translates whatever fullStream it returns.
const mockRunConversation = jest.fn();
jest.mock('@/lib/chat/agent', () => ({
  runConversation: (...args: unknown[]) => mockRunConversation(...args),
}));

// E2E stub seam — mocked as a module so no script/DB machinery runs (key-free).
let mockE2E = false;
const mockChatStub = jest.fn(async (..._a: unknown[]) =>
  Response.json({ stub: true }, { status: 200 }),
);
jest.mock('@/lib/chat/e2e-stub', () => ({
  e2eEnabled: () => mockE2E,
  e2eChatStub: (...a: unknown[]) => mockChatStub(...a),
}));

/* eslint-disable @typescript-eslint/no-var-requires */
const { POST } = require('@/app/api/chat/route');

const CONV = '3744958a-29ac-41ff-958a-dee431a77b48';

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
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

const userMsg = {
  messages: [{ id: 'u0', role: 'user', parts: [{ type: 'text', text: 'hi' }] }],
};

const ENV_KEYS = ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY'] as const;
const savedEnv: Record<string, string | undefined> = {};
beforeAll(() => {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
});
beforeEach(() => {
  // Default: env-free (ungated) + anonymous — the pure-translation posture.
  for (const k of ENV_KEYS) delete process.env[k];
  mockUser = null;
  mockE2E = false;
  mockRunConversation.mockReset();
  mockLoadFamilyProfile.mockReset();
  mockChatStub.mockClear();
});
afterAll(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

function signIn() {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key';
  mockUser = { id: 'user-1' };
}

describe('request validation', () => {
  it('400s a malformed JSON body', async () => {
    const res = await POST(req('{not json'));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_request' });
    expect(mockRunConversation).not.toHaveBeenCalled();
  });

  it('400s a missing messages array', async () => {
    const res = await POST(req({}));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('messages required');
  });

  it('400s an EMPTY messages array (not just a missing one)', async () => {
    const res = await POST(req({ messages: [] }));
    expect(res.status).toBe(400);
  });

  it('400s a non-array messages value', async () => {
    const res = await POST(req({ messages: 'hi' }));
    expect(res.status).toBe(400);
  });
});

describe('E2E stub seam (specs/15a §1.1)', () => {
  it('serves the deterministic stub instead of a paid agent turn', async () => {
    mockE2E = true;
    const res = await POST(req(userMsg));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ stub: true });
    expect(mockChatStub).toHaveBeenCalledWith(userMsg.messages);
    expect(mockRunConversation).not.toHaveBeenCalled();
  });
});

describe('saved-profile-preferred load (08b-1 "never re-ask")', () => {
  it('prefers the saved server-side profile over the client copy for a signed-in user', async () => {
    signIn();
    const saved = { name: 'Raj', budgetTier: 'luxury' };
    mockLoadFamilyProfile.mockResolvedValue(saved);
    mockRunConversation.mockResolvedValue(fullStreamOf([{ type: 'finish' }]));
    const res = await POST(req({ ...userMsg, familyProfile: { name: 'stale-client-copy' } }));
    expect(res.status).toBe(200);
    const arg = mockRunConversation.mock.calls[0][0] as { familyProfile: unknown; userId?: string };
    expect(arg.familyProfile).toBe(saved);
    expect(arg.userId).toBe('user-1');
  });

  it('falls back to the client copy when no row is saved yet', async () => {
    signIn();
    mockLoadFamilyProfile.mockResolvedValue(null);
    mockRunConversation.mockResolvedValue(fullStreamOf([{ type: 'finish' }]));
    const clientCopy = { name: 'First-Timer' };
    await POST(req({ ...userMsg, familyProfile: clientCopy }));
    const arg = mockRunConversation.mock.calls[0][0] as { familyProfile: unknown };
    expect(arg.familyProfile).toEqual(clientCopy);
  });

  it('falls back to the client copy when the load FAILS (best-effort, turn still runs)', async () => {
    signIn();
    mockLoadFamilyProfile.mockRejectedValue(new Error('db down'));
    mockRunConversation.mockResolvedValue(fullStreamOf([{ type: 'finish' }]));
    const clientCopy = { name: 'Raj' };
    const res = await POST(req({ ...userMsg, familyProfile: clientCopy }));
    expect(res.status).toBe(200);
    const arg = mockRunConversation.mock.calls[0][0] as { familyProfile: unknown };
    expect(arg.familyProfile).toEqual(clientCopy);
  });

  it('never loads a profile for an ungated env-free caller (no session)', async () => {
    mockRunConversation.mockResolvedValue(fullStreamOf([{ type: 'finish' }]));
    await POST(req(userMsg));
    expect(mockLoadFamilyProfile).not.toHaveBeenCalled();
  });
});

describe('agent failure (spec 14 — warm copy + traceId, no raw error)', () => {
  it('502s warmly when runConversation rejects, exposing a traceId but never the raw message', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      mockRunConversation.mockRejectedValue(new Error('ANTHROPIC_API_KEY invalid xyz-secret'));
      const res = await POST(req(userMsg));
      expect(res.status).toBe(502);
      const body = await res.json();
      expect(body.error).toBe('chat_failed');
      expect(typeof body.message).toBe('string');
      expect(typeof body.traceId).toBe('string');
      expect(JSON.stringify(body)).not.toContain('xyz-secret');
    } finally {
      spy.mockRestore();
    }
  });
});

describe('fullStream → NDJSON translation branches', () => {
  it('opens with typing, translates deltas, ends with done', async () => {
    mockRunConversation.mockResolvedValue(
      fullStreamOf([
        { type: 'text-delta', text: 'Hello ' },
        { type: 'text-delta', text: 'Raj.' },
        { type: 'finish' },
      ]),
    );
    const res = await POST(req(userMsg));
    expect(res.headers.get('content-type')).toMatch(/x-ndjson/);
    const chunks = await readNdjson(res);
    expect(chunks[0]).toEqual({ type: 'typing' });
    expect(chunks[chunks.length - 1]).toEqual({ type: 'done' });
    expect(
      chunks.filter((c) => c.type === 'text-delta').map((c) => (c as { delta: string }).delta),
    ).toEqual(['Hello ', 'Raj.']);
  });

  it('ASYNC assembly_started → assembly-progress carrying the validated conversationId (03c)', async () => {
    mockRunConversation.mockResolvedValue(
      fullStreamOf([
        {
          type: 'tool-result',
          toolName: 'assemble_recommendations',
          output: { result: 'assembly_started', jobId: 'job-1', destination: 'Phuket' },
        },
        { type: 'finish' },
      ]),
    );
    const res = await POST(req({ ...userMsg, conversationId: CONV }));
    const chunks = await readNdjson(res);
    const comp = chunks.find((c) => c.type === 'component') as {
      component: string;
      props: Record<string, unknown>;
    };
    expect(comp.component).toBe('assembly-progress');
    expect(comp.props).toEqual({ jobId: 'job-1', destination: 'Phuket', conversationId: CONV });
  });

  it('a hostile conversationId is dropped (never echoed into the progress props)', async () => {
    mockRunConversation.mockResolvedValue(
      fullStreamOf([
        {
          type: 'tool-result',
          toolName: 'assemble_recommendations',
          output: { result: 'assembly_started', jobId: 'job-1', destination: 'Phuket' },
        },
        { type: 'finish' },
      ]),
    );
    const res = await POST(req({ ...userMsg, conversationId: 'not-a-uuid; DROP TABLE' }));
    const chunks = await readNdjson(res);
    const comp = chunks.find((c) => c.type === 'component') as { props: Record<string, unknown> };
    expect(comp.props.conversationId).toBeUndefined();
  });

  it('a SYNC assembly that maps cleanly emits the recommendation-set component chunk', async () => {
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
        { type: 'finish' },
      ]),
    );
    const chunks = await readNdjson(await POST(req(userMsg)));
    const comp = chunks.find((c) => c.type === 'component') as {
      component: string;
      props: { topPick: { hotelName: string } };
    };
    expect(comp.component).toBe('recommendation-set');
    expect(comp.props.topPick.hotelName).toBe('JW Marriott Phuket');
  });

  it('a SYNC assembly whose output cannot be mapped emits NO component chunk (no broken card)', async () => {
    mockRunConversation.mockResolvedValue(
      fullStreamOf([
        { type: 'tool-result', toolName: 'assemble_recommendations', output: { error: 'no_eligible_hotels' } },
        { type: 'text-delta', text: 'Nothing eligible yet.' },
        { type: 'finish' },
      ]),
    );
    const chunks = await readNdjson(await POST(req(userMsg)));
    expect(chunks.some((c) => c.type === 'component')).toBe(false);
    expect(chunks[chunks.length - 1]).toEqual({ type: 'done' });
  });

  it('update_profile with a nullish output is a safe no-op (no chip)', async () => {
    mockRunConversation.mockResolvedValue(
      fullStreamOf([
        { type: 'tool-result', toolName: 'update_profile', output: undefined },
        { type: 'finish' },
      ]),
    );
    const chunks = await readNdjson(await POST(req(userMsg)));
    expect(chunks.some((c) => c.type === 'component')).toBe(false);
  });

  it('update_profile with real changes emits the profile-update chip', async () => {
    mockRunConversation.mockResolvedValue(
      fullStreamOf([
        { type: 'tool-result', toolName: 'update_profile', output: { updated: ['budget'] } },
        { type: 'finish' },
      ]),
    );
    const chunks = await readNdjson(await POST(req(userMsg)));
    expect(chunks).toContainEqual({
      type: 'component',
      component: 'profile-update',
      props: { updated: ['budget'] },
    });
  });

  it('offer_profile_form → an offer-form chunk (spec 05 §4)', async () => {
    mockRunConversation.mockResolvedValue(
      fullStreamOf([
        { type: 'tool-result', toolName: 'offer_profile_form', output: {} },
        { type: 'finish' },
      ]),
    );
    const chunks = await readNdjson(await POST(req(userMsg)));
    expect(chunks).toContainEqual({ type: 'offer-form' });
  });

  it('an error stream part becomes a warm text-delta, still ending with done', async () => {
    mockRunConversation.mockResolvedValue(
      fullStreamOf([
        { type: 'text-delta', text: 'Let me look…' },
        { type: 'error', error: new Error('provider 429 rate-limited') },
        { type: 'finish' },
      ]),
    );
    const chunks = await readNdjson(await POST(req(userMsg)));
    const deltas = chunks.filter((c) => c.type === 'text-delta') as { delta: string }[];
    expect(deltas.some((d) => /something went sideways/i.test(d.delta))).toBe(true);
    expect(chunks[chunks.length - 1]).toEqual({ type: 'done' });
    // The raw provider error never reaches the wire.
    expect(JSON.stringify(chunks)).not.toContain('429');
  });

  it('a fullStream that THROWS mid-drain still delivers a warm delta + done (no dead stream)', async () => {
    mockRunConversation.mockResolvedValue({
      fullStream: (async function* () {
        yield { type: 'text-delta', text: 'partial…' };
        throw new Error('socket hang up');
      })(),
    });
    const chunks = await readNdjson(await POST(req(userMsg)));
    const deltas = chunks.filter((c) => c.type === 'text-delta') as { delta: string }[];
    expect(deltas.some((d) => /lost the thread/i.test(d.delta))).toBe(true);
    expect(chunks[chunks.length - 1]).toEqual({ type: 'done' });
    expect(JSON.stringify(chunks)).not.toContain('socket hang up');
  });
});

describe('reconcile profile saves (buffered pre-stream, direct mid-stream)', () => {
  it('a save landing BEFORE the stream opens is buffered and flushed as a profile-update chunk', async () => {
    mockRunConversation.mockImplementation(async (opts: { onProfileSaved: (u: string[]) => void }) => {
      opts.onProfileSaved(['hometown']); // fires while the route is still setting up
      return fullStreamOf([{ type: 'text-delta', text: 'Noted.' }, { type: 'finish' }]);
    });
    const chunks = await readNdjson(await POST(req(userMsg)));
    expect(chunks).toContainEqual({
      type: 'component',
      component: 'profile-update',
      props: { updated: ['hometown'] },
    });
    expect(chunks[chunks.length - 1]).toEqual({ type: 'done' });
  });

  it('a save landing MID-stream is enqueued directly', async () => {
    let onSaved: (u: string[]) => void = () => {};
    mockRunConversation.mockImplementation(async (opts: { onProfileSaved: (u: string[]) => void }) => {
      onSaved = opts.onProfileSaved;
      return {
        fullStream: (async function* () {
          yield { type: 'text-delta', text: 'One sec…' };
          onSaved(['children']); // fire-and-forget save resolves while streaming
          yield { type: 'finish' };
        })(),
      };
    });
    const chunks = await readNdjson(await POST(req(userMsg)));
    expect(chunks).toContainEqual({
      type: 'component',
      component: 'profile-update',
      props: { updated: ['children'] },
    });
  });
});
