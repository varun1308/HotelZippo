/* Dev-only email/password sign-in (LOCAL DEVELOPMENT ONLY — never a production path).
 *
 * Production auth is Google-only (lib/auth/signIn.ts + the landing Google button). This
 * exists so a developer can reach the hard-gated /chat route locally WITHOUT setting up
 * Google OAuth — it signs in a seeded dev user (see scripts/dev/seed-dev-user.ts) against
 * local Supabase, producing a real cookie session so the middleware gate passes and
 * persistence + the booking routes work end-to-end.
 *
 * SAFETY: doubly guarded so it can never act in production —
 *   1. It throws unless NEXT_PUBLIC_ENABLE_DEV_LOGIN === 'true' (a flag you set ONLY in
 *      .env.local; it is absent in every real deployment).
 *   2. The UI affordance that calls it (components/landing/DevSignIn) renders only under
 *      the same flag, so production shows Google-only, unchanged.
 * Keep both guards. */
'use client';

import { createSupabaseBrowserClient } from '@/lib/db/ssr';

/** True only when the dev-login flag is explicitly enabled (local .env.local). */
export function devLoginEnabled(): boolean {
  return process.env.NEXT_PUBLIC_ENABLE_DEV_LOGIN === 'true';
}

/** Sign in a seeded dev user by email/password against local Supabase, then land on /chat.
 * No-ops loudly (throws) unless the dev-login flag is on. */
export async function devSignIn(email: string, password: string): Promise<void> {
  if (!devLoginEnabled()) {
    throw new Error('Dev sign-in is disabled. Set NEXT_PUBLIC_ENABLE_DEV_LOGIN=true in .env.local (local only).');
  }
  const supabase = createSupabaseBrowserClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  window.location.assign('/chat');
}
