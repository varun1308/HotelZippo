/* POST /api/admin/pipeline/retry  { run_id, hotel_id }
 * Re-processes a SINGLE failed hotel within its run (08a-6 TC-P21: "retrying a failed hotel
 * re-processes only that hotel"). A single hotel's scrape is bounded (not a full destination),
 * so this runs inline. It reuses the hotel's pipeline_run_hotels row (UNIQUE run_id+hotel_id),
 * so the status transitions in place rather than creating a duplicate.
 * Internal admin — no auth in v1. Service client; nodejs runtime (worker chain). */
import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/db/server';
import { processHotel } from '@/lib/review-intelligence/worker';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  let body: { run_id?: string; hotel_id?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }
  const { run_id, hotel_id } = body;
  if (!run_id || !hotel_id) {
    return NextResponse.json({ error: 'run_id and hotel_id required' }, { status: 400 });
  }

  const supabase = createServiceClient();
  const { data: hotel, error } = await supabase
    .from('hotels')
    .select('id, name, destination, tripadvisor_url, google_place_id')
    .eq('id', hotel_id)
    .single();
  if (error || !hotel) {
    return NextResponse.json({ error: 'hotel_not_found' }, { status: 404 });
  }

  try {
    // NOTE: a single hotel's scrape+synthesis runs INLINE here. On a serverless host that could
    // exceed the function timeout, but this admin surface is laptop-hosted by design — accepted.
    const outcome = await processHotel(supabase, run_id, hotel, {});

    // TC-P21/22: keep the run's history counters honest after the retry flips this hotel's
    // status. RECOUNT from pipeline_run_hotels (rather than incrementing) so repeated retries
    // and mixed outcomes stay correct.
    const { data: rows } = await supabase
      .from('pipeline_run_hotels')
      .select('status')
      .eq('run_id', run_id);
    if (rows) {
      const hotels_complete = rows.filter((r) => r.status === 'complete').length;
      const hotels_failed = rows.filter((r) => r.status === 'failed').length;
      await supabase.from('pipeline_runs').update({ hotels_complete, hotels_failed }).eq('id', run_id);
    }

    return NextResponse.json({ hotel_id, outcome });
  } catch (e) {
    return NextResponse.json(
      { error: 'retry_failed', reason: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
