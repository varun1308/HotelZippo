/* GET /api/admin/curation/runs?destination=<dest>
 * Lists apify_runs for a destination's curation searches, newest first (run history + the
 * "succeeded but not yet ingested → reuse free" list the UI surfaces). Internal admin tool —
 * no auth in v1. Service client. */
import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/db/server';
import { listRuns } from '@/lib/apify/run-ledger';
import { DESTINATIONS } from '@/lib/db/schemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const destination = new URL(req.url).searchParams.get('destination');
  if (!destination || !DESTINATIONS.includes(destination as (typeof DESTINATIONS)[number])) {
    return NextResponse.json({ error: 'invalid_destination' }, { status: 400 });
  }

  const supabase = createServiceClient();
  const runs = await listRuns(supabase, {
    purpose: 'curation_search',
    scopeValue: destination,
    limit: 25,
  });
  return NextResponse.json({ runs });
}
