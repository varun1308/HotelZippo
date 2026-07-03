/* useTripBrief contract (Phase 3d · specs/03b-recommendation-flow.md gates +
 * specs/05-ui-component-specs.md Trip Brief rail). The hook owns the rail's state:
 * applyUserText fills rows from what the user actually typed (never inventing),
 * applyRecommendationGates locks the authoritative fields when cards arrive,
 * applyProfile seeds from the saved family profile, and setField/addPref are the
 * explicit escape hatches. Gating: coreReady (the "Find hotels" gate) requires the
 * four hard-gate fields (destination, type, dates, who); filledCount drives the
 * n/6 meter. Merge rule under test: fill or overwrite with non-null, NEVER clobber
 * a known value with null. Pure client state — key-free, no DB, no mocks needed. */
import { act, renderHook } from '@testing-library/react';
import { useTripBrief } from '@/lib/brief/useTripBrief';
import { EMPTY_BRIEF, type TripBriefState } from '@/lib/brief/types';

describe('useTripBrief', () => {
  it('starts empty: 0/6 filled, gates closed', () => {
    const { result } = renderHook(() => useTripBrief());
    expect(result.current.brief).toEqual(EMPTY_BRIEF);
    expect(result.current.filledCount).toBe(0);
    expect(result.current.coreReady).toBe(false);
  });

  it('accepts an initial brief and derives counts from it', () => {
    const initial: TripBriefState = { ...EMPTY_BRIEF, destination: 'Phuket', dates: 'December' };
    const { result } = renderHook(() => useTripBrief(initial));
    expect(result.current.filledCount).toBe(2);
    expect(result.current.coreReady).toBe(false); // type + who still pending
  });

  describe('applyUserText (deterministic detection over the user message)', () => {
    it('fills the fields the user actually stated', () => {
      const { result } = renderHook(() => useTripBrief());
      act(() =>
        result.current.applyUserText('Beach resort in Phuket this December with the kids'),
      );
      expect(result.current.brief.destination).toBe('Phuket');
      expect(result.current.brief.type).toBe('Resort-anchored');
      expect(result.current.brief.dates).toBe('December');
      expect(result.current.brief.who).toBe('Family with young children');
      expect(result.current.filledCount).toBe(4);
    });

    it('never invents: undetectable text leaves state untouched (same object)', () => {
      const { result } = renderHook(() => useTripBrief());
      const before = result.current.brief;
      act(() => result.current.applyUserText('hmm, what would you suggest?'));
      expect(result.current.brief).toBe(before); // referential no-op, rows stay pending
    });

    it('never clobbers a known value with null, but a new non-null detection overwrites', () => {
      const { result } = renderHook(() => useTripBrief());
      act(() => result.current.applyUserText('Thinking Phuket, luxury'));
      expect(result.current.brief.destination).toBe('Phuket');
      expect(result.current.brief.budget).toBe('Luxury');

      // Message with no destination signal → destination survives.
      act(() => result.current.applyUserText('needs a good pool'));
      expect(result.current.brief.destination).toBe('Phuket');

      // User changes their mind → non-null detection overwrites.
      act(() => result.current.applyUserText('actually make it Bali'));
      expect(result.current.brief.destination).toBe('Bali');
      expect(result.current.brief.budget).toBe('Luxury');
    });
  });

  describe('coreReady gate (destination + type + dates + who)', () => {
    it('stays closed until all four hard gates are filled; budget/food are not required', () => {
      const { result } = renderHook(() => useTripBrief());
      act(() => {
        result.current.setField('destination', 'Phuket');
        result.current.setField('type', 'Resort-anchored');
        result.current.setField('dates', 'December');
      });
      expect(result.current.coreReady).toBe(false); // who still pending

      act(() => result.current.setField('who', '2 adults, 2 kids'));
      expect(result.current.coreReady).toBe(true); // budget + food still null

      expect(result.current.brief.budget).toBeNull();
      expect(result.current.brief.food).toBeNull();
      expect(result.current.filledCount).toBe(4);
    });
  });

  describe('applyRecommendationGates (authoritative once cards arrive)', () => {
    it('locks destination + type, and null/absent gates do not clear known values', () => {
      const { result } = renderHook(() => useTripBrief());
      act(() => result.current.setField('budget', 'Comfort'));

      act(() =>
        result.current.applyRecommendationGates({
          destination: 'Singapore',
          type: 'City / activity',
          budget: null, // authoritative payload may omit/null — must NOT clear Comfort
        }),
      );
      expect(result.current.brief.destination).toBe('Singapore');
      expect(result.current.brief.type).toBe('City / activity');
      expect(result.current.brief.budget).toBe('Comfort');
    });
  });

  describe('applyProfile (seed from the saved family profile)', () => {
    it('seeds food/budget/who from the profile patch', () => {
      const { result } = renderHook(() => useTripBrief());
      act(() =>
        result.current.applyProfile({
          who: 'Family with young children',
          budget: 'Comfort',
          food: 'Vegetarian · Indian options important',
        }),
      );
      expect(result.current.brief).toMatchObject({
        who: 'Family with young children',
        budget: 'Comfort',
        food: 'Vegetarian · Indian options important',
        destination: null, // profile never fills trip-specific gates
      });
      expect(result.current.filledCount).toBe(3);
    });
  });

  describe('setField / addPref escape hatches', () => {
    it('setField can explicitly clear a field back to pending (unlike the merge paths)', () => {
      const { result } = renderHook(() => useTripBrief());
      act(() => result.current.setField('dates', 'December'));
      expect(result.current.filledCount).toBe(1);

      act(() => result.current.setField('dates', null));
      expect(result.current.brief.dates).toBeNull();
      expect(result.current.filledCount).toBe(0);
    });

    it('addPref appends a chip once and dedupes repeat labels', () => {
      const { result } = renderHook(() => useTripBrief());
      act(() => result.current.addPref('Loves quiet pools'));
      act(() => result.current.addPref('Loves quiet pools')); // duplicate → ignored
      act(() => result.current.addPref('Kids club a must'));

      expect(result.current.brief.prefs.map((p) => p.label)).toEqual([
        'Loves quiet pools',
        'Kids club a must',
      ]);
      // Chip ids must be unique (they key the rail's list rendering).
      const ids = result.current.brief.prefs.map((p) => p.id);
      expect(new Set(ids).size).toBe(ids.length);
    });
  });
});
