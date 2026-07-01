/* Trip Brief state (specs 08b-1 trip-brief collection · 03b runtime).
 *
 * The rail (components/brief/TripBrief.tsx) is PURE presentational and renders
 * from a `TripBriefState`. The state is filled client-side (Phase 3d) by the
 * deterministic detector (lib/brief/detect.ts) over the user's own messages, and
 * the hard-gate fields lock once recommendation cards arrive (by then destination
 * + trip type are definitionally known). No agent change, no key required.
 *
 * Six core rows mirror the design prototype (Chat - Active & Streaming.html); the
 * recommendation HARD GATES per 08b-1 are only TWO of them — destination + trip
 * type — and only those gate the "Find hotels" button. */

/** The six core brief field keys, in display order. */
export const BRIEF_KEYS = [
  'destination',
  'dates',
  'type',
  'who',
  'budget',
  'food',
] as const;

export type BriefKey = (typeof BRIEF_KEYS)[number];

/** The recommendation hard gates (08b-1): the four fields that materially change a
 *  family hotel match — destination, trip type, WHEN (dates) and WHO'S travelling.
 *  Only these enable the "Find hotels" button; budget + food enrich the brief but
 *  are not required (they're usually already on the saved family profile). */
export const CORE_GATE_KEYS: readonly BriefKey[] = ['destination', 'type', 'dates', 'who'];

/** A lucide icon name (kept as a string so this module stays import-free / safe
 *  to unit-test anywhere; the rail maps the name to a component). */
export type BriefIconName =
  | 'map-pin'
  | 'calendar-days'
  | 'umbrella'
  | 'users'
  | 'wallet'
  | 'utensils';

/** Static per-field metadata: label, pending placeholder, icon. */
export interface BriefFieldMeta {
  key: BriefKey;
  label: string;
  pending: string;
  icon: BriefIconName;
}

export const BRIEF_FIELDS: readonly BriefFieldMeta[] = [
  { key: 'destination', label: 'Destination', pending: 'Where to?', icon: 'map-pin' },
  { key: 'dates', label: 'When', pending: 'Travel dates', icon: 'calendar-days' },
  { key: 'type', label: 'Trip type', pending: 'What kind of stay', icon: 'umbrella' },
  { key: 'who', label: "Who's travelling", pending: 'Your crew', icon: 'users' },
  { key: 'budget', label: 'Budget', pending: 'Comfort level', icon: 'wallet' },
  { key: 'food', label: 'Food', pending: 'Dietary needs', icon: 'utensils' },
];

/** A captured personal-preference chip (e.g. "Loves quiet pools"). */
export interface BriefPref {
  id: string;
  label: string;
}

/** The full brief state: a value per core field (null = pending) + pref chips. */
export interface TripBriefState {
  destination: string | null;
  dates: string | null;
  type: string | null;
  who: string | null;
  budget: string | null;
  food: string | null;
  prefs: BriefPref[];
}

export const EMPTY_BRIEF: TripBriefState = {
  destination: null,
  dates: null,
  type: null,
  who: null,
  budget: null,
  food: null,
  prefs: [],
};

/** Count of the six core fields that are filled (for the n / 6 meter). */
export function filledCount(brief: TripBriefState): number {
  return BRIEF_KEYS.reduce((n, k) => (brief[k] ? n + 1 : n), 0);
}

/** True once the recommendation hard gates (destination + trip type) are filled. */
export function coreReady(brief: TripBriefState): boolean {
  return CORE_GATE_KEYS.every((k) => brief[k] != null);
}
