/* Browser Supabase client — anon key, RLS-enforced. Safe for client components.
 * Per specs/10a-supabase.md: used for a user's own reads/writes under RLS.
 *
 * The env check throws LAZILY — only when this factory is actually called (at request
 * time), never at import. So pages that don't construct a client still render with no
 * Supabase env set. See README "Running it locally". */
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
