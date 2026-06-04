/* Browser Supabase client — anon key, RLS-enforced. Safe for client components.
 * Per specs/10a-supabase.md: used for a user's own reads/writes under RLS. */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export function createBrowserClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY (see specs/13-environment.md).',
    );
  }
  return createClient(url, anonKey);
}
