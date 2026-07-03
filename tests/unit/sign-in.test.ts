/* Client auth actions contract (Phase 4 · specs/04-auth-persistence.md Stage 2 + Stage 5).
 * signInWithGoogle must start Google OAuth via the cookie-based browser client with the
 * redirect derived from the CURRENT origin (`${window.location.origin}/auth/callback`),
 * and surface failures by throwing (so the caller can show a warm, non-blocking error).
 * signOut must end the Supabase session and return the user to the landing page ('/').
 * Key-free: '@/lib/db/ssr' is mocked. jsdom's Location is [LegacyUnforgeable] (assign is
 * non-configurable, so jest.spyOn can't touch it) — we replace window.location wholesale
 * with a stub that keeps the real origin, and restore it after the suite. */
import { signInWithGoogle, signOut } from '@/lib/auth/signIn';

const mockSignInWithOAuth = jest.fn();
const mockSignOut = jest.fn();

const realLocation = window.location;
const assignMock = jest.fn();

beforeAll(() => {
  // @ts-expect-error jsdom allows delete+replace of the unforgeable Location
  delete window.location;
  // @ts-expect-error minimal stub: only origin + assign are consumed by lib/auth/signIn
  window.location = { origin: realLocation.origin, assign: assignMock };
});

afterAll(() => {
  // @ts-expect-error restore the real jsdom Location for other suites
  window.location = realLocation;
});

jest.mock('@/lib/db/ssr', () => ({
  createSupabaseBrowserClient: () => ({
    auth: {
      signInWithOAuth: (...args: unknown[]) => mockSignInWithOAuth(...args),
      signOut: () => mockSignOut(),
    },
  }),
}));

describe('signInWithGoogle', () => {
  beforeEach(() => {
    mockSignInWithOAuth.mockReset().mockResolvedValue({ error: null });
  });

  it('starts Google OAuth with redirectTo derived from the current origin', async () => {
    await signInWithGoogle();

    expect(mockSignInWithOAuth).toHaveBeenCalledTimes(1);
    expect(mockSignInWithOAuth).toHaveBeenCalledWith({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
    // The callback path is fixed — app/auth/callback/route.ts is the only landing pad.
    const { options } = mockSignInWithOAuth.mock.calls[0][0] as {
      options: { redirectTo: string };
    };
    expect(options.redirectTo).toMatch(/\/auth\/callback$/);
  });

  it('resolves when the OAuth redirect is initiated without error', async () => {
    await expect(signInWithGoogle()).resolves.toBeUndefined();
  });

  it('throws the Supabase error when the redirect cannot be initiated', async () => {
    const oauthError = new Error('OAuth provider not enabled');
    mockSignInWithOAuth.mockResolvedValue({ error: oauthError });

    await expect(signInWithGoogle()).rejects.toBe(oauthError);
  });
});

describe('signOut', () => {
  beforeEach(() => {
    mockSignOut.mockReset().mockResolvedValue({ error: null });
    assignMock.mockReset();
  });

  it('ends the session then navigates to the landing page', async () => {
    await signOut();

    expect(mockSignOut).toHaveBeenCalledTimes(1);
    expect(assignMock).toHaveBeenCalledTimes(1);
    expect(assignMock).toHaveBeenCalledWith('/');
  });

  it('signs out before navigating (order matters: cookie cleared, then redirect)', async () => {
    const order: string[] = [];
    mockSignOut.mockImplementation(async () => {
      order.push('signOut');
      return { error: null };
    });
    assignMock.mockImplementation(() => {
      order.push('navigate');
    });

    await signOut();
    expect(order).toEqual(['signOut', 'navigate']);
  });

  it('still navigates home when Supabase reports a sign-out error (current contract: error ignored)', async () => {
    mockSignOut.mockResolvedValue({ error: new Error('network down') });

    await expect(signOut()).resolves.toBeUndefined();
    expect(assignMock).toHaveBeenCalledWith('/');
  });
});
