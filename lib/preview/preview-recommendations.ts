/* Preview recommendations (12i-B) — surface `source='preview'` hotels so they can be BOOKED, without
 * review intelligence and without an LLM.
 *
 * Preview hotels have no `hotel_intelligence` row (by design), so the normal recommendation path
 * (intelligence INNER JOIN → LLM assembly) returns nothing for a preview-only destination. This module
 * is the parallel, LLM-free path: read the preview `hotels` rows directly and map them to the SAME
 * recommendation result shape the agent already forwards (top_pick + other_picks with `_hotel`
 * hydrated), but with NO verdict-from-reviews, NO hard_flags, NO category_summaries — only grounded
 * RouteStack facts (name / star / price tier / hero image). The card shows the honest "Preview" badge.
 *
 * The result is a distinct `preview_recommendations` variant so callers can tell it apart from an
 * intelligence-backed assembly. Server-side only. */
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { HydratedHotel } from '@/lib/chat/map-recommendation';

/** Fixed, honest verdict for the preview top pick — NOT review-derived, never fabricated detail. */
export const PREVIEW_VERDICT = 'Bookable now — full family review intelligence is on the way for this destination.';

/** budget_tier → eligible price_tier set (mirrors the curated query's pre-filter, spec 02). */
const BUDGET_TO_TIERS: Record<string, string[]> = {
  value: ['mid-range'],
  comfort: ['mid-range', 'luxury'],
  luxury: ['luxury', 'ultra-luxury'],
};

/** A preview pick in the agent-result shape (top_pick / other_picks share this; `_hotel` carries the
 * display metadata map-recommendation reads, exactly like the curated path). */
interface PreviewPick {
  hotel_id: string;
  hotel_name: string;
  hard_flags: never[]; // always empty — preview has no reviewed flags
  brand_note: null;
  _hotel: HydratedHotel;
}

export interface PreviewRecommendations {
  result: 'preview_recommendations';
  destination: string;
  top_pick: PreviewPick & { verdict: string; why_top_pick: string };
  other_picks: Array<PreviewPick & { summary: string }>;
}

export interface NoPreviewHotels {
  result: 'no_preview_hotels';
  destination: string;
}

type PreviewHotelRow = {
  id: string;
  name: string;
  destination: string;
  area: string | null;
  price_tier: string | null;
  star_rating: number | null;
  images: string[] | null;
};

function toPick(r: PreviewHotelRow): PreviewPick {
  return {
    hotel_id: r.id,
    hotel_name: r.name,
    hard_flags: [],
    brand_note: null,
    _hotel: {
      destination: r.destination,
      area: r.area,
      price_tier: r.price_tier,
      star_rating: (r.star_rating === 3 || r.star_rating === 4 || r.star_rating === 5 ? r.star_rating : null),
      images: r.images,
      source: 'preview',
    },
  };
}

/** Build preview recommendations for a destination from `source='preview'` hotels. Returns a
 * `no_preview_hotels` marker when there are none (caller then surfaces the normal "no coverage"). */
export async function previewRecommendations(
  supabase: SupabaseClient,
  destination: string,
  opts: { budgetTier?: string | null } = {},
): Promise<PreviewRecommendations | NoPreviewHotels> {
  let q = supabase
    .from('hotels')
    .select('id, name, destination, area, price_tier, star_rating, images')
    .eq('destination', destination)
    .eq('source', 'preview');

  const tiers = opts.budgetTier ? BUDGET_TO_TIERS[opts.budgetTier] : undefined;
  if (tiers && tiers.length) q = q.in('price_tier', tiers);

  const { data, error } = await q;
  if (error) throw new Error(`preview query failed: ${error.message}`);

  // Prefer hotels with an image + higher star rating as the "top" pick — purely a display ordering,
  // not a quality claim (we have no reviews to rank on).
  const rows = ((data ?? []) as PreviewHotelRow[]).slice().sort((a, b) => {
    const img = Number(!!b.images?.length) - Number(!!a.images?.length);
    if (img !== 0) return img;
    return (b.star_rating ?? 0) - (a.star_rating ?? 0);
  });

  if (rows.length === 0) return { result: 'no_preview_hotels', destination };

  const [first, ...rest] = rows;
  return {
    result: 'preview_recommendations',
    destination,
    top_pick: { ...toPick(first), verdict: PREVIEW_VERDICT, why_top_pick: PREVIEW_VERDICT },
    other_picks: rest.map((r) => ({ ...toPick(r), summary: 'A bookable option in this destination — full review intelligence coming soon.' })),
  };
}
