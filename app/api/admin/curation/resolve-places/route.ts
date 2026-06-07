/* POST /api/admin/curation/resolve-places  { destination? }
 * Resolves Google place ids for staged curation_hotels rows that don't have one (Text Search,
 * lat/long-biased). Server-side only; service client. See specs/12a-curation-tool.md. */
import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/db/server';
import { resolvePlaceIds } from '@/lib/curation/resolve-places';
import { GooglePlacesError } from '@/lib/curation/google-places';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  let destination: string | undefined;
  try {
    const body = await req.json().catch(() => ({}));
    destination = body?.destination;
  } catch {
    /* no body is fine — resolve all unresolved */
  }

  const supabase = createServiceClient();
  try {
    const result = await resolvePlaceIds(supabase, destination);
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof GooglePlacesError && e.kind === 'no_key') {
      return NextResponse.json(
        { error: 'no_api_key', reason: 'GOOGLE_PLACES_API_KEY is not set — cannot resolve place ids.' },
        { status: 400 },
      );
    }
    return NextResponse.json(
      { error: 'resolve_failed', reason: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
