/* family_profiles persistence (Phase 4 · specs/04-auth-persistence.md Stage 4 + 5).
 * Through the cookie-based anon SSR client → RLS scopes every row to the signed-in user
 * (auth.uid() = user_id). Bridges the form's camelCase FamilyProfile
 * (components/profile/types.ts) ⇄ the snake_case public.family_profiles columns
 * (canonical: Notion 07 / migration 0001). One profile per user — upsert on user_id.
 *
 * NOT a `'use client'` module: it's isomorphic — every function takes an injectable client
 * and only calls createSupabaseBrowserClient() as a default arg. Client components import it
 * fine, and the SERVER (the conversation agent's update_profile tool) imports the same named
 * functions directly. Marking it `'use client'` turned those into non-callable client
 * reference proxies on the server ("loadFamilyProfile is not a function") — so the directive
 * is deliberately absent.
 *
 * The columns: name, hometown, family_members (jsonb: spouse + children), food_preferences
 * (text[]), budget_tier, brand_preferences (text[]), freestyle_notes. The form's collapsed
 * `food` enum + `indianFoodMatters` flag map into food_preferences; `spouse`/`children`
 * live in family_members jsonb (the data model keeps members structured, not columns). */
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

/** A blank profile — the base the agent's `update_profile` merges onto when the user has no
 * row yet (first-time onboarding), and the seed the chat page uses for a name-only starter.
 * Isomorphic (no client-only imports) so both the server tool and the client page can use it. */
export function emptyProfile(): FamilyProfile {
  return {
    name: '',
    hometown: null,
    spouse: false,
    children: [],
    food: 'none',
    indianFoodMatters: false,
    budgetTier: 'comfort',
    brandPreferences: [],
    notes: null,
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

/* ---------------------------------------------------------------------------
 * Agent-driven profile refinement (Phase 4-fix · agent profile persistence).
 *
 * When a signed-in user CONFIRMS a change/addition to an already-known profile while
 * chatting ("actually, make it luxury", "we're vegetarian now"), the conversation agent's
 * `update_profile` tool merges just those fields into the existing row. These two PURE
 * helpers are the merge + change-labelling core — no DB, fully unit-testable. The structured
 * profile stays durable so the agent never re-states a stale value next session.
 * ------------------------------------------------------------------------- */

/** The subset of profile fields the agent may patch when the user confirms a change.
 * Every field optional — the agent fills only what changed. `name` included so a user can
 * correct it, but the tool never invents one. */
export type ProfilePatch = Partial<
  Pick<
    FamilyProfile,
    | 'name'
    | 'hometown'
    | 'spouse'
    | 'children'
    | 'food'
    | 'indianFoodMatters'
    | 'budgetTier'
    | 'brandPreferences'
    | 'notes'
  >
>;

/** Human-readable label per patchable field — what the inline "profile updated" chip shows. */
const FIELD_LABELS: Record<keyof ProfilePatch, string> = {
  name: 'name',
  hometown: 'hometown',
  spouse: 'travelling party',
  children: 'children',
  food: 'food preference',
  indianFoodMatters: 'Indian food preference',
  budgetTier: 'budget',
  brandPreferences: 'hotel brands',
  notes: 'notes',
};

/** Merge a confirmed patch over an existing profile. Only keys actually present in the
 * patch (not `undefined`) override; everything else is carried through unchanged. Pure. */
export function mergeProfile(existing: FamilyProfile, patch: ProfilePatch): FamilyProfile {
  const merged: FamilyProfile = { ...existing };
  for (const k of Object.keys(patch) as (keyof ProfilePatch)[]) {
    const v = patch[k];
    if (v !== undefined) (merged as unknown as Record<string, unknown>)[k] = v;
  }
  return merged;
}

/** The human labels for fields the patch ACTUALLY changes (value differs from existing).
 * A patch that re-states the current value yields no label — so the chip only appears on a
 * real change. Deep-equal by JSON for the array/object fields (children, brands). */
export function changedFieldLabels(existing: FamilyProfile, patch: ProfilePatch): string[] {
  const labels: string[] = [];
  for (const k of Object.keys(patch) as (keyof ProfilePatch)[]) {
    const next = patch[k];
    if (next === undefined) continue;
    const prev = existing[k];
    const changed =
      typeof next === 'object' || typeof prev === 'object'
        ? JSON.stringify(next) !== JSON.stringify(prev)
        : next !== prev;
    if (changed) labels.push(FIELD_LABELS[k]);
  }
  return labels;
}
