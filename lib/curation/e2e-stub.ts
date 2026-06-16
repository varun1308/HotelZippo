/* E2E-ONLY deterministic Apify-ledger stub for the curation run routes (specs/15a, J5).
 *
 * When NEXT_PUBLIC_E2E === '1' (Playwright harness only), the curation run routes delegate here
 * instead of calling live Apify. This makes the admin-curation journey deterministic + key-free
 * (no Apify spend, no network) and never starts a real actor run. It still writes to the REAL
 * apify_runs ledger + curation_hotels via the service client, so the CLIENT page flow under test is
 * 100% production code — only the Apify provider (startRun/getRunStatus/pullDatasetItems) is swapped.
 *
 * Determinism: a started run goes straight to `succeeded` (one poll), and ingest stages a small set
 * of fixture candidates. This exercises Start → poll → Ingest → candidates render end-to-end.
 *
 * NOT a client module — imported only by the server routes. No 'use client'. */
import type { SupabaseClient } from '@supabase/supabase-js';
import { markStatus, markIngested, type ApifyRun } from '@/lib/apify/run-ledger';
import { stageHotels } from '@/lib/curation/stage';
import type { FetchedHotel } from '@/lib/curation/types';

/** True when the harness has enabled E2E stub mode. Read at call time (not import). */
export function e2eEnabled(): boolean {
  return process.env.NEXT_PUBLIC_E2E === '1';
}

const STUB_ITEM_COUNT = 3;

/** A started run immediately "succeeds" with a fake Apify run/dataset id and a known item count. */
export async function e2eMarkStarted(client: SupabaseClient, run: ApifyRun): Promise<ApifyRun> {
  // Skip the live startRun; pretend Apify accepted + finished the run.
  await client
    .from('apify_runs')
    .update({ apify_run_id: `e2e-run-${run.id}`, apify_dataset_id: `e2e-ds-${run.id}`, status: 'running' })
    .eq('id', run.id);
  await markStatus(client, run.id, 'succeeded', { itemCount: STUB_ITEM_COUNT, costEstimate: 0 });
  return { ...run, apifyRunId: `e2e-run-${run.id}`, apifyDatasetId: `e2e-ds-${run.id}`, status: 'succeeded' };
}

/** Deterministic fixture candidates for a destination (3 hotels), shaped as FetchedHotel. */
function stubHotels(destination: string): FetchedHotel[] {
  return [1, 2, 3].map((n) => ({
    name: `E2E ${destination} Hotel ${n}`,
    destination: destination as FetchedHotel['destination'],
    tripadvisor_rank: n,
    review_count: 500 + n,
    star_rating: 5,
    brand: null,
    price_tier: 'luxury',
    images: ['https://picsum.photos/seed/e2e/640/360'],
    google_place_id: null,
    latitude: null,
    longitude: null,
    address: null,
  }));
}

/** Ingest stub: stage the fixture candidates + mark the run ingested. No dataset pull. */
export async function e2eIngest(
  client: SupabaseClient,
  run: ApifyRun,
): Promise<{ ingested: number; items: number }> {
  const { staged } = await stageHotels(client, stubHotels(run.scopeValue), 'apify');
  await markIngested(client, run.id, { itemCount: STUB_ITEM_COUNT });
  return { ingested: staged, items: STUB_ITEM_COUNT };
}
