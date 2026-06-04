/* POST /api/admin/publish-hotels  { destination? }
 * Publishes approved curation_hotels rows into public.hotels (upsert), storing hero
 * images en route. Server-side only; service client. See specs/12a-curation-tool.md + 12g. */
import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/db/server';
import { publishApproved } from '@/lib/curation/publish';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  let destination: string | undefined;
  try {
    const body = await req.json().catch(() => ({}));
    destination = body?.destination;
  } catch {
    /* no body is fine — publish all */
  }

  const supabase = createServiceClient();
  try {
    const result = await publishApproved(supabase, destination);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: 'publish_failed', reason: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
