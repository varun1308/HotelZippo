/**
 * @jest-environment node
 *
 * Hard auth gates on the paid-model routes (spec 04 "hard gate, no guest chat").
 *
 * POST /api/chat and POST /api/recommendations/assemble must reject anonymous callers whenever
 * Supabase auth env is configured (paid agent turns + service-client assembly were reachable
 * anonymously before). Env-free (no Supabase vars — key-free CI / dev) stays ungated.
 *
 * Key-free + DB-free: the Supabase SSR client and the agent/assembly internals are mocked;
 * only the routes' gating logic is under test.
 */
jest.mock('server-only', () => ({}));

// Controllable auth seam: what the cookie client's getUser() resolves to.
let mockUser: { id: string } | null = null;
jest.mock('@/lib/db/ssr', () => ({
  createSupabaseServerClient: () => ({
    auth: { getUser: async () => ({ data: { user: mockUser } }) },
  }),
}));

// Request-scope seam: routes read cookies() inside the handler; give them a working store.
jest.mock('next/headers', () => ({
  cookies: async () => ({ getAll: () => [] }),
}));

// The agent — the chat route only needs a drainable fullStream back.
const mockRunConversation = jest.fn();
jest.mock('@/lib/chat/agent', () => ({
  runConversation: (...args: unknown[]) => mockRunConversation(...args),
}));

// The saved-profile load (L19) — not under test here.
jest.mock('@/lib/db/persistence/family-profiles', () => ({
  loadFamilyProfile: jest.fn(async () => null),
}));

// The assemble route's internals.
const mockRunAssembly = jest.fn();
jest.mock('@/lib/recommendations/run-assembly', () => ({
  runAssembly: (...args: unknown[]) => mockRunAssembly(...args),
}));
jest.mock('@/lib/db/server', () => ({
  createServiceClient: () => ({}),
}));

/* eslint-disable @typescript-eslint/no-var-requires */
const { POST: chatPOST } = require('@/app/api/chat/route');
const { POST: assemblePOST } = require('@/app/api/recommendations/assemble/route');

const ENV_KEYS = ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY'] as const;
const savedEnv: Record<string, string | undefined> = {};
beforeAll(() => {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  mockUser = null;
  mockRunConversation.mockReset();
  mockRunAssembly.mockReset();
});

function configureAuthEnv() {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key';
}
function clearAuthEnv() {
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
}

function chatReq() {
  return new Request('http://localhost/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      messages: [{ id: 'u0', role: 'user', parts: [{ type: 'text', text: 'hi' }] }],
    }),
  });
}
function assembleReq() {
  return new Request('http://localhost/api/recommendations/assemble', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ family_profile: {}, trip_brief: { destination: 'Phuket' } }),
  });
}

const emptyStream = () => ({ fullStream: (async function* () {})() });

describe('POST /api/chat auth gate (H1)', () => {
  it('401s an anonymous caller when Supabase auth env is configured', async () => {
    configureAuthEnv();
    const res = await chatPOST(chatReq());
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('auth_required');
    expect(mockRunConversation).not.toHaveBeenCalled(); // no paid turn for an anon caller
  });

  it('runs the turn for a signed-in user', async () => {
    configureAuthEnv();
    mockUser = { id: 'user-1' };
    mockRunConversation.mockResolvedValue(emptyStream());
    const res = await chatPOST(chatReq());
    expect(res.status).toBe(200);
    expect(mockRunConversation).toHaveBeenCalled();
  });

  it('stays ungated when Supabase env is absent (key-free CI / env-free dev)', async () => {
    clearAuthEnv();
    mockRunConversation.mockResolvedValue(emptyStream());
    const res = await chatPOST(chatReq());
    expect(res.status).toBe(200);
    expect(mockRunConversation).toHaveBeenCalled();
  });
});

describe('POST /api/recommendations/assemble auth gate (H2)', () => {
  it('401s an anonymous caller when Supabase auth env is configured', async () => {
    configureAuthEnv();
    const res = await assemblePOST(assembleReq());
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('auth_required');
    expect(mockRunAssembly).not.toHaveBeenCalled(); // no anonymous paid assembly
  });

  it('assembles for a signed-in user', async () => {
    configureAuthEnv();
    mockUser = { id: 'user-1' };
    mockRunAssembly.mockResolvedValue({ error: 'no_eligible_hotels', reason: 'none yet' });
    const res = await assemblePOST(assembleReq());
    expect(res.status).toBe(200);
    expect(mockRunAssembly).toHaveBeenCalled();
  });

  it('stays ungated when Supabase env is absent', async () => {
    clearAuthEnv();
    mockRunAssembly.mockResolvedValue({ error: 'no_eligible_hotels', reason: 'none yet' });
    const res = await assemblePOST(assembleReq());
    expect(res.status).toBe(200);
    expect(mockRunAssembly).toHaveBeenCalled();
  });
});
