/* Client-side auth actions (Phase 4 · specs/04-auth-persistence.md Stage 2 + Stage 5).
 * Google-only sign-in + sign-out, on top of the cookie-based @supabase/ssr browser
 * client. All the secret handling lives in Supabase + Google Cloud — the app only ever
 * touches the public anon key (hard rules #2, #5). */
'use client';

import { createSupabaseBrowserClient } from '@/lib/db/ssr';

/** Begin Google OAuth. Resolves into a browser redirect to Google's consent screen;
 * Google then returns to /auth/callback (see app/auth/callback/route.ts). Throws if the
 * redirect cannot be initiated so the caller can surface a warm, non-blocking error. */
export async function signInWithGoogle(): Promise<void> {
  const supabase = createSupabaseBrowserClient();
  const redirectTo = `${window.location.origin}/auth/callback`;
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo },
  });
  if (error) throw error;
}

/** Sign out and return to the landing page. */
export async function signOut(): Promise<void> {
  const supabase = createSupabaseBrowserClient();
  await supabase.auth.signOut();
  window.location.assign('/');
}
