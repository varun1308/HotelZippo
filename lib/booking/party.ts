/* Party inference + date resolution (Phase 7 · specs/10c-booking-routestack.md).
 *
 * Pure functions — no env, no I/O. These SEED the combined conversational confirm turn
 * (Slice B): the agent infers the travelling party + a default room count from the family
 * profile, the user confirms or corrects (this is how grandparents — notes-only, not a
 * structured field — get into the party), and the CONFIRMED values become authoritative.
 *
 * Why inference-then-confirm rather than silent derivation: grandparents live only in
 * freestyle notes and travellers/rooms materially affect price + availability, so we never
 * book on a guess — we propose, the user confirms. */
import type { FamilyProfile } from '@/components/profile';
import type { TravelParty, BookingDates } from './types';

/** Words in freestyle notes that hint grandparents (or extra adults) are travelling, used
 * only to flag the inference for the confirm turn — never to silently bump the count. */
const GRANDPARENT_HINTS = [
  'grandparent',
  'grandparents',
  'grandma',
  'grandmother',
  'grandpa',
  'grandfather',
  'nani',
  'nana',
  'dada',
  'dadi',
  'in-laws',
  'parents',
];

export interface InferredParty extends TravelParty {
  /** True if notes mention grandparents/extra adults — surfaced in the confirm turn so the
   * user is nudged to add them (we do NOT auto-count, since ages/number are unknown). */
  grandparentHint: boolean;
}

/** Default room-count heuristic: ~1 room per 2 adults, and grandparents (when hinted)
 * likely want a separate room. Always ≥1. The user adjusts this in the confirm turn. */
export function defaultRoomCount(adults: number, grandparentHint: boolean): number {
  const base = Math.max(1, Math.ceil(adults / 2));
  return grandparentHint ? base + 1 : base;
}

/** Infer the travelling party from the structured profile. adults = primary + spouse;
 * children + ages from family_members.children. Grandparents are NOT counted (notes-only)
 * — only hinted, for the confirm turn to resolve. The returned party is a PROPOSAL. */
export function inferParty(profile: FamilyProfile): InferredParty {
  const adults = 1 + (profile.spouse ? 1 : 0);
  const childAges = (profile.children ?? [])
    .map((c) => c.age)
    .filter((age): age is number => typeof age === 'number' && Number.isFinite(age));
  const notes = (profile.notes ?? '').toLowerCase();
  const grandparentHint = GRANDPARENT_HINTS.some((h) => notes.includes(h));
  return {
    adults,
    childAges,
    rooms: defaultRoomCount(adults, grandparentHint),
    grandparentHint,
  };
}

/** A short human summary of the inferred party for the confirm turn, e.g.
 * "2 adults, 2 children (ages 2, 7), 2 rooms". Grandparent hint adds a nudge. */
export function describeParty(party: InferredParty): string {
  const parts: string[] = [];
  parts.push(`${party.adults} adult${party.adults === 1 ? '' : 's'}`);
  if (party.childAges.length > 0) {
    const ages = party.childAges.join(', ');
    parts.push(
      `${party.childAges.length} child${party.childAges.length === 1 ? '' : 'ren'} (age${
        party.childAges.length === 1 ? '' : 's'
      } ${ages})`,
    );
  }
  parts.push(`${party.rooms} room${party.rooms === 1 ? '' : 's'}`);
  let summary = parts.join(', ');
  if (party.grandparentHint) {
    summary += ' — your notes mention grandparents; add them if they’re travelling';
  }
  return summary;
}

/** Distribute a confirmed party across its rooms into RouteStack's rooms[] occupancy
 * array. v1 keeps it simple and predictable: children (with ages) all go in the first
 * room; adults are spread as evenly as possible across the rooms; every room has ≥1 adult.
 * The confirmed party is authoritative — this only shapes it for the API. */
export function buildRoomsOccupancy(party: TravelParty): Array<{
  adults: number;
  children: number;
  childAges: number[];
}> {
  const roomCount = Math.max(1, party.rooms);
  const rooms = Array.from({ length: roomCount }, () => ({
    adults: 0,
    children: 0,
    childAges: [] as number[],
  }));

  // Spread adults round-robin so each room gets at least one where possible.
  for (let i = 0; i < party.adults; i++) {
    rooms[i % roomCount].adults += 1;
  }
  // If there are more rooms than adults, collapse empty rooms (don't send 0-adult rooms).
  const occupied = rooms.filter((r) => r.adults > 0);
  const target = occupied.length > 0 ? occupied : [rooms[0]];
  if (target[0].adults === 0) target[0].adults = Math.max(1, party.adults);

  // All children into the first occupied room (v1 — keeps childAges valid + simple).
  target[0].children = party.childAges.length;
  target[0].childAges = [...party.childAges];

  return target;
}

/** Resolve booking dates from trip_briefs.travel_dates (loosely-typed jsonb — there is no
 * travel_month column). Returns null when there is no resolvable start+end ("month-only"),
 * which the agent answers with the combined confirm turn (prompt for exact dates). Accepts
 * a few plausible shapes since travel_dates is z.unknown(). */
export function resolveDates(travelDates: unknown): BookingDates | null {
  if (!travelDates || typeof travelDates !== 'object') return null;
  const td = travelDates as Record<string, unknown>;

  // Common shapes: {start,end} | {checkIn,checkOut} | {from,to}.
  const start = firstString(td.start, td.checkIn, td.from, td.startDate, td.check_in);
  const end = firstString(td.end, td.checkOut, td.to, td.endDate, td.check_out);
  if (start && end && isIsoDate(start) && isIsoDate(end)) {
    return { checkIn: start, checkOut: end };
  }
  return null;
}

function firstString(...vals: unknown[]): string | null {
  for (const v of vals) if (typeof v === 'string' && v.trim()) return v.trim();
  return null;
}

/** Strict ISO yyyy-mm-dd (what RouteStack search-hotels requires). */
export function isIsoDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}
