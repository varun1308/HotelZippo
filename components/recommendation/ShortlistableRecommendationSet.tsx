/* ShortlistableRecommendationSet — wraps the pure <RecommendationSet> and connects
 * each card's Save button to the shortlist via ShortlistContext (Phase 3d).
 *
 * The pure RecommendationSet/HotelCard stay presentational; this wrapper is the ONE
 * place that knows about shortlist state. Outside a ShortlistProvider the context
 * yields inert no-ops (isSaved → false), so this degrades to the plain set — which
 * is exactly what the standalone mock chat page / 3a tests rely on. */
'use client';

import { RecommendationSet } from './RecommendationSet';
import type { RecommendationSetProps, StandardCardProps, TopPickCardProps } from './types';
import { useShortlistActions } from '@/lib/shortlist/context';
import type { SavedHotel } from '@/lib/shortlist/types';

function toSavedHotel(card: TopPickCardProps | StandardCardProps): SavedHotel | null {
  if (!card.hotelId) return null;
  return {
    hotelId: card.hotelId,
    hotelName: card.hotelName,
    destination: card.destination,
    area: card.area,
    priceTierLabel: card.priceTierLabel,
    heroImageUrl: card.heroImageUrl,
  };
}

export function ShortlistableRecommendationSet(props: RecommendationSetProps) {
  const actions = useShortlistActions();

  const topSaved = toSavedHotel(props.topPick);
  const topPick: TopPickCardProps = {
    ...props.topPick,
    saved: topSaved ? actions.isSaved(topSaved.hotelId) : undefined,
    onSave: topSaved ? () => actions.toggle(topSaved) : props.topPick.onSave,
  };

  const otherPicks: StandardCardProps[] = props.otherPicks.map((pick) => {
    const saved = toSavedHotel(pick);
    return {
      ...pick,
      saved: saved ? actions.isSaved(saved.hotelId) : undefined,
      onSave: saved ? () => actions.toggle(saved) : pick.onSave,
    };
  });

  return <RecommendationSet {...props} topPick={topPick} otherPicks={otherPicks} />;
}
