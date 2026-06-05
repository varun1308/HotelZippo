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
    const outcome = await processHotel(supabase, run_id, hotel, {});
    return NextResponse.json({ hotel_id, outcome });
  } catch (e) {
    return NextResponse.json(
      { error: 'retry_failed', reason: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
