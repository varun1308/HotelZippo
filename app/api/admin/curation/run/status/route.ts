/* GET /api/admin/curation/run/status?runId=<ledger id>
 * Polls Apify for a run's current status, updates the apify_runs ledger row, and returns it. The
 * admin UI polls THIS (cheap) rather than holding a connection open for the whole actor run.
 *
 * A run already in a terminal ledger state (succeeded/failed/ingested) is returned as-is without a
 * fresh Apify call. Internal admin tool — no auth in v1. Service client. */
import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/db/server';
import { getRunStatus } from '@/lib/apify/client';
import { loadRun, markStatus } from '@/lib/apify/run-ledger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const runId = new URL(req.url).searchParams.get('runId');
  if (!runId) return NextResponse.json({ error: 'runId required' }, { status: 400 });

  const supabase = createServiceClient();
  const run = await loadRun(supabase, runId);
  if (!run) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  // Already terminal → no Apify call needed.
  if (run.status === 'succeeded' || run.status === 'failed' || run.status === 'ingested') {
    return NextResponse.json({ run });
  }
  if (!run.apifyRunId) {
    // pending without a run id (start failed before recording) → report as-is.
    return NextResponse.json({ run });
  }

  try {
    const live = await getRunStatus(run.apifyRunId);
    if (live.status !== run.status) {
      await markStatus(supabase, run.id, live.status, {
        itemCount: live.itemCount ?? null,
        costEstimate: live.costEstimate ?? null,
      });
    }
    const updated = await loadRun(supabase, run.id);
    return NextResponse.json({ run: updated });
  } catch (e) {
    // A poll failure is non-fatal: return the last-known ledger state with a soft note.
    return NextResponse.json({ run, pollError: e instanceof Error ? e.message : String(e) });
  }
}
