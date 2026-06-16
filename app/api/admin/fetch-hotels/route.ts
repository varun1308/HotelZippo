/* POST /api/admin/fetch-hotels  { destination }
 * Fetches candidates for a destination (apify→playwright→mock) and stages them in
 * curation_hotels (upsert on name+destination so re-fetch preserves prior decisions).
 * Server-side only; service client. See specs/12a-curation-tool.md. */
import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/db/server';
import { fetchHotels } from '@/lib/curation/fetch';
import { stageHotels } from '@/lib/curation/stage';
import { DESTINATIONS } from '@/lib/db/schemas';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  let destination: string;
  try {
    ({ destination } = await req.json());
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  if (!DESTINATIONS.includes(destination as (typeof DESTINATIONS)[number])) {
    return NextResponse.json({ error: 'invalid_destination' }, { status: 400 });
  }

  let result;
  try {
    result = await fetchHotels(destination);
  } catch (e) {
    return NextResponse.json(
      { error: 'fetch_failed', reason: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }

  const supabase = createServiceClient();
  const { staged } = await stageHotels(supabase, result.hotels, result.source);

  return NextResponse.json({ source: result.source, staged });
}
