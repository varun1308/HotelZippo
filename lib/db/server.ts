/* Server-side Supabase service client — uses SUPABASE_SERVICE_ROLE_KEY and bypasses RLS.
 * Per specs/10a-supabase.md + 13: server-side ONLY. The `import 'server-only'` guard
 * makes the build fail if this module is ever pulled into a client component.
 *
 * The env check throws LAZILY — only when createServiceClient() is called (e.g. inside
 * the /api/chat assemble tool at request time), never at import. Missing Supabase env
 * therefore never breaks page render; it surfaces as a graceful request-time error. */
import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export function createServiceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (see specs/13-environment.md).',
    );
  }
  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: {
      // Opt out of Next.js's patched-fetch cache. Next memoises GETs by URL inside route
      // handlers; a repeated list query (same URL every call) would otherwise return a STALE
      // first response — e.g. an empty apify_runs list cached before any run existed, so the
      // curation Runs panel never updated. Service-role reads are always live data, never
      // cacheable. (`dynamic='force-dynamic'` covers route rendering, not the SDK's internal
      // fetch — this does.)
      fetch: (input, init) => fetch(input, { ...init, cache: 'no-store' }),
    },
  });
}
