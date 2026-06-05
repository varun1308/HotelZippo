/* Phase 4 (specs/04-auth-persistence.md Stage 2 + 3): middleware gating + OAuth callback.
 * Acceptance criteria covered: unauthenticated GET /chat redirects to /; an authed user
 * is let through; /admin/* is NOT gated; the callback exchanges the code → /chat, and on
 * error/no-code redirects to /?error=auth (warm non-blocking path, spec 14). Supabase is
 * mocked — no network, no DB, no Google. Lives in the node project for the web APIs
 * (NextRequest/NextResponse), like the chat-route tests. */
import { NextRequest } from 'next/server';

// Mock @supabase/ssr's createServerClient so we control getUser()/exchangeCodeForSession.
const mockGetUser = jest.fn();
const mockExchange = jest.fn();
jest.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: {
      getUser: (...a: unknown[]) => mockGetUser(...a),
      exchangeCodeForSession: (...a: unknown[]) => mockExchange(...a),
    },
  }),
}));
// The callback route imports the ssr helper, which imports @supabase/ssr (mocked above).

const ENV = { NEXT_PUBLIC_SUPABASE_URL: 'http://localhost:54321', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon' };
beforeAll(() => Object.assign(process.env, ENV));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { middleware } = require('@/middleware');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { GET } = require('@/app/auth/callback/route');

function req(url: string): NextRequest {
  return new NextRequest(new Request(url));
}

describe('middleware — route gating', () => {
  beforeEach(() => mockGetUser.mockReset());

  it('redirects an unauthenticated request to /chat → /', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const res = await middleware(req('http://localhost:3000/chat'));
    expect(res.status).toBe(307); // NextResponse.redirect
    expect(res.headers.get('location')).toBe('http://localhost:3000/');
  });

  it('lets an authenticated request to /chat through (no redirect)', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    const res = await middleware(req('http://localhost:3000/chat'));
    expect(res.status).not.toBe(307);
    expect(res.headers.get('location')).toBeNull();
  });
});

describe('OAuth callback', () => {
  beforeEach(() => mockExchange.mockReset());

  it('exchanges a code and redirects to /chat', async () => {
    mockExchange.mockResolvedValue({ error: null });
    const res = await GET(req('http://localhost:3000/auth/callback?code=abc'));
    expect(res.headers.get('location')).toBe('http://localhost:3000/chat');
    expect(mockExchange).toHaveBeenCalledWith('abc');
  });

  it('redirects to /?error=auth when there is no code', async () => {
    const res = await GET(req('http://localhost:3000/auth/callback'));
    expect(res.headers.get('location')).toBe('http://localhost:3000/?error=auth');
    expect(mockExchange).not.toHaveBeenCalled();
  });

  it('redirects to /?error=auth when the exchange fails', async () => {
    mockExchange.mockResolvedValue({ error: new Error('bad code') });
    const res = await GET(req('http://localhost:3000/auth/callback?code=bad'));
    expect(res.headers.get('location')).toBe('http://localhost:3000/?error=auth');
  });

  it('redirects to /?error=auth when Google returns an error param', async () => {
    const res = await GET(req('http://localhost:3000/auth/callback?error=access_denied'));
    expect(res.headers.get('location')).toBe('http://localhost:3000/?error=auth');
    expect(mockExchange).not.toHaveBeenCalled();
  });
});
