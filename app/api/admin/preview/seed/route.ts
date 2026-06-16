/* POST /api/admin/preview/seed  { destination, count? }
 * Preview seeding (12i): Claude proposes hotel NAMES → RouteStack VERIFIES them → survivors are
 * upserted into `hotels` as source='preview' (no Apify, no fabricated review intelligence).
 *
 * Operator-gated: returns 403 unless PREVIEW_SEEDING_ENABLED=1 (the feature is phased — internal
 * RouteStack testing first, flipped on for user-facing preview once proven). Internal admin tool,
 * no auth in v1 (consistent with the rest of /admin). Server-side; service client + real provider
 * deps wired here. Reports proposed → verified → kept so the operator sees the name-match drop-off. */
import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/db/server';
import { DESTINATIONS } from '@/lib/db/schemas';
import { proposeHotels } from '@/lib/preview/propose';
import { verifyAndStage } from '@/lib/preview/verify';
import { createRouteStackFetch } from '@/lib/booking/transport';
import { makeSupabaseIdCache } from '@/lib/booking/id-cache';
import { resolveCityLocation } from '@/lib/curation/google-places';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  if (process.env.PREVIEW_SEEDING_ENABLED !== '1') {
    return NextResponse.json({ error: 'preview_seeding_disabled' }, { status: 403 });
  }

  let body: { destination?: string; count?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  const { destination, count } = body;
  if (!DESTINATIONS.includes(destination as (typeof DESTINATIONS)[number])) {
    return NextResponse.json({ error: 'invalid_destination' }, { status: 400 });
  }

  try {
    // 1. Claude proposes candidate names (default model; tight prompt).
    const proposals = await proposeHotels(destination!, { count });
    if (proposals.length === 0) {
      return NextResponse.json({ proposed: 0, verified: 0, staged: 0, dropped: [] });
    }

    // 2. RouteStack verifies + stages survivors. Real deps: transport + id-cache + warm-failing geocode.
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
    const result = await verifyAndStage(supabase, destination!, proposals, {
      fetchImpl: createRouteStackFetch(),
      cache,
      geocode,
    });

    return NextResponse.json({
      proposed: result.proposed,
      verified: result.verified.map((v) => ({ name: v.name, starRating: v.starRating, priceTier: v.priceTier })),
      staged: result.staged,
      dropped: result.dropped,
    });
  } catch (e) {
    return NextResponse.json({ error: 'seed_failed', reason: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
