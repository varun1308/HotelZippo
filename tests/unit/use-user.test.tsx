/* useUser contract (Phase 4 · specs/04-auth-persistence.md): the client-side session
 * hydration hook reads the cookie-based @supabase/ssr browser client and exposes the
 * display identity (name / email / avatar from Google OAuth metadata) plus the user id.
 * Covers: initial loading → session resolved, metadata fallbacks (name/picture), the
 * signed-out and no-env degradation paths (user stays null, page still renders), and
 * the unmount guard (a late-resolving session must not update state after unmount).
 * Key-free: '@/lib/db/ssr' is mocked; the hook's lazy dynamic import resolves to it. */
import { renderHook, waitFor } from '@testing-library/react';
import { act } from 'react';
import { useUser } from '@/lib/auth/useUser';

type GetUserResult = { data: { user: Record<string, unknown> | null } };

const mockGetUser = jest.fn<Promise<GetUserResult>, []>();
const mockCreateClient = jest.fn(() => ({ auth: { getUser: mockGetUser } }));

jest.mock('@/lib/db/ssr', () => ({
  createSupabaseBrowserClient: () => mockCreateClient(),
}));

const googleUser = {
  id: 'user-raj-1',
  email: 'raj@example.com',
  user_metadata: {
    full_name: 'Raj Mehta',
    avatar_url: 'https://example.com/raj.jpg',
  },
};

describe('useUser', () => {
  beforeEach(() => {
    mockGetUser.mockReset();
    mockCreateClient.mockClear();
  });

  it('starts loading with no user, then resolves the signed-in identity', async () => {
    mockGetUser.mockResolvedValue({ data: { user: googleUser } });

    const { result } = renderHook(() => useUser());

    // Initial render: loading, user null (middleware guards the route meanwhile).
    expect(result.current.loading).toBe(true);
    expect(result.current.user).toBeNull();

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.user).toEqual({
      id: 'user-raj-1',
      name: 'Raj Mehta',
      email: 'raj@example.com',
      avatarUrl: 'https://example.com/raj.jpg',
    });
  });

  it('falls back to the `name` / `picture` metadata keys when full_name / avatar_url are absent', async () => {
    mockGetUser.mockResolvedValue({
      data: {
        user: {
          id: 'user-raj-2',
          email: 'raj@example.com',
          user_metadata: { name: 'Raj M', picture: 'https://example.com/p.jpg' },
        },
      },
    });

    const { result } = renderHook(() => useUser());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.user).toMatchObject({
      name: 'Raj M',
      avatarUrl: 'https://example.com/p.jpg',
    });
  });

  it('maps missing email/metadata to nulls (never undefined)', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'user-raj-3', user_metadata: undefined } },
    });

    const { result } = renderHook(() => useUser());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.user).toEqual({
      id: 'user-raj-3',
      name: null,
      email: null,
      avatarUrl: null,
    });
  });

  it('leaves user null when there is no session (signed out)', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });

    const { result } = renderHook(() => useUser());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.user).toBeNull();
  });

  it('degrades to null (not a crash) when the client cannot be constructed — e.g. missing env', async () => {
    mockCreateClient.mockImplementationOnce(() => {
      throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY');
    });

    const { result } = renderHook(() => useUser());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.user).toBeNull();
  });

  it('does not update state when the session resolves after unmount (active-flag guard)', async () => {
    let resolveGetUser: (v: GetUserResult) => void = () => {};
    mockGetUser.mockReturnValue(
      new Promise<GetUserResult>((resolve) => {
        resolveGetUser = resolve;
      }),
    );
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const { result, unmount } = renderHook(() => useUser());
    expect(result.current.loading).toBe(true);

    unmount();
    // Session resolves AFTER unmount — the hook must not set state (no React warnings).
    await act(async () => {
      resolveGetUser({ data: { user: googleUser } });
    });

    expect(result.current.loading).toBe(true); // last committed snapshot, unchanged
    expect(result.current.user).toBeNull();
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
