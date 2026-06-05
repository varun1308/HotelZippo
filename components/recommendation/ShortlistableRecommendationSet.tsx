/* ShortlistableRecommendationSet — wraps the pure <RecommendationSet> and connects
 * each card's Save button to the shortlist via ShortlistContext (Phase 3d), and its
 * "Proceed to book" button to the booking flow via BookingContext (Phase 7).
 *
 * The pure RecommendationSet/HotelCard stay presentational; this wrapper is the ONE
 * place that knows about shortlist + booking state. Outside the providers both contexts
 * yield inert no-ops, so this degrades to the plain set — which is exactly what the
 * standalone mock chat page / 3a tests rely on. */
'use client';

import { RecommendationSet } from './RecommendationSet';
import type { RecommendationSetProps, StandardCardProps, TopPickCardProps } from './types';
import { useShortlistActions } from '@/lib/shortlist/context';
import type { SavedHotel } from '@/lib/shortlist/types';
import { useBookingActions, type BookingHotel } from '@/lib/booking/context';

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

/** A card carries the hotel identity the booking flow needs (id + name + destination). */
function toBookingHotel(card: TopPickCardProps | StandardCardProps): BookingHotel | null {
  if (!card.hotelId) return null;
  return { hotelId: card.hotelId, hotelName: card.hotelName, destination: card.destination };
}

export function ShortlistableRecommendationSet(props: RecommendationSetProps) {
  const actions = useShortlistActions();
  const booking = useBookingActions();

  const topSaved = toSavedHotel(props.topPick);
  const topBooking = toBookingHotel(props.topPick);
  const topPick: TopPickCardProps = {
    ...props.topPick,
    saved: topSaved ? actions.isSaved(topSaved.hotelId) : undefined,
    onSave: topSaved ? () => actions.toggle(topSaved) : props.topPick.onSave,
    onProceed: topBooking ? () => booking.proceed(topBooking) : props.topPick.onProceed,
  };

  const otherPicks: StandardCardProps[] = props.otherPicks.map((pick) => {
    const saved = toSavedHotel(pick);
    const bookingHotel = toBookingHotel(pick);
    return {
      ...pick,
      saved: saved ? actions.isSaved(saved.hotelId) : undefined,
      onSave: saved ? () => actions.toggle(saved) : pick.onSave,
      onProceed: bookingHotel ? () => booking.proceed(bookingHotel) : pick.onProceed,
    };
  });

  return <RecommendationSet {...props} topPick={topPick} otherPicks={otherPicks} />;
}
