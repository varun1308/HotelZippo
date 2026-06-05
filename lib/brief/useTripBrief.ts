/* useTripBrief — client state for the Trip Brief rail (Phase 3d).
 *
 * Holds a TripBriefState and applies updates from the two cheap, already-available
 * signals (see [[phase-3-approach]] / the 3d plan):
 *   • applyUserText  — runs the deterministic detector over each USER message,
 *     filling rows from what the user actually typed (never inventing).
 *   • applyRecommendationGates — once cards arrive, lock the hard gates
 *     (destination + trip type) that are definitionally known by then.
 *   • applyProfile  — seed food/budget/who from a submitted Family Profile form.
 *   • setField / addPref — escape hatches for explicit updates.
 *
 * No agent change, key-free. The rail consumes `brief`; the page owns this hook. */
'use client';

import { useCallback, useMemo, useState } from 'react';
import { detectBriefUpdates } from './detect';
import {
  EMPTY_BRIEF,
  coreReady as coreReadyOf,
  filledCount as filledCountOf,
  type BriefKey,
  type BriefPref,
  type TripBriefState,
} from './types';

export interface UseTripBrief {
  brief: TripBriefState;
  filledCount: number;
  coreReady: boolean;
  applyUserText: (text: string) => void;
  applyRecommendationGates: (gates: {
    destination?: string | null;
    type?: string | null;
    budget?: string | null;
  }) => void;
  applyProfile: (patch: Partial<Omit<TripBriefState, 'prefs'>>) => void;
  setField: (key: BriefKey, value: string | null) => void;
  addPref: (label: string) => void;
}

export function useTripBrief(initial: TripBriefState = EMPTY_BRIEF): UseTripBrief {
  const [brief, setBrief] = useState<TripBriefState>(initial);

  // Only ever FILL a pending field or overwrite with a non-null detection; never
  // clobber a known value with null. The gates path may overwrite (authoritative).
  const mergeFill = useCallback((patch: Partial<Omit<TripBriefState, 'prefs'>>) => {
    setBrief((prev) => {
      const next = { ...prev };
      let changed = false;
      (Object.keys(patch) as BriefKey[]).forEach((k) => {
        const v = patch[k];
        if (v != null && prev[k] !== v) {
          next[k] = v;
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, []);

  const applyUserText = useCallback(
    (text: string) => mergeFill(detectBriefUpdates(text)),
    [mergeFill],
  );

  const applyRecommendationGates = useCallback(
    (gates: { destination?: string | null; type?: string | null; budget?: string | null }) =>
      mergeFill(gates),
    [mergeFill],
  );

  const applyProfile = useCallback(
    (patch: Partial<Omit<TripBriefState, 'prefs'>>) => mergeFill(patch),
    [mergeFill],
  );

  const setField = useCallback((key: BriefKey, value: string | null) => {
    setBrief((prev) => ({ ...prev, [key]: value }));
  }, []);

  const addPref = useCallback((label: string) => {
    setBrief((prev) => {
      if (prev.prefs.some((p) => p.label === label)) return prev;
      const pref: BriefPref = { id: `${prev.prefs.length}-${label}`, label };
      return { ...prev, prefs: [...prev.prefs, pref] };
    });
  }, []);

  const filledCount = useMemo(() => filledCountOf(brief), [brief]);
  const coreReady = useMemo(() => coreReadyOf(brief), [brief]);

  return {
    brief,
    filledCount,
    coreReady,
    applyUserText,
    applyRecommendationGates,
    applyProfile,
    setField,
    addPref,
  };
}
