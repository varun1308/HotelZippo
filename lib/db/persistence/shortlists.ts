/* shortlists persistence (Phase 4 · specs/04-auth-persistence.md Stage 4).
 * Client-side through the cookie-based anon SSR client → RLS scopes rows to the user.
 * The public.shortlists table stores hotel_ids (uuid[]), an optional trip_brief_id, and
 * a unique share_token (migration 0001). The in-memory shortlist (lib/shortlist) carries
 * display-ready SavedHotel rows; here we persist only the durable bit — the hotel ids —
 * keyed to the user. Display data is re-hydrated from `hotels` on read (RLS: reference
 * read), which keeps the saved set authoritative without duplicating hotel metadata.
 *
 * v1 keeps ONE active shortlist per user (the working set), updated in place. The
 * multi-shortlist / history UI is out of scope (Phase 5+). */
'use client';

import type { SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseBrowserClient } from '@/lib/db/ssr';

/** A short, URL-safe share token. Not security-sensitive (the share link is the
 * capability); just needs to be unique enough for the shortlists.share_token column. */
export function makeShareToken(): string {
  // 12 url-safe chars from crypto. Avoids Math.random; available in the browser.
  const bytes = new Uint8Array(9);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Persist the user's current shortlist (the set of saved hotel ids). Upserts the
 * single working shortlist row for this user — RLS WITH CHECK enforces ownership.
 * Returns the share_token so the UI can build a share link. */
export async function saveShortlist(
  hotelIds: string[],
  userId: string,
  opts: { tripBriefId?: string | null; client?: SupabaseClient } = {},
): Promise<{ shareToken: string }> {
  const client = opts.client ?? createSupabaseBrowserClient();

  // Reuse the existing working shortlist (keep its share_token stable) or mint one.
  const { data: existing } = await client
    .from('shortlists')
    .select('id, share_token')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  const shareToken = (existing?.share_token as string | undefined) ?? makeShareToken();
  const payload = {
    ...(existing?.id ? { id: existing.id } : {}),
    user_id: userId,
    hotel_ids: hotelIds,
    trip_brief_id: opts.tripBriefId ?? null,
    share_token: shareToken,
  };

  const { error } = await client.from('shortlists').upsert(payload);
  if (error) throw error;
  return { shareToken };
}

/** Load the user's saved hotel ids (the working shortlist), or [] if none. */
export async function loadShortlistHotelIds(
  client: SupabaseClient = createSupabaseBrowserClient(),
): Promise<string[]> {
  const { data, error } = await client
    .from('shortlists')
    .select('hotel_ids')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data?.hotel_ids as string[] | undefined) ?? [];
}
