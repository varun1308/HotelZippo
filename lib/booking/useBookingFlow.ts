/* useBookingFlow — the deterministic booking modal state machine (Phase 7 · Slice B).
 *
 * Wires a card's "Proceed to book" to the two server phases through /api/booking/*. The
 * booking wrapper is server-only, so this hook never touches RouteStack directly — it POSTs
 * to the routes and drives the modal:
 *
 *   idle → confirm → searching → picking → finalizing → handoff   (happy path)
 *                         └→ error (warm fallback; retry / pick another hotel)
 *
 * The confirm step is the modal's first screen (one combined turn: travellers + rooms +
 * dates), seeded by inferParty(profile) + resolveDates(travel_dates). The confirmed party is
 * authoritative. On a successful payment URL we open it in a new tab (the deep-link checkout)
 * and close — HotelZippo holds no booking state. All failures map to a warm BookingErrorKind
 * the modal speaks back (spec 14: never a dead-end). */
'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import type { FamilyProfile } from '@/components/profile';
import { inferParty, type InferredParty } from './party';
import type { BookingHotel } from './context';
import type { TravelParty, BookingDates, RoomRateOption, BookingErrorKind } from './types';
import type {
  RatesRequest,
  RatesResponse,
  PaymentUrlRequest,
  PaymentUrlResponse,
  BookingApiError,
} from './api-contract';

export type BookingStep = 'idle' | 'confirm' | 'searching' | 'picking' | 'finalizing' | 'error';

export interface BookingFlowState {
  step: BookingStep;
  hotel: BookingHotel | null;
  /** Editable party for the confirm screen (seeded from the profile, user-adjustable). */
  party: TravelParty;
  /** Whether grandparents were hinted in the profile notes (nudge on the confirm screen). */
  grandparentHint: boolean;
  /** Resolved dates, or null when month-only (confirm screen must collect them). */
  dates: BookingDates | null;
  /** Rooms/rates options for the picker (phase-1 result). */
  options: RoomRateOption[];
  /** Warm error for the fallback copy. */
  error: { kind: BookingErrorKind; message: string } | null;
}

const EMPTY_PARTY: TravelParty = { adults: 1, childAges: [], rooms: 1 };

export interface BookingFlowApi {
  state: BookingFlowState;
  /** Card CTA → open the confirm screen for this hotel (seeded from the profile). */
  proceed: (hotel: BookingHotel) => void;
  /** Confirm screen edits. */
  setParty: (party: TravelParty) => void;
  setDates: (dates: BookingDates) => void;
  /** Confirm screen → run phase 1 (search + rates) and advance to the picker. */
  confirm: () => Promise<void>;
  /** Picker → run phase 2 (revalidate + payment URL) and hand off (open new tab). */
  selectRoom: (option: RoomRateOption) => Promise<void>;
  /** Dismiss the modal (any step). */
  close: () => void;
  /** Retry from the confirm screen after an error. */
  retry: () => void;
}

interface Deps {
  /** The signed-in user's saved profile — seeds the inferred party. May be null. */
  profile: FamilyProfile | null;
  /** Resolved trip dates from the brief (null ⇒ confirm screen must collect them). */
  dates: BookingDates | null;
  /** Currency for the search (USD default for v1). */
  currency?: string;
  /** Injectable fetch for tests; defaults to window.fetch. */
  fetchImpl?: typeof fetch;
  /** Injectable opener for tests; defaults to window.open. */
  openUrl?: (url: string) => void;
}

function seedParty(profile: FamilyProfile | null): { party: TravelParty; grandparentHint: boolean } {
  if (!profile) return { party: EMPTY_PARTY, grandparentHint: false };
  const inferred: InferredParty = inferParty(profile);
  return {
    party: { adults: inferred.adults, childAges: inferred.childAges, rooms: inferred.rooms },
    grandparentHint: inferred.grandparentHint,
  };
}

