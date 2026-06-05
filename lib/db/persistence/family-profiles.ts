/* family_profiles persistence (Phase 4 · specs/04-auth-persistence.md Stage 4 + 5).
 * Client-side, through the cookie-based anon SSR client → RLS scopes every row to the
 * signed-in user (auth.uid() = user_id). Bridges the form's camelCase FamilyProfile
 * (components/profile/types.ts) ⇄ the snake_case public.family_profiles columns
 * (canonical: Notion 07 / migration 0001). One profile per user — upsert on user_id.
 *
 * The columns: name, hometown, family_members (jsonb: spouse + children), food_preferences
 * (text[]), budget_tier, brand_preferences (text[]), freestyle_notes. The form's collapsed
 * `food` enum + `indianFoodMatters` flag map into food_preferences; `spouse`/`children`
 * live in family_members jsonb (the data model keeps members structured, not columns). */
'use client';

import type { SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseBrowserClient } from '@/lib/db/ssr';
import type { Child, FamilyProfile } from '@/components/profile';

/** Shape stored in family_members jsonb. */
interface FamilyMembers {
  spouse: boolean;
  children: Child[];
}

/** Map the form's camelCase profile → the row columns (insert/update payload). */
export function toRow(profile: FamilyProfile, userId: string): Record<string, unknown> {
  const food_preferences: string[] = [];
  if (profile.food === 'vegan') food_preferences.push('vegan');
  else if (profile.food === 'vegetarian') food_preferences.push('vegetarian');
  if (profile.indianFoodMatters) food_preferences.push('indian-food-matters');

  const family_members: FamilyMembers = { spouse: profile.spouse, children: profile.children };

  return {
    user_id: userId,
    name: profile.name,
    hometown: profile.hometown,
    family_members,
    food_preferences,
    budget_tier: profile.budgetTier,
    brand_preferences: profile.brandPreferences,
    freestyle_notes: profile.notes,
  };
}

/** Map a stored row → the form's camelCase profile (for Edit-profile prefill). */
export function fromRow(row: Record<string, unknown>): FamilyProfile {
  const members = (row.family_members ?? {}) as Partial<FamilyMembers>;
  const food = (row.food_preferences ?? []) as string[];
  return {
    name: (row.name as string) ?? '',
    hometown: (row.hometown as string | null) ?? null,
    spouse: members.spouse ?? false,
    children: members.children ?? [],
    food: food.includes('vegan') ? 'vegan' : food.includes('vegetarian') ? 'vegetarian' : 'none',
    indianFoodMatters: food.includes('indian-food-matters'),
    budgetTier: (row.budget_tier as FamilyProfile['budgetTier']) ?? 'comfort',
    brandPreferences: (row.brand_preferences as string[]) ?? [],
    notes: (row.freestyle_notes as string | null) ?? null,
  };
}

/** Load the signed-in user's profile, or null if none saved yet. RLS restricts to own. */
export async function loadFamilyProfile(
  client: SupabaseClient = createSupabaseBrowserClient(),
): Promise<FamilyProfile | null> {
  const { data, error } = await client.from('family_profiles').select('*').maybeSingle();
  if (error) throw error;
  return data ? fromRow(data) : null;
}

/** Upsert one profile per user (onboarding / edit-profile). user_id comes from the
 * authenticated session — RLS WITH CHECK rejects any attempt to write another user's row. */
export async function saveFamilyProfile(
  profile: FamilyProfile,
  userId: string,
  client: SupabaseClient = createSupabaseBrowserClient(),
): Promise<void> {
  const { error } = await client
    .from('family_profiles')
    .upsert(toRow(profile, userId), { onConflict: 'user_id' });
  if (error) throw error;
}
