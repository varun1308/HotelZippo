/* Admin status reads for the review-intelligence pipeline UI (Phase 6 · specs/02 Stage 1).
 * Pure DB reads — used by /api/admin/pipeline/status. Kept in lib/ so it's unit/integration
 * testable independent of the route. Service client (pipeline tables are service-role only). */
import type { SupabaseClient } from '@supabase/supabase-js';

export interface RunHotelStatus {
  hotel_id: string;
  status: string;
  error_reason: string | null;
  reviews_scraped: number | null;
}

export interface PipelineStatus {
  /** The active (running) run, if any. */
  active: { id: string; scope_type: string; scope_value: string; hotels_total: number | null; hotels_complete: number; hotels_failed: number } | null;
  /** Per-hotel feed for the active run (empty if no active run). */
  hotels: RunHotelStatus[];
  /** Recent run history (most recent first), incl. the active one. */
  history: Array<{ id: string; scope_type: string; scope_value: string; status: string; hotels_total: number | null; hotels_complete: number; hotels_failed: number; started_at: string; finished_at: string | null }>;
}

/** Snapshot the pipeline state for the live admin feed + run history. */
export async function getPipelineStatus(client: SupabaseClient, historyLimit = 20): Promise<PipelineStatus> {
  const { data: active } = await client
    .from('pipeline_runs')
    .select('id, scope_type, scope_value, hotels_total, hotels_complete, hotels_failed')
    .eq('status', 'running')
    .order('started_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  let hotels: RunHotelStatus[] = [];
  if (active) {
    const { data } = await client
      .from('pipeline_run_hotels')
      .select('hotel_id, status, error_reason, reviews_scraped')
      .eq('run_id', active.id);
    hotels = (data ?? []) as RunHotelStatus[];
  }

  const { data: history } = await client
    .from('pipeline_runs')
    .select('id, scope_type, scope_value, status, hotels_total, hotels_complete, hotels_failed, started_at, finished_at')
    .order('started_at', { ascending: false })
    .limit(historyLimit);

  return {
    active: active ?? null,
    hotels,
    history: (history ?? []) as PipelineStatus['history'],
  };
}

/** Count processed vs unprocessed hotels in a destination (Mode A "processed/total" badge).
 * Processed = has a hotel_intelligence row. */
export async function getDestinationCounts(
  client: SupabaseClient,
  destination: string,
): Promise<{ total: number; processed: number }> {
  const { data: hotels } = await client.from('hotels').select('id').eq('destination', destination);
  const ids = (hotels ?? []).map((h) => h.id as string);
  if (ids.length === 0) return { total: 0, processed: 0 };
  const { data: intel } = await client.from('hotel_intelligence').select('hotel_id').in('hotel_id', ids);
  return { total: ids.length, processed: (intel ?? []).length };
}
