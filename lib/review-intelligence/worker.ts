/* Pipeline worker (Phase 6 · specs/02 Orchestration / 08a-6). Processes ONE pipeline_runs
 * row: resolves its hotels, then runs each SEQUENTIALLY through the full producer chain —
 *   scrape → tag → store(raw_reviews) → load → format → synthesise → upsert hotel_intelligence
 * — writing per-hotel status to pipeline_run_hotels and run totals to pipeline_runs.
 *
 * Runs as a SEPARATE Node/TS process (scripts/pipeline/run-worker.ts), NOT inside a Vercel
 * route — a full destination scrape exceeds serverless timeouts. The admin UI triggers a run
 * by inserting a pipeline_runs row (status='running'); this worker picks it up and drives it.
 * The DB-level one_active_run partial unique index guarantees at most one active run.
 *
 * Failure model (reconciled with 14): a hotel that fails (scrape error / zero reviews /
 * malformed synthesis) is marked `failed` with a reason and the run CONTINUES — no mid-run
 * stall, no cancel. The founder retries individual hotels from the admin UI. */
// NOTE: no `import 'server-only'` here. This module is server-side by construction
// (service-role DB + Anthropic key), but it is ALSO imported by the standalone Node worker
// (scripts/pipeline/run-worker.ts via tsx), where the `server-only` guard would throw. It
// is never imported by a client component (the admin UI reaches it through API routes).
import type { SupabaseClient } from '@supabase/supabase-js';
import { scrapeHotelReviews, type ScrapeDeps, type ScrapeTarget } from './apify';
import { tagReviews } from './tagging';
import { storeRawReviews, storeRawPayloads, loadHotelReviews } from './store';
import { prepareForSynthesis, buildSynthesisInput } from './format';
import { synthesise, type SynthesiseDeps, type SynthesisOutput } from './synthesis';

/** Per-hotel status enum (mirrors the pipeline_run_hotels.status comment). */
export type HotelStatus = 'pending' | 'scraping' | 'processing' | 'synthesising' | 'complete' | 'failed';

export interface WorkerDeps {
  /** Injectable scrape (tests pass mock/fake sources). */
  scrape?: ScrapeDeps;
  /** Injectable synthesis (tests pass a fixture model). */
  synth?: SynthesiseDeps;
  /** Inter-hotel delay (ms); default 2000, set 0 in tests. */
  interHotelDelayMs?: number;
  /** Clock injection for deterministic 12-month filtering; default real now. */
  now?: () => Date;
  /** Tag Indian reviews (O1). Default true. */
  indianTagging?: boolean;
}

interface HotelRow {
  id: string;
  name: string;
  destination: string;
  tripadvisor_url: string | null;
  google_place_id: string | null;
}

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Map a synthesis output → a hotel_intelligence row payload (drops `confidence`, which the
 * gate already consumed; adds DB-managed last_refreshed + low_confidence). */
export function toIntelligenceRow(
  hotelId: string,
  output: SynthesisOutput,
  lowConfidence: boolean,
  now: Date,
): Record<string, unknown> {
  const { confidence: _confidence, ...intel } = output;
  return {
    hotel_id: hotelId,
    ...intel,
    last_refreshed: now.toISOString(),
    low_confidence: lowConfidence,
  };
}

/** Process ONE hotel end-to-end. Updates its pipeline_run_hotels row through the status
 * transitions and returns 'complete' | 'failed'. Never throws — a failure is recorded and
 * the caller continues to the next hotel. */
