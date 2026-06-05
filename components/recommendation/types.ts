/* Display-ready prop types for the Phase 3a recommendation cards.
 *
 * These components are PURE presentational — they accept a flat, display-ready
 * object (no DB rows, no assembly union). A mapper in 3b/3c composes the assembly
 * output (`@/lib/contracts/recommendation-assembly`) with hydrated `hotels`
 * metadata (`@/lib/db/schemas`) into these shapes. We import the source types here
 * only to keep the mapping honest (field names + the HardFlag shape stay in sync),
 * never to couple the components to data fetching. */
import type { z } from 'zod';
import type { hardFlagSchema } from '@/lib/db/schemas';
import type {
  topPickSchema,
  otherPickSchema,
} from '@/lib/contracts/recommendation-assembly';

/* Derive the source shapes from the exported Zod schemas (the contract files do
 * not export named row types, so we infer them here without modifying server code). */
type HardFlag = z.infer<typeof hardFlagSchema>;
type TopPick = z.infer<typeof topPickSchema>;
type OtherPick = z.infer<typeof otherPickSchema>;

/** A single hard flag, exactly as it arrives from the assembly contract. */
export type CardFlag = HardFlag;

/** The four review categories rendered in the 2x2 grid. */
export type CategoryKey = 'rooms' | 'facilities' | 'food' | 'location';

export type CategorySummaries = Record<CategoryKey, string>;

/** Hotel display metadata, hydrated from `hotels` by `hotel_id` (spec 03b mapping).
 *  All optional-presentation fields are nullable so the card can degrade gracefully:
 *  null area → destination only, null star_rating → no stars, null hero → placeholder. */
export interface HotelDisplay {
  hotelName: string;
  destination: string;
  /** null → render destination only */
  area: string | null;
  /** Display-ready price-tier label, e.g. "Luxury" (see PRICE_TIER_LABELS). null → hide */
  priceTierLabel: string | null;
  /** 3 | 4 | 5 — null → hide stars entirely */
  starRating: 3 | 4 | 5 | null;
  /** hotels.images[0]; null/empty → elegant .photo-slot placeholder, NEVER a broken <img> */
  heroImageUrl: string | null;
  /** Short mono label for the placeholder, e.g. "resort hero". Optional. */
  heroLabel?: string;
}

/** Fields shared by both card variants. */
interface CardBase extends HotelDisplay {
  /** Every flag in this array MUST render, above the fold, before positive content. */
  hardFlags: CardFlag[];
  /** Loyalty / brand programme note. null → no loyalty pill. */
  brandNote: string | null;
}

/** Props for the Top Pick (hero) card. Composes assembly `TopPick` + hotel metadata. */
export interface TopPickCardProps extends CardBase {
  /** assembly `top_pick.verdict` — the serif italic "Why this one" callout. */
  verdict: TopPick['verdict'];
  /** assembly `top_pick.category_summaries` — one sentence per category. */
  categorySummaries: CategorySummaries;
  /** assembly `top_pick.why_top_pick`. Reserved for future use / a11y. */
  whyTopPick?: TopPick['why_top_pick'];
  onSave?: () => void;
  onProceed?: () => void;
}

/** Props for a Standard (collapsible) alternative card. Composes `OtherPick`.
 *
 *  CONTRACT NOTE: the assembly `other_picks[]` schema (08b-2) carries ONLY `summary`
 *  (+ hard_flags, brand_note) — it does NOT include a verdict or category_summaries.
 *  So those expanded-detail fields are OPTIONAL here: when a mapper can hydrate richer
 *  detail from `hotel_intelligence` (3c), the card expands to the full body; when only
 *  the assembly output is available, the card omits the expand affordance and shows the
 *  summary alone. This keeps the component faithful to the locked contract — we do not
 *  require a shape the assembler cannot produce. */
export interface StandardCardProps extends CardBase {
  /** assembly `other_picks[].summary` — the collapsed blurb (always present). */
  summary: OtherPick['summary'];
  /** Expanded "Why" callout. Optional — only present when hydrated from intelligence.
   *  When absent, the card does not offer "See full details". */
  verdict?: string;
  /** Mono label for the expanded "Why" callout, e.g. "Why it's second" / "Why I'd wait". */
  verdictLabel?: string;
  /** Optional — the 2x2 grid only renders when category summaries are hydrated. */
  categorySummaries?: CategorySummaries;
  /** Optional rank label rendered as a hero pill, e.g. "Runner-up". */
  rankLabel?: string;
  /** Controlled-open override; otherwise the card manages its own open state. */
  defaultOpen?: boolean;
  onSave?: (saved: boolean) => void;
  onProceed?: () => void;
}

/** Props for the full set: one top pick + N standard alternatives. */
export interface RecommendationSetProps {
  topPick: TopPickCardProps;
  otherPicks: StandardCardProps[];
  /** Heading rendered on the alternatives divider. */
  altHeading?: string;
}

/** Convenience map: DB price_tier (`PRICE_TIERS`) → display label.
 *  The mapper may use this; components accept the already-formatted string. */
export const PRICE_TIER_LABELS: Record<string, string> = {
  'mid-range': 'Comfort',
  luxury: 'Luxury',
  'ultra-luxury': 'Ultra-luxury',
};
