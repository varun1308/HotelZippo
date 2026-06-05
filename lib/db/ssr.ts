/* Cookie-based Supabase clients for the App Router (Phase 4 · Auth & Persistence).
 * Per specs/04-auth-persistence.md Stage 2: real Google OAuth sessions are stored in
 * cookies via @supabase/ssr, so server components, route handlers, and middleware all
 * read the SAME session and RLS scopes rows to the signed-in user (auth.uid()).
 *
 * These use the ANON key (RLS-enforced) — never the service-role key. The service client
 * (lib/db/server.ts) stays separate for the admin/pipeline paths that must bypass RLS.
 *
 * Env is read at call time, never at import (lazy-throw), so pages that never construct
 * a client still render with no Supabase env set — same discipline as lib/db/{server,client}.ts.
 *
 * Distinct names from lib/db/client.ts's createBrowserClient (a plain non-cookie anon
 * client kept for existing non-auth reads): the SSR helpers below are the auth-aware ones. */
import { createBrowserClient, createServerClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';

/** Cookie store shape the server/middleware helpers need — matches Next's cookies() API
 * and the NextRequest/NextResponse cookie bridge used in middleware. Kept minimal so both
 * `cookies()` (route handlers / server components) and the middleware bridge satisfy it. */
export interface CookieMethods {
  getAll: () => Array<{ name: string; value: string }>;
  setAll: (
    cookies: Array<{ name: string; value: string; options?: Record<string, unknown> }>,
  ) => void;
}

function requireEnv(): { url: string; anonKey: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY (see specs/13-environment.md).',
    );
  }
  return { url, anonKey };
}

/** Browser client for client components — anon key, RLS-enforced, reads the auth cookie.
 * Use this (not lib/db/client.ts) anywhere a signed-in user's own rows are read/written. */
export function createSupabaseBrowserClient(): SupabaseClient {
  const { url, anonKey } = requireEnv();
  return createBrowserClient(url, anonKey);
}

/** Server client for route handlers and server components. Pass the cookie adapter from
 * `cookies()` (route handlers / server components) or the middleware bridge. The callback
 * receives a getAll/setAll pair; in read-only server-component contexts setAll may no-op. */
export function createSupabaseServerClient(cookies: CookieMethods): SupabaseClient {
  const { url, anonKey } = requireEnv();
  return createServerClient(url, anonKey, {
    cookies: {
      getAll: () => cookies.getAll(),
      setAll: (toSet) => cookies.setAll(toSet),
    },
  });
}