export function useBookingFlow(deps: Deps): BookingFlowApi {
  // Stable across renders so the async callbacks' deps don't change every render.
  const doFetch = useMemo(
    () => deps.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a)),
    [deps.fetchImpl],
  );
  const open = useMemo(
    () => deps.openUrl ?? ((url: string) => window.open(url, '_blank', 'noopener,noreferrer')),
    [deps.openUrl],
  );

  const [state, setStateRaw] = useState<BookingFlowState>({
    step: 'idle',
    hotel: null,
    party: EMPTY_PARTY,
    grandparentHint: false,
    dates: deps.dates,
    options: [],
    error: null,
  });
  // Mirror the latest state in a ref so the async steps read a current snapshot without
  // racing React's batched updates.
  const stateRef = useRef(state);
  const setState = useCallback((updater: (s: BookingFlowState) => BookingFlowState) => {
    setStateRaw((s) => {
      const next = updater(s);
      stateRef.current = next;
      return next;
    });
  }, []);

  // Session handles from phase 1, needed by phase 2 (kept off render state).
  const handlesRef = useRef<{ correlationId: string; token: string; hotelId: string; hotelName: string } | null>(null);

  const proceed = useCallback(
    (hotel: BookingHotel) => {
      const { party, grandparentHint } = seedParty(deps.profile);
      handlesRef.current = null;
      setState(() => ({ step: 'confirm', hotel, party, grandparentHint, dates: deps.dates, options: [], error: null }));
    },
    [deps.profile, deps.dates, setState],
  );

  const setParty = useCallback((party: TravelParty) => setState((s) => ({ ...s, party })), [setState]);
  const setDates = useCallback((dates: BookingDates) => setState((s) => ({ ...s, dates })), [setState]);
  const close = useCallback(() => setState((s) => ({ ...s, step: 'idle', error: null })), [setState]);
  const retry = useCallback(() => setState((s) => ({ ...s, step: 'confirm', error: null })), [setState]);

  const confirm = useCallback(async () => {
    const { hotel, party, dates } = stateRef.current;
    if (!hotel || !dates) {
      setState((s) => ({ ...s, step: 'confirm' })); // need dates — stay on confirm
      return;
    }
    setState((s) => ({ ...s, step: 'searching', error: null }));
    const reqBody: RatesRequest = {
      hotelId: hotel.hotelId,
      hotelName: hotel.hotelName,
      destination: hotel.destination,
      party,
      dates,
      currency: deps.currency,
    };
    try {
      const res = await doFetch('/api/booking/rates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(reqBody),
      });
      const json = (await res.json()) as RatesResponse | BookingApiError;
      if ('error' in json) {
        setState((s) => ({ ...s, step: 'error', error: { kind: json.error, message: json.message } }));
        return;
      }
      handlesRef.current = { correlationId: json.correlationId, token: json.token, hotelId: json.hotelId, hotelName: json.hotelName };
      setState((s) => ({ ...s, step: 'picking', options: json.options }));
    } catch {
      setState((s) => ({ ...s, step: 'error', error: { kind: 'transport', message: 'I couldn’t reach the booking service.' } }));
    }
  }, [doFetch, deps.currency, setState]);

  const selectRoom = useCallback(
    async (option: RoomRateOption) => {
      const handles = handlesRef.current;
      const dates = stateRef.current.dates;
      if (!handles || !dates) {
        setState((s) => ({ ...s, step: 'error', error: { kind: 'session-expired', message: 'That session expired — let’s search again.' } }));
        return;
      }
      setState((s) => ({ ...s, step: 'finalizing', error: null }));
      const reqBody: PaymentUrlRequest = {
        hotelId: handles.hotelId,
        hotelName: handles.hotelName,
        correlationId: handles.correlationId,
        token: handles.token,
        recommendationId: option.recommendationId,
        roomId: option.roomId,
        dates,
      };
      try {
        const res = await doFetch('/api/booking/payment-url', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(reqBody),
        });
        const json = (await res.json()) as PaymentUrlResponse | BookingApiError;
        if ('error' in json) {
          setState((s) => ({ ...s, step: 'error', error: { kind: json.error, message: json.message } }));
          return;
        }
        open(json.bookingUrl);
        setState((s) => ({ ...s, step: 'idle' })); // handed off — close the modal
      } catch {
        setState((s) => ({ ...s, step: 'error', error: { kind: 'transport', message: 'I couldn’t reach the booking service.' } }));
      }
    },
    [doFetch, open, setState],
  );

  return { state, proceed, setParty, setDates, confirm, selectRoom, close, retry };
}
