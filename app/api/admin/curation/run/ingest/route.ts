/* POST /api/admin/curation/run/ingest  { runId }
 * Pulls the dataset of a SUCCEEDED (or already-ingested, for re-pull) ledger run by its dataset id —
 * FREE, since Apify persists the dataset — maps the items, stages them into curation_hotels
 * (preserving approve/reject decisions), and marks the run ingested.
 *
 * This is the "pull a run not yet ingested to reuse" path AND the crash-recovery path: if an earlier
 * ingestion died after Apify finished, the dataset is still there and this replays it at no new cost.
 *
 * Internal admin tool — no auth in v1. Service client. */
import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/db/server';
import { pullDatasetItems } from '@/lib/apify/client';
import { loadRun, markIngested } from '@/lib/apify/run-ledger';
import { mapDatasetItems, stageHotels } from '@/lib/curation/stage';
import { selectTopHotels } from '@/lib/curation/select';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  let body: { runId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  if (!body.runId) return NextResponse.json({ error: 'runId required' }, { status: 400 });

  const supabase = createServiceClient();
  const run = await loadRun(supabase, body.runId);
  if (!run) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (run.purpose !== 'curation_search') {
    return NextResponse.json({ error: 'wrong_purpose', purpose: run.purpose }, { status: 400 });
  }
  if (run.status !== 'succeeded' && run.status !== 'ingested') {
    return NextResponse.json({ error: 'not_succeeded', status: run.status }, { status: 409 });
  }
  if (!run.apifyDatasetId) {
    return NextResponse.json({ error: 'no_dataset' }, { status: 409 });
  }

  // E2E stub seam (specs/15a, J5): stage deterministic fixture candidates instead of pulling a
  // real Apify dataset when the harness sets NEXT_PUBLIC_E2E=1.
  const { e2eEnabled } = await import('@/lib/curation/e2e-stub');
  if (e2eEnabled()) {
    const { e2eIngest } = await import('@/lib/curation/e2e-stub');
    const out = await e2eIngest(supabase, run);
    return NextResponse.json(out, { status: 200 });
  }

  let items: unknown[];
  try {
    // Pull the FULL fetched pool (not just the final 50) so selectTopHotels can rank + backfill.
    const pool = Number(process.env.APIFY_SEARCH_POOL_SIZE ?? 500);
    items = await pullDatasetItems(run.apifyDatasetId, { limit: pool });
  } catch (e) {
    return NextResponse.json(
      { error: 'pull_failed', reason: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }

  // Map the whole pool → select the top N (default 50): prefer 4&5-star by Traveller Ranking,
  // backfill with the next-best-ranked if fewer than N. The 100+ review rule stays a publish gate.
  const pool = mapDatasetItems(items, run.scopeValue);
  const topN = Number(process.env.APIFY_SEARCH_MAX_RESULTS ?? 50);
  const hotels = selectTopHotels(pool, { topN });
  const { staged } = await stageHotels(supabase, hotels, 'apify');
  await markIngested(supabase, run.id, { itemCount: items.length });

  return NextResponse.json({ ingested: staged, items: items.length, pool: pool.length });
}
