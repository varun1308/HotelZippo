/* useUser — the signed-in user, client-side (Phase 4 · specs/04-auth-persistence.md).
 * Reads the cookie-based session via the @supabase/ssr browser client and exposes the
 * display identity (name / email / avatar from the Google OAuth metadata) plus the user
 * id used to key persistence. On the hard-gated /chat route a user is always present in
 * practice (middleware redirects otherwise); `null` while loading or if env is absent. */
'use client';

import { useEffect, useState } from 'react';

export interface AppUser {
  id: string;
  name: string | null;
  email: string | null;
  avatarUrl: string | null;
}

export function useUser(): { user: AppUser | null; loading: boolean } {
  const [user, setUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        // Imported lazily so the module (and its env requirement) is only hit in the
        // browser at runtime — keeps SSR/build env-free, matching the lazy-throw clients.
        const { createSupabaseBrowserClient } = await import('@/lib/db/ssr');
        const supabase = createSupabaseBrowserClient();
        const {
          data: { user: u },
        } = await supabase.auth.getUser();
        if (!active) return;
        if (u) {
          const meta = (u.user_metadata ?? {}) as Record<string, unknown>;
          setUser({
            id: u.id,
            name: (meta.full_name as string) ?? (meta.name as string) ?? null,
            email: u.email ?? null,
            avatarUrl: (meta.avatar_url as string) ?? (meta.picture as string) ?? null,
          });
        }
      } catch {
        // No env / not signed in → leave user null; the page still renders.
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  return { user, loading };
}
