/* Phase 7 · party inference + room default + occupancy + date resolution (pure helpers).
 * These SEED the combined confirm turn; the confirmed party is authoritative. */
import {
  inferParty,
  describeParty,
  defaultRoomCount,
  buildRoomsOccupancy,
  resolveDates,
  isIsoDate,
  validateParty,
  PARTY_LIMITS,
} from '@/lib/booking/party';
import type { FamilyProfile } from '@/components/profile';

function profile(over: Partial<FamilyProfile> = {}): FamilyProfile {
  return {
    name: 'Raj',
    hometown: 'Mumbai',
    spouse: true,
    children: [
      { name: 'A', age: 2 },
      { name: 'B', age: 7 },
    ],
    food: 'vegetarian',
    indianFoodMatters: true,
    budgetTier: 'comfort',
    brandPreferences: [],
    notes: null,
    ...over,
  };
}

describe('inferParty', () => {
  it('counts primary + spouse as adults and reads child ages', () => {
    const p = inferParty(profile());
    expect(p.adults).toBe(2);
    expect(p.childAges).toEqual([2, 7]);
    expect(p.grandparentHint).toBe(false);
  });

  it('drops a spouse from the adult count when absent', () => {
    expect(inferParty(profile({ spouse: false })).adults).toBe(1);
  });

  it('does NOT auto-count grandparents but flags the hint from notes', () => {
    const p = inferParty(profile({ notes: 'Travelling with my parents and the grandparents' }));
    expect(p.adults).toBe(2); // grandparents NOT counted
    expect(p.grandparentHint).toBe(true); // but surfaced for the confirm turn
  });

  it('tolerates missing/garbage child ages', () => {
    const p = inferParty(profile({ children: [{ name: 'X', age: NaN as unknown as number }] }));
    expect(p.childAges).toEqual([]);
  });
});

describe('defaultRoomCount', () => {
  it('is ~1 room per 2 adults, min 1', () => {
    expect(defaultRoomCount(1, false)).toBe(1);
    expect(defaultRoomCount(2, false)).toBe(1);
    expect(defaultRoomCount(3, false)).toBe(2);
    expect(defaultRoomCount(4, false)).toBe(2);
  });
  it('adds a room when grandparents are hinted', () => {
    expect(defaultRoomCount(2, true)).toBe(2);
    expect(defaultRoomCount(4, true)).toBe(3);
  });
});

