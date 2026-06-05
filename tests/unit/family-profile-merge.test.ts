/* Pure profile-merge helpers (agent profile persistence). No DB — just the merge + the
 * change-label logic the `update_profile` tool and the inline chip rely on. */
import {
  mergeProfile,
  changedFieldLabels,
  type ProfilePatch,
} from '@/lib/db/persistence/family-profiles';
import type { FamilyProfile } from '@/components/profile';

const base: FamilyProfile = {
  name: 'Raj',
  hometown: 'Mumbai',
  spouse: true,
  children: [{ name: 'Aanya', age: 7 }],
  food: 'none',
  indianFoodMatters: false,
  budgetTier: 'comfort',
  brandPreferences: ['Marriott Bonvoy'],
  notes: null,
};

describe('mergeProfile', () => {
  it('overrides only the provided fields, carrying the rest through', () => {
    const merged = mergeProfile(base, { budgetTier: 'luxury' });
    expect(merged.budgetTier).toBe('luxury');
    expect(merged).toEqual({ ...base, budgetTier: 'luxury' });
  });

  it('ignores undefined keys (does not clobber existing values)', () => {
    const patch: ProfilePatch = { budgetTier: undefined, food: 'vegetarian' };
    const merged = mergeProfile(base, patch);
    expect(merged.budgetTier).toBe('comfort'); // untouched
    expect(merged.food).toBe('vegetarian');
  });

  it('replaces array/object fields wholesale', () => {
    const kids = [
      { name: 'Aanya', age: 7 },
      { name: 'Vivaan', age: 2 },
    ];
    expect(mergeProfile(base, { children: kids }).children).toEqual(kids);
  });

  it('does not mutate the input profile', () => {
    const snapshot = JSON.parse(JSON.stringify(base));
    mergeProfile(base, { budgetTier: 'value' });
    expect(base).toEqual(snapshot);
  });
});

describe('changedFieldLabels', () => {
  it('labels a scalar change with the human field name', () => {
    expect(changedFieldLabels(base, { budgetTier: 'luxury' })).toEqual(['budget']);
  });

  it('returns [] when the patch matches the current value (no-op)', () => {
    expect(changedFieldLabels(base, { budgetTier: 'comfort' })).toEqual([]);
  });

  it('detects a deep change in an array field', () => {
    const labels = changedFieldLabels(base, {
      children: [
        { name: 'Aanya', age: 7 },
        { name: 'Vivaan', age: 2 },
      ],
    });
    expect(labels).toEqual(['children']);
  });

  it('returns [] when an array patch is deep-equal to existing', () => {
    expect(changedFieldLabels(base, { children: [{ name: 'Aanya', age: 7 }] })).toEqual([]);
  });

  it('labels multiple changed fields and skips unchanged ones', () => {
    const labels = changedFieldLabels(base, {
      food: 'vegetarian',
      indianFoodMatters: true,
      budgetTier: 'comfort', // unchanged → no label
    });
    expect(labels).toEqual(expect.arrayContaining(['food preference', 'Indian food preference']));
    expect(labels).not.toContain('budget');
  });

  it('ignores undefined patch keys', () => {
    expect(changedFieldLabels(base, { budgetTier: undefined })).toEqual([]);
  });
});
