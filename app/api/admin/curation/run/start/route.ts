/* POST /api/admin/curation/run/start  { destination, force? }
 * Starts an Apify curation-search run ASYNCHRONOUSLY and records it in the apify_runs ledger
 * (12h). Returns in <1s (the actor keeps running on Apify) → serverless-safe, no ~5-min block.
 *
 * Reuse guard (WARN, never auto-skip): unless `force` is true, if a succeeded/ingested run for the
 * same destination+input exists within the freshness window, we DON'T start a new (paid) run — we
 * return { reusable: <run> } so the UI can offer "re-ingest free or force a fresh run". With
 * force:true we always start.
 *
 * Internal admin tool — no auth in v1 (consistent with the rest of /admin). Service client. */
import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/db/server';
import { startRun, ApifyError } from '@/lib/apify/client';
import { createRun, markRunning, markStatus, findReusable } from '@/lib/apify/run-ledger';
import { buildSearchInput } from '@/lib/curation/apify-mapper';
import { DESTINATIONS } from '@/lib/db/schemas';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  let body: { destination?: string; force?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  const { destination, force } = body;
  if (!DESTINATIONS.includes(destination as (typeof DESTINATIONS)[number])) {
    return NextResponse.json({ error: 'invalid_destination' }, { status: 400 });
  }

  // In E2E stub mode there is no real actor id (and none is needed — the run is stubbed);
  // a placeholder is recorded in the ledger for shape parity.
  const { e2eEnabled } = await import('@/lib/curation/e2e-stub');
  const actorId = process.env.APIFY_TRIPADVISOR_SEARCH_ACTOR_ID ?? (e2eEnabled() ? 'e2e~stub-actor' : undefined);
  if (!actorId) {
    return NextResponse.json({ error: 'apify_not_configured' }, { status: 400 });
  }

  // Fetch a LARGE pool from the actor (~500) so ingest's selectTopHotels can rank + backfill to the
  // final top-N (APIFY_SEARCH_MAX_RESULTS, default 50). Pool ≫ N is the whole point of the new rule.
  const pool = Number(process.env.APIFY_SEARCH_POOL_SIZE ?? 500);
  const input = buildSearchInput(destination!, pool);
  const supabase = createServiceClient();

  // Reuse guard — warn, never auto-reuse.
  if (!force) {
    const reusable = await findReusable(supabase, {
      purpose: 'curation_search',
      scopeValue: destination!,
      input,
    });
    if (reusable) {
      return NextResponse.json({ reusable }, { status: 200 });
    }
  }

  // Create the ledger row first (pending), then start the run and record its ids.
  const run = await createRun(supabase, {
    actorId,
    purpose: 'curation_search',
    scopeType: 'destination',
    scopeValue: destination!,
    input,
  });

  // E2E stub seam (specs/15a, J5): after the real ledger write + reuse guard, swap the live Apify
  // provider for a deterministic stub when the harness sets NEXT_PUBLIC_E2E=1 (no spend, no network).
  if (e2eEnabled()) {
    const { e2eMarkStarted } = await import('@/lib/curation/e2e-stub');
    const stubbed = await e2eMarkStarted(supabase, run);
    return NextResponse.json({ run: stubbed }, { status: 200 });
  }

  try {
    const { apifyRunId, apifyDatasetId } = await startRun({ actorId, input });
    await markRunning(supabase, run.id, { apifyRunId, apifyDatasetId });
    return NextResponse.json({ run: { ...run, apifyRunId, apifyDatasetId, status: 'running' } }, { status: 200 });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await markStatus(supabase, run.id, 'failed', { error: message }).catch(() => {});
    const status = e instanceof ApifyError && e.status ? 502 : 502;
    return NextResponse.json({ error: 'start_failed', reason: message, runId: run.id }, { status });
  }
}
