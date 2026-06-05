/* ShortlistContext — lets the recommendation cards reach shortlist actions even
 * though they render deep inside the message stream (via the MessageRow registry),
 * not directly under the page.
 *
 * Cards consume `useShortlistActions()`. When NO provider is mounted (e.g. the 3a
 * card unit tests, or the standalone mock chat page), the hook returns inert no-ops
 * and isSaved() === false, so the cards stay usable in isolation. */
'use client';

import { createContext, useContext, type ReactNode } from 'react';
import type { SavedHotel } from './types';

export interface ShortlistActions {
  save: (hotel: SavedHotel) => void;
  remove: (hotelId: string) => void;
  toggle: (hotel: SavedHotel) => void;
  isSaved: (hotelId: string) => boolean;
}

const NOOP: ShortlistActions = {
  save: () => {},
  remove: () => {},
  toggle: () => {},
  isSaved: () => false,
};

const ShortlistContext = createContext<ShortlistActions>(NOOP);

export function ShortlistProvider({
  actions,
  children,
}: {
  actions: ShortlistActions;
  children: ReactNode;
}) {
  return <ShortlistContext.Provider value={actions}>{children}</ShortlistContext.Provider>;
}

/** Read shortlist actions. Safe outside a provider (returns inert no-ops). */
export function useShortlistActions(): ShortlistActions {
  return useContext(ShortlistContext);
}
