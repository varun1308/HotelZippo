/* sessions persistence (Phase 5 · specs/08b-3-session-snapshot.md).
 * The session snapshot lifecycle: GENERATE (lib/chat/session-snapshot.ts) → PERSIST here
 * → LOAD here on resume. The <session_snapshot> consumption seam is Phase 3.
 *
 * Resume model (locked v1): ONE rolling session per user. We keep a single working
 * `sessions` row and update its session_summary + last_active in place, so "the most
 * recent session" is unambiguous and there's no row accumulation. A multi-session picker
 * is post-v1. RLS scopes every read/write to auth.uid() = user_id.
 *
 * The browser uses createSupabaseBrowserClient (loadLatestSnapshot, on /chat mount); the
 * snapshot API route uses a request-scoped server client (saveSnapshot at trigger points). */
import type { SupabaseClient } from '@supabase/supabase-js';

/** Upsert the user's rolling session snapshot and bump last_active. Reuses the existing
 * working row (so "most recent" stays a single row) or inserts the first one. The caller
 * supplies a client already authenticated as the user (browser anon client or a
 * request-scoped server client) — RLS WITH CHECK enforces ownership. */
export async function saveSnapshot(
  client: SupabaseClient,
  userId: string,
  summary: string,
  opts: { tripBriefId?: string | null } = {},
): Promise<void> {
  const { data: existing } = await client
    .from('sessions')
    .select('id')
    .order('last_active', { ascending: false })
    .limit(1)
    .maybeSingle();

  const row = {
    ...(existing?.id ? { id: existing.id } : {}),
    user_id: userId,
    session_summary: summary,
    last_active: new Date().toISOString(),
    ...(opts.tripBriefId !== undefined ? { trip_brief_id: opts.tripBriefId } : {}),
  };

  const { error } = await client.from('sessions').upsert(row);
  if (error) throw error;
}

/** Load the user's most recent session summary (by last_active), or null if none.
 * null ⇒ first session ⇒ fresh onboarding (the <session_snapshot> seam treats empty
 * as a brand-new user). */
export async function loadLatestSnapshot(client: SupabaseClient): Promise<string | null> {
  const { data, error } = await client
    .from('sessions')
    .select('session_summary')
    .order('last_active', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  const summary = (data?.session_summary as string | null | undefined) ?? null;
  return summary && summary.trim().length > 0 ? summary : null;
}
