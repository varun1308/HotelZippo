/* Map an assembly result (08b-2) + hydrated hotel metadata → the 3a RecommendationSet
 * props (spec 03b card-field mapping). PURE transform — no DB, no network. The hotel
 * display metadata must already be attached to each pick under `_hotel` (the agent tool
 * hydrates it server-side from `hotels` by hotel_id, since the client cannot query).
 *
 * Returns null for error variants ({error: ...}) — those render conversationally, no cards. */
import type {
  RecommendationSetProps,
  StandardCardProps,
  TopPickCardProps,
  CardFlag,
} from '@/components/recommendation/types';
import { PRICE_TIER_LABELS } from '@/components/recommendation/types';

/** The hotel display fields the route hydrates onto each pick before streaming. */
export interface HydratedHotel {
  destination: string;
  area: string | null;
  price_tier: string | null;
  star_rating: 3 | 4 | 5 | null;
  images: string[] | null;
  /** Provenance tier (12i). 'preview' = Claude-proposed + RouteStack-verified, NOT review-intelligence
   * -backed → the card shows an honest "Preview" badge. Absent/'curated' → no badge. */
  source?: 'curated' | 'preview' | null;
}

interface PickLike {
  hotel_id: string;
  hotel_name: string;
  hard_flags?: CardFlag[];
  brand_note?: string | null;
  _hotel?: HydratedHotel | null;
}

function hotelDisplay(id: string, name: string, h?: HydratedHotel | null) {
  return {
    hotelId: id,
    hotelName: name,
    destination: h?.destination ?? '',
    area: h?.area ?? null,
    priceTierLabel: h?.price_tier ? PRICE_TIER_LABELS[h.price_tier] ?? h.price_tier : null,
    starRating: h?.star_rating ?? null,
    heroImageUrl: h?.images?.[0] ?? null,
    isPreview: h?.source === 'preview',
  };
}

/** True if the value is an assembly error variant. */
function isError(v: unknown): v is { error: string } {
  return typeof v === 'object' && v !== null && 'error' in v;
}

/* Handles BOTH the curated assembly success shape AND the 12i-B `preview_recommendations` variant —
 * both expose `top_pick` (+ `_hotel`) and `other_picks`. A preview top pick has a fixed honest
 * `verdict` and NO `category_summaries`, so the card skips the category grid and shows the Preview
 * badge (via `_hotel.source`). Error variants ({error:…}) → null (render conversationally). */
export function toRecommendationSetProps(assembly: unknown): RecommendationSetProps | null {
  if (!assembly || typeof assembly !== 'object' || isError(assembly)) return null;
  const a = assembly as {
    top_pick?: PickLike & {
      verdict: string;
      category_summaries?: TopPickCardProps['categorySummaries'];
      why_top_pick?: string;
    };
    other_picks?: Array<PickLike & { summary: string }>;
  };
  if (!a.top_pick) return null;

  const tp = a.top_pick;
  const topPick: TopPickCardProps = {
    ...hotelDisplay(tp.hotel_id, tp.hotel_name, tp._hotel),
    hardFlags: tp.hard_flags ?? [],
    brandNote: tp.brand_note ?? null,
    verdict: tp.verdict,
    categorySummaries: tp.category_summaries,
    whyTopPick: tp.why_top_pick,
  };

  const otherPicks: StandardCardProps[] = (a.other_picks ?? []).map((op) => ({
    ...hotelDisplay(op.hotel_id, op.hotel_name, op._hotel),
    hardFlags: op.hard_flags ?? [],
    brandNote: op.brand_note ?? null,
    summary: op.summary,
    // verdict/categorySummaries intentionally omitted — other_picks carry only `summary`
    // (08b-2). The StandardCard degrades to summary-only (no "See full details"). 3a-fix.
  }));

  return { topPick, otherPicks };
}
