/* POST /api/admin/preview/seed  { destination, limit? }
 * Preview seeding (12i — RouteStack-FIRST, no-Claude flow): take the REAL bookable hotels RouteStack
 * returns for a destination and stage them as source='preview', with RouteStack's own grounded hero
 * images. No LLM (an LLM proposes famous resorts that may not be in RouteStack inventory → 0 verified;
 * and it hallucinates image URLs). Everything staged is real + bookable by construction. No Apify, no
 * fabricated review intelligence.
 *
 * Operator-gated: returns 403 unless PREVIEW_SEEDING_ENABLED=1 (phased rollout). Internal admin tool,
 * no auth in v1 (consistent with the rest of /admin). Server-side; service client + real RouteStack
 * deps wired here. Reports found → staged. */
import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/db/server';
import { DESTINATIONS } from '@/lib/db/schemas';
import { seedPreviewFromRouteStack } from '@/lib/preview/verify';
import { createRouteStackFetch } from '@/lib/booking/transport';
import { makeSupabaseIdCache } from '@/lib/booking/id-cache';
import { resolveCityLocation } from '@/lib/curation/google-places';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  if (process.env.PREVIEW_SEEDING_ENABLED !== '1') {
    return NextResponse.json({ error: 'preview_seeding_disabled' }, { status: 403 });
  }

  let body: { destination?: string; limit?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  const { destination, limit } = body;
  if (!DESTINATIONS.includes(destination as (typeof DESTINATIONS)[number])) {
    return NextResponse.json({ error: 'invalid_destination' }, { status: 400 });
  }

  try {
    // RouteStack-first: take the real bookable inventory + grounded hero images, stage as preview.
    const supabase = createServiceClient();
    let cache;
    try {
      cache = makeSupabaseIdCache(supabase);
    } catch {
      cache = undefined;
    }
    const geocode = async (q: string) => {
      try {
        return await resolveCityLocation(q);
      } catch {
        return null;
      }
    };
    const result = await seedPreviewFromRouteStack(
      supabase,
      destination!,
      { fetchImpl: createRouteStackFetch(), cache, geocode },
      { limit },
    );

    return NextResponse.json({ found: result.found, staged: result.staged, hotels: result.hotels });
  } catch (e) {
    return NextResponse.json({ error: 'seed_failed', reason: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
