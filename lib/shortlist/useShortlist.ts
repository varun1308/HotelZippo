/* useShortlist — client state for saved hotels (Phase 3d).
 *
 * Owns the shortlist array; save() de-dupes on hotelId. Phase 4 will persist this
 * to Supabase; for now it lives in the page. The cards reach save/remove/isSaved
 * through ShortlistContext (lib/shortlist/context.tsx) because they render deep
 * inside the message stream, not directly under the page. */
'use client';

import { useCallback, useMemo, useState } from 'react';
import type { SavedHotel } from './types';

export interface UseShortlist {
  items: SavedHotel[];
  count: number;
  save: (hotel: SavedHotel) => void;
  remove: (hotelId: string) => void;
  toggle: (hotel: SavedHotel) => void;
  isSaved: (hotelId: string) => boolean;
}

export function useShortlist(initial: SavedHotel[] = []): UseShortlist {
  const [items, setItems] = useState<SavedHotel[]>(initial);

  const save = useCallback((hotel: SavedHotel) => {
    setItems((prev) => (prev.some((h) => h.hotelId === hotel.hotelId) ? prev : [...prev, hotel]));
  }, []);

  const remove = useCallback((hotelId: string) => {
    setItems((prev) => prev.filter((h) => h.hotelId !== hotelId));
  }, []);

  const toggle = useCallback((hotel: SavedHotel) => {
    setItems((prev) =>
      prev.some((h) => h.hotelId === hotel.hotelId)
        ? prev.filter((h) => h.hotelId !== hotel.hotelId)
        : [...prev, hotel],
    );
  }, []);

  const isSaved = useCallback((hotelId: string) => items.some((h) => h.hotelId === hotelId), [items]);

  const count = items.length;

  return useMemo(
    () => ({ items, count, save, remove, toggle, isSaved }),
    [items, count, save, remove, toggle, isSaved],
  );
}
