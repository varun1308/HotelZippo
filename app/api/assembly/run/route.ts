/* POST /api/assembly/run — the recommendation-assembly WORKER step (specs/03c-async-assembly.md).
 *
 * Advances ONE recommendation_jobs row a step: atomically claim pending→running, run the assembly
 * (queryCandidates → assembleRecommendations → hydrate) on its OWN function budget, then persist
 * succeeded(result) | failed(kind). This is what moves the slow LLM call OFF the /api/chat 60s
 * critical path: the chat turn only creates the job + fires a best-effort kick here; the client polls
 * the job for staged progress + the final cards.
 *
 * Idempotent: a job that isn't `pending` (already running / terminal) → no-op 200. So a duplicate kick
 * (the chat fire-and-forget AND the poll-route re-kick) never double-runs the model.
 *
 * Internal/service route — our own server is the only intended caller (the chat dispatch kick + the
 * poll re-kick). When ASSEMBLY_WORKER_SECRET is configured, both kicks carry it in the
 * x-hz-worker-auth header and anything without it is rejected (lib/recommendations/worker-auth).
 * It uses the SERVICE client (writes bypass RLS). Body: { jobId }. Server-side only. */
import { createServiceClient } from '@/lib/db/server';
import { runAssembly } from '@/lib/recommendations/run-assembly';
import { hydrateHotels } from '@/lib/chat/agent';
import { AssemblyError } from '@/lib/recommendations/assemble';
import { verifyWorkerAuth } from '@/lib/recommendations/worker-auth';
import { withSpan, withCorrelation, HZ } from '@/lib/otel/trace';
import {
  claimJob,
  markStage,
  markSucceeded,
  markFailed,
  loadJob,
  type JobErrorKind,
  type RecommendationJob,
} from '@/lib/recommendations/job-ledger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// The worker has its OWN wall-clock budget, isolated from the chat function. The 45s assembly model
// timeout (assemble.ts) keeps a single step under this.
export const maxDuration = 60;

export async function POST(req: Request): Promise<Response> {
  // Internal-caller guard: when ASSEMBLY_WORKER_SECRET is set, only our own kicks (which carry
  // the header) may run the worker. Unset (key-free CI / env-free dev) → open, as before.
  if (!verifyWorkerAuth(req)) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  let jobId: string;
  try {
    const body = (await req.json()) as { jobId?: string };
    if (!body?.jobId) return Response.json({ ok: false, error: 'jobId required' }, { status: 400 });
    jobId = body.jobId;
  } catch {
    return Response.json({ ok: false, error: 'invalid_request' }, { status: 400 });
  }

  const service = createServiceClient();

  // Atomically claim: pending → running. If null, the job is already running/terminal (a duplicate
  // kick) — ack as a no-op so neither the chat kick nor the poll re-kick ever double-runs the model.
  let job: RecommendationJob | null;
  try {
    job = await claimJob(service, jobId);
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : 'claim_failed' }, { status: 500 });
  }
  if (!job) {
    const existing = await loadJob(service, jobId).catch(() => null);
    return Response.json({ ok: true, skipped: existing ? existing.status : 'not_found' }, { status: 200 });
  }

  // assembly.run via the shared span helper + hz.* keys (specs/14 "One helper" — never a hand-rolled
  // startActiveSpan). The worker is a separate HTTP request with EMPTY baggage, so conversation
  // correlation is rebuilt from the job row (conversation_id stored at dispatch) — withCorrelation
  // makes every child span (db.query, the assembly model call) inherit hz.conversation_id/hz.user_id.
  try {
    return await withCorrelation({ conversationId: job.conversationId, userId: job.userId }, () =>
      withSpan(
        'assembly.run',
        { attrs: { [HZ.jobId]: job!.id, [HZ.destination]: job!.destination } },
        async (span) => {
          // Honest staged progress (03c "honest, advancing"): runAssembly reports the REAL stage
          // boundaries — checking_intelligence right before the candidate query, writing right
          // before the model call — and we map them onto the job row. Best-effort marks.
          const assembly = await runAssembly(
            service,
            job!.input as Parameters<typeof runAssembly>[1],
            undefined,
            undefined,
            (stage) => markStage(service, job!.id, stage).catch(() => {}),
          );
          const hydrated = await hydrateHotels(service, assembly);

          // A terminal assembly error is a business outcome, not a crash → fail with the REAL
          // variant kind, and persist the variant payload on the job (budget_mismatch carries
          // reason + available_tiers, which drives different client copy — spec 08b-2 Step 1).
          if (hydrated && typeof hydrated === 'object' && 'error' in hydrated) {
            const kind: JobErrorKind =
              (hydrated as { error?: string }).error === 'budget_mismatch'
                ? 'budget_mismatch'
                : 'no_eligible_hotels';
            await markFailed(service, job!.id, kind, hydrated);
            span.setAttribute(HZ.outcome, kind);
            return Response.json({ ok: true, status: 'failed', error_kind: kind }, { status: 200 });
          }

          await markSucceeded(service, job!.id, hydrated);
          span.setAttribute(HZ.outcome, 'succeeded');
          return Response.json({ ok: true, status: 'succeeded' }, { status: 200 });
        },
      ),
    );
  } catch (e) {
    // withSpan already recorded the exception + ERROR status on assembly.run.
    const kind = errorKindOf(e);
    await markFailed(service, job.id, kind).catch(() => {});
    // 200 with a failed body: the failure is recorded on the job; the client poll surfaces the warm
    // fallback. (A 5xx would just make a retrying kicker hammer a job that's now terminal.)
    return Response.json({ ok: true, status: 'failed', error_kind: kind }, { status: 200 });
  }
}

/** Map a thrown error to the warm job error kind (spec 14). */
function errorKindOf(e: unknown): JobErrorKind {
  if (e instanceof AssemblyError) {
    // A model-call timeout surfaces as model_call_failed from the SDK timeout; treat as timeout when the
    // message says so, else a generic model failure.
    if (/timeout|timed out|aborted/i.test(e.message)) return 'timeout';
    return 'model_failed';
  }
  return 'unknown';
}
