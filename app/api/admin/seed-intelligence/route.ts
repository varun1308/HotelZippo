/* POST /api/admin/seed-intelligence
 * Reads hand-authored demo intelligence files (scripts/seed/demo_intelligence/),
 * validates them, resolves hotel_id by (hotel_name, destination), and upserts into
 * public.hotel_intelligence (idempotent, low_confidence=false). Server-side only;
 * service client. Fail-loud: a missing hotel / bad JSON / schema error aborts the run
 * with a 4xx and per-file diagnostics. See specs/12d-seed-script.md. */
import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/db/server';
import { seedIntelligence, SeedError } from '@/lib/seed/seed-intelligence';

export const runtime = 'nodejs';

export async function POST() {
  const supabase = createServiceClient();
  try {
    const result = await seedIntelligence(supabase);
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof SeedError) {
      // 409 for "publish hotels first" (a precondition), 422 for malformed content.
      const status = e.code === 'hotels_not_published' ? 409 : e.code === 'no_files' ? 404 : 422;
      return NextResponse.json(
        { error: e.code, message: e.message, details: e.details },
        { status },
      );
    }
    return NextResponse.json(
      { error: 'seed_failed', message: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
