/* POST /api/admin/pipeline/run  { scope_type: 'destination'|'hotel', scope_value }
 * Enqueues a review-intelligence run by inserting a pipeline_runs row (status='running').
 * The DB-level one_active_run partial unique index guarantees a single active run — a second
 * concurrent run is rejected here with a clear 409 (not just client-side). The locally-run
 * worker (npm run pipeline:worker) then picks the row up and processes it.
 * Internal admin tool — no auth in v1 (consistent with /admin/curation). Service client. */
import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/db/server';

export const runtime = 'nodejs';

const DESTINATIONS = ['Phuket', 'Hong Kong', 'Singapore', 'Maldives', 'Bali'];

export async function POST(req: Request) {
  let body: { scope_type?: string; scope_value?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }
  const { scope_type, scope_value } = body;
  if (scope_type !== 'destination' && scope_type !== 'hotel') {
    return NextResponse.json({ error: 'scope_type must be destination|hotel' }, { status: 400 });
  }
  if (!scope_value) {
    return NextResponse.json({ error: 'scope_value required' }, { status: 400 });
  }
  if (scope_type === 'destination' && !DESTINATIONS.includes(scope_value)) {
    return NextResponse.json({ error: 'unknown destination' }, { status: 400 });
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from('pipeline_runs')
    .insert({ scope_type, scope_value, status: 'running' })
    .select('id')
    .single();

  if (error) {
    // The one_active_run partial unique index → a second running run violates it.
    if (/one_active_run|duplicate|unique/i.test(error.message)) {
      return NextResponse.json(
        { error: 'run_already_active', message: 'A pipeline run is already in progress. Wait for it to finish.' },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: 'run_failed', reason: error.message }, { status: 500 });
  }

  return NextResponse.json({ run_id: data!.id, status: 'running' }, { status: 201 });
}