describe('validateParty (route-boundary guard — untrusted client input)', () => {
  const VALID = { adults: 2, childAges: [2, 7], rooms: 2 };

  it('accepts a sane party and returns a CLEAN copy (extra keys dropped)', () => {
    const r = validateParty({ ...VALID, children: 2, extra: 'ignored' });
    expect(r).toEqual({ ok: true, party: { adults: 2, childAges: [2, 7], rooms: 2 } });
  });

  it('rejects the DoS shapes: huge/absent/non-integer rooms and adults', () => {
    expect(validateParty({ ...VALID, rooms: 1e9 }).ok).toBe(false); // would OOM buildRoomsOccupancy
    expect(validateParty({ ...VALID, adults: 1e9 }).ok).toBe(false);
    expect(validateParty({ ...VALID, rooms: 0 }).ok).toBe(false);
    expect(validateParty({ ...VALID, rooms: 1.5 }).ok).toBe(false);
    expect(validateParty({ ...VALID, adults: '2' }).ok).toBe(false);
    expect(validateParty({ ...VALID, adults: 0 }).ok).toBe(false);
    expect(validateParty(null).ok).toBe(false);
    expect(validateParty('party').ok).toBe(false);
    expect(validateParty([1, 2]).ok).toBe(false);
  });

  it('enforces the caps (adults/rooms/children ≤ 8; ages 0-17 integers)', () => {
    expect(validateParty({ adults: PARTY_LIMITS.maxAdults, childAges: [], rooms: 1 }).ok).toBe(true);
    expect(validateParty({ adults: PARTY_LIMITS.maxAdults + 1, childAges: [], rooms: 1 }).ok).toBe(false);
    expect(validateParty({ adults: 2, childAges: Array(PARTY_LIMITS.maxChildren + 1).fill(5), rooms: 1 }).ok).toBe(false);
    expect(validateParty({ adults: 2, childAges: [18], rooms: 1 }).ok).toBe(false);
    expect(validateParty({ adults: 2, childAges: [-1], rooms: 1 }).ok).toBe(false);
    expect(validateParty({ adults: 2, childAges: [2.5], rooms: 1 }).ok).toBe(false);
    expect(validateParty({ adults: 2, childAges: 'none', rooms: 1 }).ok).toBe(false);
  });

  it('rejects rooms > adults with a clear message (every room needs an adult — never silently collapsed)', () => {
    const r = validateParty({ adults: 2, childAges: [], rooms: 3 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/room needs at least one adult/i);
  });
});

describe('describeParty', () => {
  it('produces a human summary with ages and rooms', () => {
    const s = describeParty(inferParty(profile()));
    expect(s).toContain('2 adults');
    expect(s).toContain('2 children');
    expect(s).toContain('2, 7');
    expect(s).toContain('1 room');
  });
  it('nudges to add grandparents when hinted', () => {
    const s = describeParty(inferParty(profile({ notes: 'with grandparents' })));
    expect(s).toMatch(/grandparents/i);
  });
});

describe('buildRoomsOccupancy', () => {
  it('puts all children in the first room and spreads adults', () => {
    const rooms = buildRoomsOccupancy({ adults: 2, childAges: [2, 7], rooms: 2 });
    expect(rooms).toHaveLength(2);
    expect(rooms[0]).toEqual({ adults: 1, children: 2, childAges: [2, 7] });
    expect(rooms[1]).toEqual({ adults: 1, children: 0, childAges: [] });
  });
  it('never emits a zero-adult room', () => {
    const rooms = buildRoomsOccupancy({ adults: 1, childAges: [], rooms: 3 });
    expect(rooms.every((r) => r.adults >= 1)).toBe(true);
  });
  it('handles a single room with the whole party', () => {
    const rooms = buildRoomsOccupancy({ adults: 3, childAges: [5], rooms: 1 });
    expect(rooms).toHaveLength(1);
    expect(rooms[0]).toEqual({ adults: 3, children: 1, childAges: [5] });
  });
});

describe('resolveDates', () => {
  it('resolves {start,end}', () => {
    expect(resolveDates({ start: '2026-07-01', end: '2026-07-05' })).toEqual({ checkIn: '2026-07-01', checkOut: '2026-07-05' });
  });
  it('resolves {checkIn,checkOut} and {from,to}', () => {
    expect(resolveDates({ checkIn: '2026-07-01', checkOut: '2026-07-05' })).toEqual({ checkIn: '2026-07-01', checkOut: '2026-07-05' });
    expect(resolveDates({ from: '2026-07-01', to: '2026-07-05' })).toEqual({ checkIn: '2026-07-01', checkOut: '2026-07-05' });
  });
  it('returns null for month-only / unresolvable dates (→ confirm turn)', () => {
    expect(resolveDates({ month: '2026-07' })).toBeNull();
    expect(resolveDates(null)).toBeNull();
    expect(resolveDates('July')).toBeNull();
    expect(resolveDates({ start: 'soon', end: 'later' })).toBeNull();
  });
});

describe('isIsoDate', () => {
  it('accepts valid yyyy-mm-dd only', () => {
    expect(isIsoDate('2026-07-01')).toBe(true);
    expect(isIsoDate('2026-13-01')).toBe(false);
    expect(isIsoDate('2026-02-30')).toBe(false);
    expect(isIsoDate('07/01/2026')).toBe(false);
  });
});
