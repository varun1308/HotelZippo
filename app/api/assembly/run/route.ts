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
 * Internal/service route — no user auth gate (the caller is our own server). It uses the SERVICE client
 * (writes bypass RLS). Body: { jobId }. Server-side only. */
import { trace, SpanStatusCode } from '@opentelemetry/api';
import { createServiceClient } from '@/lib/db/server';
import { runAssembly } from '@/lib/recommendations/run-assembly';
import { hydrateHotels } from '@/lib/chat/agent';
import { AssemblyError } from '@/lib/recommendations/assemble';
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

  const tracer = trace.getTracer('hotelzippo');
  return tracer.startActiveSpan('assembly.run', async (span) => {
    span.setAttribute('job_id', job!.id);
    span.setAttribute('destination', job!.destination);
    const start = Date.now();
    try {
      // Stage: checking the review intelligence (queryCandidates happens inside runAssembly). We mark
      // the coarse stages here so the client's progress line advances honestly.
      await markStage(service, job!.id, 'checking_intelligence');
      // runAssembly + hydrate — the EXACT path the chat tool ran inline before (now off the chat budget).
      await markStage(service, job!.id, 'writing');
      const assembly = await runAssembly(service, job!.input as Parameters<typeof runAssembly>[1]);
      const hydrated = await hydrateHotels(service, assembly);

      // A terminal "no eligible hotels" is a business outcome, not a crash → fail with the warm kind.
      if (hydrated && typeof hydrated === 'object' && 'error' in hydrated) {
        await markFailed(service, job!.id, 'no_eligible_hotels');
        span.setAttribute('outcome', 'no_eligible_hotels');
        span.setStatus({ code: SpanStatusCode.OK });
        return Response.json({ ok: true, status: 'failed', error_kind: 'no_eligible_hotels' }, { status: 200 });
      }

      await markSucceeded(service, job!.id, hydrated);
      span.setAttribute('outcome', 'succeeded');
      span.setStatus({ code: SpanStatusCode.OK });
      return Response.json({ ok: true, status: 'succeeded' }, { status: 200 });
    } catch (e) {
      const kind = errorKindOf(e);
      await markFailed(service, job!.id, kind).catch(() => {});
      span.recordException(e as Error);
      span.setStatus({ code: SpanStatusCode.ERROR });
      // 200 with a failed body: the failure is recorded on the job; the client poll surfaces the warm
      // fallback. (A 5xx would just make a retrying kicker hammer a job that's now terminal.)
      return Response.json({ ok: true, status: 'failed', error_kind: kind }, { status: 200 });
    } finally {
      span.setAttribute('duration_ms', Date.now() - start);
      span.end();
    }
  });
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
