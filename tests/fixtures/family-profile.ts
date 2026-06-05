/* Standard test fixtures (spec 08b-4 action item: materialise a standard family
 * profile + trip brief in /tests/fixtures/). These back the SP-* structural tests
 * (Phase 3d) and are reusable by future E2E. Content is illustrative, not asserted
 * for prose — tests validate STRUCTURE/CONTRACT only (spec 15). Anchored to the
 * 12d reference scenario: Raj, Mumbai, vegetarian family, Phuket, December. */

export interface FixtureChild {
  name: string;
  age: number;
}

export interface FixtureFamilyProfile {
  name: string;
  hometown: string | null;
  spouse: boolean;
  children: FixtureChild[];
  food: 'vegetarian' | 'vegan' | 'none' | 'other';
  indian_food_matters: boolean;
  budget_tier: 'value' | 'comfort' | 'luxury';
  brand_preferences: string[];
  notes: string | null;
}

export interface FixtureTripBrief {
  destination: 'Phuket' | 'Hong Kong' | 'Singapore' | 'Maldives' | 'Bali';
  trip_type: 'resort-anchored' | 'city-activity' | 'multi-city';
  travel_dates: string | null;
  focus_areas: string[];
  pre_shortlisted_hotels: string[];
  evaluate_only: boolean;
}

/** The canonical "standard family" — used wherever a complete profile is needed. */
export const STANDARD_FAMILY_PROFILE: FixtureFamilyProfile = {
  name: 'Raj',
  hometown: 'Mumbai',
  spouse: true,
  children: [
    { name: 'Aanya', age: 2 },
    { name: 'Vir', age: 7 },
  ],
  food: 'vegetarian',
  indian_food_matters: true,
  budget_tier: 'comfort',
  brand_preferences: ['Marriott Bonvoy'],
  notes: 'Travelling with grandparents too — quieter rooms appreciated.',
};

/** The canonical trip brief — resort-anchored Phuket in December. */
export const STANDARD_TRIP_BRIEF: FixtureTripBrief = {
  destination: 'Phuket',
  trip_type: 'resort-anchored',
  travel_dates: 'Late December · ~2 weeks',
  focus_areas: ['kids club', 'pools', 'Indian food'],
  pre_shortlisted_hotels: [],
  evaluate_only: false,
};
