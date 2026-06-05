/* GET /api/admin/pipeline/status[?destination=...]
 * The live feed for the review-intelligence admin UI: the active run + its per-hotel status,
 * run history, and (when ?destination is given) the processed/total count for Mode A.
 * The UI polls this ~every 2s. Internal admin — no auth in v1. Service client. */
import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/db/server';
import { getPipelineStatus, getDestinationCounts } from '@/lib/review-intelligence/admin-status';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const supabase = createServiceClient();
  const { searchParams } = new URL(req.url);
  const destination = searchParams.get('destination');

  try {
    const status = await getPipelineStatus(supabase);
    const counts = destination ? await getDestinationCounts(supabase, destination) : undefined;
    return NextResponse.json({ ...status, counts });
  } catch (e) {
    return NextResponse.json(
      { error: 'status_failed', reason: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
