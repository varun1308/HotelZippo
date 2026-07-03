/* Assembly reuse-key derivation (lib/recommendations/input-hash.ts, spec 03c line 61).
 * The input_hash MUST cover {destination, trip_type, budget, food, candidate-set key} — the
 * review found evaluate_only/pre-shortlisted turns and food preferences were silently excluded
 * from the key, so materially different requests could re-attach to the same cached job. */
import { computeInputHash, hashPartsFromAssemblyInput } from '@/lib/recommendations/input-hash';

const hashOf = (input: Parameters<typeof hashPartsFromAssemblyInput>[0]) =>
  computeInputHash(hashPartsFromAssemblyInput(input));

const BASE = {
  family_profile: { budget_tier: 'comfort', food_preferences: ['vegetarian'] },
  trip_brief: { destination: 'Phuket', trip_type: 'resort-anchored' },
};

describe('hashPartsFromAssemblyInput', () => {
  it('an evaluate-only turn hashes differently from an open turn (03c candidate-set key)', () => {
    const open = hashOf(BASE);
    const evaluateOnly = hashOf({
      ...BASE,
      trip_brief: { ...BASE.trip_brief, evaluate_only: true, pre_shortlisted_hotels: ['Hotel A'] },
    });
    expect(evaluateOnly).not.toBe(open);
  });

  it('different pre-shortlisted sets fork the key; order does not', () => {
    const ab = hashOf({
      ...BASE,
      trip_brief: { ...BASE.trip_brief, evaluate_only: true, pre_shortlisted_hotels: ['A', 'B'] },
    });
    const ba = hashOf({
      ...BASE,
      trip_brief: { ...BASE.trip_brief, evaluate_only: true, pre_shortlisted_hotels: ['B', 'A'] },
    });
    const ac = hashOf({
      ...BASE,
      trip_brief: { ...BASE.trip_brief, evaluate_only: true, pre_shortlisted_hotels: ['A', 'C'] },
    });
    expect(ab).toBe(ba); // sorted — cosmetic order never forks the key
    expect(ab).not.toBe(ac);
  });

  it('food preferences affect the hash — read from the REAL food_preferences array', () => {
    const veg = hashOf(BASE);
    const none = hashOf({ ...BASE, family_profile: { budget_tier: 'comfort', food_preferences: [] } });
    const veganIndian = hashOf({
      ...BASE,
      family_profile: { budget_tier: 'comfort', food_preferences: ['vegan', 'indian-food-matters'] },
    });
    expect(veg).not.toBe(none);
    expect(veg).not.toBe(veganIndian);
    // Array order is normalised (sorted) so it never forks the key.
    const flipped = hashOf({
      ...BASE,
      family_profile: { budget_tier: 'comfort', food_preferences: ['indian-food-matters', 'vegan'] },
    });
    expect(veganIndian).toBe(flipped);
  });

  it('tolerates the loose singular shapes the model sometimes emits', () => {
    const viaSingular = hashOf({
      family_profile: { budget_tier: 'comfort', food_preference: 'vegetarian' },
      trip_brief: BASE.trip_brief,
    });
    const viaFood = hashOf({
      family_profile: { budget_tier: 'comfort', food: 'vegetarian' },
      trip_brief: BASE.trip_brief,
    });
    expect(viaSingular).toBe(viaFood);
  });

  it('budget + trip type still fork the key (regression: pre-existing parts kept)', () => {
    const base = hashOf(BASE);
    expect(hashOf({ ...BASE, family_profile: { ...BASE.family_profile, budget_tier: 'luxury' } })).not.toBe(base);
    expect(hashOf({ ...BASE, trip_brief: { destination: 'Phuket', trip_type: 'city-activity' } })).not.toBe(base);
  });

  it('is stable for identical inputs', () => {
    expect(hashOf(BASE)).toBe(hashOf({ ...BASE }));
  });
});
