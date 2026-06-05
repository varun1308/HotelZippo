/* Session snapshot endpoint (Phase 5 · specs/08b-3-session-snapshot.md).
 * POST { messages } at a trigger point (session end / 30-min inactivity / navigation away).
 * Generates the snapshot SERVER-SIDE (the Anthropic key is server-only) and persists it to
 * the signed-in user's rolling sessions row (session_summary + last_active), user-scoped by
 * RLS. Returns 204 on success (the client doesn't need the body — it often fires via
 * navigator.sendBeacon on unload). Unauthenticated or empty → a quiet no-op, never an error
 * surfaced to the user (spec 14: warm, non-blocking).
 *
 * Generation is best-effort: this is a background save, so any failure returns a non-2xx
 * the client ignores rather than disrupting the conversation. */
import { cookies } from 'next/headers';
import { createSupabaseServerClient } from '@/lib/db/ssr';
import { generateSnapshot } from '@/lib/chat/session-snapshot';
import { saveSnapshot } from '@/lib/db/persistence/sessions';
import { toModelMessages } from '@/lib/chat/to-model-messages';
import type { ChatMessage } from '@/lib/chat/types';

export async function POST(req: Request): Promise<Response> {
  let body: { messages?: ChatMessage[] };
  try {
    body = await req.json();
  } catch {
    return new Response(null, { status: 204 }); // nothing to snapshot
  }
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return new Response(null, { status: 204 });
  }

  const cookieStore = await cookies();
  const supabase = createSupabaseServerClient({
    getAll: () => cookieStore.getAll(),
    // A route handler reading a GET-like snapshot doesn't need to set auth cookies; the
    // session is already established. setAll is a no-op here.
    setAll: () => {},
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    // Not signed in (shouldn't happen behind the gate) → quiet no-op.
    return new Response(null, { status: 204 });
  }

  try {
    const summary = await generateSnapshot(toModelMessages(body.messages));
    await saveSnapshot(supabase, user.id, summary);
    return new Response(null, { status: 204 });
  } catch (e) {
    // Background save failed — log via OTEL (the generator already records the span);
    // return 502 so the client can ignore it. Never a user-facing error.
    return Response.json(
      { error: 'snapshot_failed', reason: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }
}
