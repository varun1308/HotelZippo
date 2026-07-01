/* GET /api/assembly/:jobId — poll a recommendation-assembly job (specs/03c-async-assembly.md).
 *
 * The client's AssemblyProgress block polls this every ~2s to advance the staged status line and pick
 * up the final result. Reads the job through the user's COOKIE client so OWNER-READ RLS applies — a
 * user can only poll their own job (a job row for another user, or none, returns 404).
 *
 * Best-effort RE-KICK: if the job is still `pending` (the chat turn's fire-and-forget kick was lost),
 * fire POST /api/assembly/run so progress never stalls — the poll route is the reliable backstop on
 * Hobby (no waitUntil). The worker's atomic claim makes a duplicate kick a no-op.
 *
 * Returns { status, stage, result?, error_kind? } — the result is the already-hydrated recommendation
 * props the client renders as cards. Server-side only. */
import { cookies } from 'next/headers';
import { createSupabaseServerClient } from '@/lib/db/ssr';
import { createServiceClient } from '@/lib/db/server';
import { reclaimStale } from '@/lib/recommendations/job-ledger';
import { withSpan, HZ, isValidConversationId } from '@/lib/otel/trace';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request, ctx: { params: Promise<{ jobId: string }> }): Promise<Response> {
  const { jobId } = await ctx.params;
  if (!jobId) return Response.json({ error: 'jobId required' }, { status: 400 });

  // Correlate this poll to the conversation that spawned the job (specs/14). The client passes
  // conversation_id as a query param; validated so a hostile value can't poison the attribute.
  const convParam = new URL(req.url).searchParams.get('conversation_id');
  const conversationId = isValidConversationId(convParam) ? convParam : undefined;

  return withSpan(
    'assembly.poll',
    { attrs: { [HZ.jobId]: jobId, ...(conversationId ? { [HZ.conversationId]: conversationId } : {}) } },
    () => pollJob(req, jobId),
  );
}

async function pollJob(req: Request, jobId: string): Promise<Response> {
  const cookieStore = await cookies();
  const supabase = createSupabaseServerClient({ getAll: () => cookieStore.getAll(), setAll: () => {} });

  // Owner-read: RLS scopes this SELECT to the signed-in user's own jobs. A non-owner / missing job → null.
  const { data, error } = await supabase
    .from('recommendation_jobs')
    .select('status, stage, result, error_kind, started_at, attempts')
    .eq('id', jobId)
    .maybeSingle();

  if (error) return Response.json({ error: 'lookup_failed' }, { status: 500 });
  if (!data) return Response.json({ error: 'not_found' }, { status: 404 });

  let status = data.status as string;

  // Stuck-job reclaim: a job stuck in `running` past the worker budget (its worker died) is flipped
  // back to pending (under the attempts cap) or failed (over it) via the service client — owner-read
  // can't write. Best-effort; never blocks the poll. A reclaimed→pending job then re-kicks below.
  if (status === 'running') {
    try {
      const reclaimed = await reclaimStale(createServiceClient(), {
        id: jobId,
        status: 'running',
        startedAt: data.started_at as string | null,
        attempts: (data.attempts as number) ?? 0,
      });
      if (reclaimed) status = reclaimed;
    } catch {
      /* reclaim is best-effort */
    }
  }

  // Re-kick a pending job (a lost initial kick, or a just-reclaimed stale one) so progress never stalls.
  // Fire-and-forget; the worker's atomic claim guards against double-run. Never blocks the response.
  if (status === 'pending') {
    const origin = new URL(req.url).origin;
    void fetch(`${origin}/api/assembly/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobId }),
      cache: 'no-store',
    }).catch(() => {});
  }

  return Response.json(
    {
      status,
      stage: status === 'failed' && data.status !== 'failed' ? 'done' : data.stage,
      result: data.result ?? undefined,
      error_kind: status === 'failed' && data.status !== 'failed' ? 'timeout' : (data.error_kind ?? undefined),
    },
    { status: 200 },
  );
}
