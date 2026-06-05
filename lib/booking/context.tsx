/* BookingContext — lets a recommendation card start the booking flow even though it renders
 * deep inside the message stream (via MessageRow), not directly under the chat page.
 *
 * Mirrors ShortlistContext: cards call `useBookingActions().proceed(hotel)` from their
 * "Proceed to book" CTA. With NO provider mounted (3a card tests / standalone mock chat),
 * the hook returns an inert no-op so the cards stay usable in isolation. */
'use client';

import { createContext, useContext, type ReactNode } from 'react';

/** The hotel identity a card hands to the booking flow (carried on the card props). */
export interface BookingHotel {
  hotelId: string;
  hotelName: string;
  destination: string;
}

export interface BookingActions {
  /** Start the booking flow for this hotel (confirm turn → rates → picker → handoff). */
  proceed: (hotel: BookingHotel) => void;
}

const NOOP: BookingActions = { proceed: () => {} };

const BookingContext = createContext<BookingActions>(NOOP);

export function BookingProvider({ actions, children }: { actions: BookingActions; children: ReactNode }) {
  return <BookingContext.Provider value={actions}>{children}</BookingContext.Provider>;
}

/** Read booking actions. Safe outside a provider (inert no-op). */
export function useBookingActions(): BookingActions {
  return useContext(BookingContext);
}
