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
import { PRICE_TIER_LABELS } from '@/components/recommendation/types';
import type { SavedHotelFlag, SavedHotelWithFlags } from '@/components/shortlist';

/** A short, URL-safe share token. Not security-sensitive (the share link is the
 * capability); just needs to be unique enough for the shortlists.share_token column. */
export function makeShareToken(): string {
  // 12 url-safe chars from crypto. Avoids Math.random; available in the browser.
  const bytes = new Uint8Array(9);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Persist the user's current shortlist (the set of saved hotel ids). ONE working row per
 * user is enforced by unique(user_id) (migration 0019), so this is a race-safe upsert on
 * user_id — the old select-then-insert could double-insert under concurrency, and a
 * duplicate row made saved hotels permanently invisible (save and load both pick one row).
 * RLS WITH CHECK enforces ownership. Returns the share_token for the share link. */
export async function saveShortlist(
  hotelIds: string[],
  userId: string,
  opts: { tripBriefId?: string | null; client?: SupabaseClient } = {},
): Promise<{ shareToken: string }> {
  const client = opts.client ?? createSupabaseBrowserClient();

  // Keep the existing row's share_token stable across saves; mint one only for the first save.
  const { data: existing } = await client
    .from('shortlists')
    .select('share_token')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  const shareToken = (existing?.share_token as string | undefined) ?? makeShareToken();
  const payload = {
    user_id: userId,
    hotel_ids: hotelIds,
    trip_brief_id: opts.tripBriefId ?? null,
    share_token: shareToken,
  };

  const { error } = await client.from('shortlists').upsert(payload, { onConflict: 'user_id' });
  if (error) throw error;
  return { shareToken };
}

/** The share link for a shortlist share_token (spec 05 §6/§7 Share). The token IS the
 *  capability; one helper so every Share affordance renders the same URL shape. */
export function shortlistShareUrl(shareToken: string, origin: string): string {
  return `${origin.replace(/\/$/, '')}/shortlist/shared/${encodeURIComponent(shareToken)}`;
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

/** A `hotels` row as read for shortlist re-hydration (the display-ready subset). */
interface ShortlistHotelRow {
  id: string;
  name: string;
  destination: string;
  area: string | null;
  price_tier: string | null;
  images: string[] | null;
}

/** Re-hydrate the working shortlist into display-ready `SavedHotel` rows: load the saved
 * hotel ids, then read those hotels (RLS: `hotels` is reference-readable) and map them to the
 * panel's shape — preserving the SAVED order (not the DB order). This is the read half the
 * persistence header always intended; the chat page calls it on mount so a saved shortlist
 * survives a reload. Missing/unpublished ids are simply dropped (never a broken row).
 *
 * Hard flags (M14 / spec 05 §6): re-hydrated from `hotel_intelligence` (also
 * reference-readable), the same source the assembly draws them from — so the panel's flag
 * dots survive a reload WITHOUT widening the shortlists row (hotel_ids stays the only
 * durable bit). Best-effort + backward compatible: a hotel with no intelligence row (or an
 * intelligence read failure) simply gets no dots, never a broken shortlist. */
export async function loadShortlistHotels(
  client: SupabaseClient = createSupabaseBrowserClient(),
): Promise<SavedHotelWithFlags[]> {
  const ids = await loadShortlistHotelIds(client);
  if (ids.length === 0) return [];

  const { data, error } = await client
    .from('hotels')
    .select('id, name, destination, area, price_tier, images')
    .in('id', ids);
  if (error) throw error;

  const flagsById = await loadHardFlagSeverities(client, ids);

  const byId = new Map<string, ShortlistHotelRow>(
    ((data as ShortlistHotelRow[] | null) ?? []).map((h) => [h.id, h]),
  );
  // Map in the saved order; drop ids that no longer resolve to a hotel.
  return ids
    .map((id) => byId.get(id))
    .filter((h): h is ShortlistHotelRow => Boolean(h))
    .map((h) => ({
      hotelId: h.id,
      hotelName: h.name,
      destination: h.destination,
      area: h.area,
      priceTierLabel: h.price_tier ? PRICE_TIER_LABELS[h.price_tier] ?? h.price_tier : null,
      heroImageUrl: h.images?.[0] ?? null,
      hardFlags: flagsById.get(h.id) ?? [],
    }));
}

/** Minimal hard-flag severities per hotel, from `hotel_intelligence.hard_flags` (jsonb).
 *  Best-effort: any failure (missing table access, malformed rows) → empty map. */
async function loadHardFlagSeverities(
  client: SupabaseClient,
  hotelIds: string[],
): Promise<Map<string, SavedHotelFlag[]>> {
  const map = new Map<string, SavedHotelFlag[]>();
  try {
    const { data, error } = await client
      .from('hotel_intelligence')
      .select('hotel_id, hard_flags')
      .in('hotel_id', hotelIds);
    if (error || !data) return map;
    for (const row of data as Array<{ hotel_id: string; hard_flags: unknown }>) {
      if (!Array.isArray(row.hard_flags)) continue;
      const flags = row.hard_flags
        .map((f) => (f && typeof f === 'object' ? (f as { severity?: unknown }).severity : null))
        .filter((s): s is SavedHotelFlag['severity'] => s === 'moderate' || s === 'severe')
        .map((severity) => ({ severity }));
      if (flags.length > 0) map.set(row.hotel_id, flags);
    }
  } catch {
    /* warm-fail: no dots is safe degradation; the card-level flags remain authoritative */
  }
  return map;
}
