/* Server-side Supabase service client — uses SUPABASE_SERVICE_ROLE_KEY and bypasses RLS.
 * Per specs/10a-supabase.md + 13: server-side ONLY. The `import 'server-only'` guard
 * makes the build fail if this module is ever pulled into a client component. */
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
  });
}
