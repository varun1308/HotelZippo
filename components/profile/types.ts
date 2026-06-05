/* Structured output of the FamilyProfileForm (Phase 3d).
 *
 * This is the form's PUBLIC contract — the shape handed to `onSubmit`. It mirrors
 * the fixture in tests/fixtures/family-profile.ts (camelCase field names here vs.
 * the snake_case persistence shape; the server adapter bridges the two).
 *
 * The UI exposes three independent food TOGGLES (vegetarian / vegan / Indian-food-
 * matters), but `food` collapses them into one enum on submit:
 *   vegan ON            → 'vegan'
 *   else vegetarian ON  → 'vegetarian'
 *   else                → 'none'
 * `indianFoodMatters` stays its own boolean.
 */

export interface Child {
  name: string;
  age: number;
}

export interface FamilyProfile {
  /** Required. Never empty/whitespace once submitted. */
  name: string;
  hometown: string | null;
  spouse: boolean;
  children: Child[];
  food: 'vegetarian' | 'vegan' | 'none';
  indianFoodMatters: boolean;
  /** Required, but always pre-selected to 'comfort' so the form is always valid. */
  budgetTier: 'value' | 'comfort' | 'luxury';
  /** Loyalty programmes; excludes the "No preference" sentinel. */
  brandPreferences: string[];
  notes: string | null;
}