export async function processHotel(
  client: SupabaseClient,
  runId: string,
  hotel: HotelRow,
  deps: WorkerDeps = {},
): Promise<'complete' | 'failed'> {
  const now = (deps.now ?? (() => new Date()))();

  // Upsert the per-hotel row (a retry reuses it) and set status as we go.
  async function setStatus(status: HotelStatus, patch: Record<string, unknown> = {}) {
    await client
      .from('pipeline_run_hotels')
      .upsert(
        { run_id: runId, hotel_id: hotel.id, status, ...patch },
        { onConflict: 'run_id,hotel_id' },
      );
  }

  const target: ScrapeTarget = {
    hotelId: hotel.id,
    hotelName: hotel.name,
    tripadvisorUrl: hotel.tripadvisor_url,
    googlePlaceId: hotel.google_place_id,
  };

  try {
    await setStatus('scraping', { started_at: now.toISOString(), error_reason: null });
    const scraped = await scrapeHotelReviews(target, deps.scrape);

    // TC-P1: zero reviews → skip synthesis, mark failed, continue.
    if (scraped.reviews.length === 0) {
      await setStatus('failed', {
        reviews_scraped: 0,
        error_reason: 'zero reviews returned',
        finished_at: new Date().toISOString(),
      });
      return 'failed';
    }

    await setStatus('processing', { reviews_scraped: scraped.reviews.length });

    // Best-effort: bank the untouched actor payloads so the mapper can be re-run later WITHOUT a
    // paid re-scrape (npm run pipeline:remap). A payload-store failure must NOT fail an otherwise
    // healthy hotel — payloads are a re-map convenience; raw_reviews + synthesis are the product.
    try {
      await storeRawPayloads(client, hotel.id, runId, scraped.payloads);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn(
        `[pipeline] raw_review_payloads store failed for ${hotel.id}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }

    const tagged = tagReviews(scraped.reviews, { indian: deps.indianTagging });
    await storeRawReviews(client, hotel.id, runId, tagged);

    // Synthesise from ALL stored reviews (permanent accumulation), filtered to 12mo + capped.
    const allReviews = await loadHotelReviews(client, hotel.id);
    const segments = prepareForSynthesis(allReviews, now);
    const reviewCountFamily = allReviews.filter((r) => r.is_family).length;
    const reviewCountIndian = allReviews.filter((r) => r.is_indian).length;
    const input = buildSynthesisInput({
      hotelName: hotel.name,
      destination: hotel.destination,
      reviewCountTotal: allReviews.length,
      reviewCountFamily,
      reviewCountIndian,
      segments,
    });

    await setStatus('synthesising');
    const { output, gate } = await synthesise(input, deps.synth);

    // Upsert hotel_intelligence (replaces prior on hotel_id), apply the confidence gate.
    const { error } = await client
      .from('hotel_intelligence')
      .upsert(toIntelligenceRow(hotel.id, output, gate.lowConfidence, new Date()), { onConflict: 'hotel_id' });
    if (error) throw new Error(`hotel_intelligence upsert failed: ${error.message}`);

    await setStatus('complete', { finished_at: new Date().toISOString(), error_reason: null });
    return 'complete';
  } catch (e) {
    // Any failure (scrape/store/synthesis/upsert) → mark failed, continue the run (TC-P2/P14).
    await setStatus('failed', {
      error_reason: e instanceof Error ? e.message : String(e),
      finished_at: new Date().toISOString(),
    });
    return 'failed';
  }
}

/** Resolve the hotels in a run's scope. */
async function resolveHotels(client: SupabaseClient, run: { scope_type: string; scope_value: string }): Promise<HotelRow[]> {
  const cols = 'id, name, destination, tripadvisor_url, google_place_id';
  if (run.scope_type === 'hotel') {
    const { data } = await client.from('hotels').select(cols).eq('id', run.scope_value);
    return (data ?? []) as HotelRow[];
  }
  // destination scope
  const { data } = await client
    .from('hotels')
    .select(cols)
    .eq('destination', run.scope_value)
    .order('name', { ascending: true });
  return (data ?? []) as HotelRow[];
}

/** Process an entire run: hotels strictly sequential, per-hotel status + run totals updated,
 * the run finalised complete/failed. Returns the run summary. */
export async function processRun(
  client: SupabaseClient,
  runId: string,
  deps: WorkerDeps = {},
): Promise<{ total: number; complete: number; failed: number }> {
  const { data: run, error } = await client.from('pipeline_runs').select('*').eq('id', runId).single();
  if (error || !run) throw new Error(`run not found: ${runId}`);

  const hotels = await resolveHotels(client, run);
  await client.from('pipeline_runs').update({ hotels_total: hotels.length }).eq('id', runId);

  let complete = 0;
  let failed = 0;
  const interDelay = deps.interHotelDelayMs ?? 2000;

  for (let i = 0; i < hotels.length; i++) {
    const outcome = await processHotel(client, runId, hotels[i], deps);
    if (outcome === 'complete') complete += 1;
    else failed += 1;
    await client
      .from('pipeline_runs')
      .update({ hotels_complete: complete, hotels_failed: failed })
      .eq('id', runId);
    if (i < hotels.length - 1 && interDelay > 0) await delay(interDelay);
  }

  // The run completes naturally; status is 'complete' even if some hotels failed (failures
  // are visible per-hotel + retriable). A run is only 'failed' if it couldn't run at all.
  await client
    .from('pipeline_runs')
    .update({ status: 'complete', finished_at: new Date().toISOString() })
    .eq('id', runId);

  return { total: hotels.length, complete, failed };
}

/** Claim and process the single active run, if any. Returns null when none is running.
 * The locally-run worker (scripts/pipeline/run-worker.ts) calls this on a poll loop. */
export async function processActiveRun(
  client: SupabaseClient,
  deps: WorkerDeps = {},
): Promise<{ runId: string; total: number; complete: number; failed: number } | null> {
  const { data: run } = await client
    .from('pipeline_runs')
    .select('id')
    .eq('status', 'running')
    .order('started_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!run) return null;
  const summary = await processRun(client, run.id, deps);
  return { runId: run.id, ...summary };
}
