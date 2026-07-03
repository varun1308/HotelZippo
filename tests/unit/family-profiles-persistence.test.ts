/* family_profiles persistence — row mapping + DB-facing branches (specs/04 Stage 4+5).
 *
 * The pure merge helpers are covered by family-profile-merge.test.ts; this suite targets
 * the remaining RED branches: the camelCase ⇄ snake_case bridge (toRow/fromRow — every
 * food-enum branch and every null/absent-column default), emptyProfile, and the two DB
 * functions via an INJECTED fake Supabase client (house pattern: the module is isomorphic
 * and takes the client as an argument — no env, no network). Assertions are observable:
 * returned profiles, thrown errors, and the exact upsert/select call args. */
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  toRow,
  fromRow,
  emptyProfile,
  loadFamilyProfile,
  saveFamilyProfile,
} from '@/lib/db/persistence/family-profiles';
import type { FamilyProfile } from '@/components/profile';

const base: FamilyProfile = {
  name: 'Raj',
  hometown: 'Mumbai',
  spouse: true,
  children: [{ name: 'Aanya', age: 7 }],
  food: 'vegetarian',
  indianFoodMatters: true,
  budgetTier: 'comfort',
  brandPreferences: ['Marriott Bonvoy'],
  notes: 'grandparents sometimes join',
};

/* ---- toRow ---------------------------------------------------------------- */

describe('toRow (camelCase profile → snake_case columns)', () => {
  it('maps every column, folding food + indianFoodMatters into food_preferences', () => {
    expect(toRow(base, 'user-1')).toEqual({
      user_id: 'user-1',
      name: 'Raj',
      hometown: 'Mumbai',
      family_members: { spouse: true, children: [{ name: 'Aanya', age: 7 }] },
      food_preferences: ['vegetarian', 'indian-food-matters'],
      budget_tier: 'comfort',
      brand_preferences: ['Marriott Bonvoy'],
      freestyle_notes: 'grandparents sometimes join',
    });
  });

  it.each([
    ['vegan', ['vegan']],
    ['vegetarian', ['vegetarian']],
    ['other', ['other']],
    ['none', []],
  ] as const)('food=%s → food_preferences %j (indianFoodMatters off)', (food, expected) => {
    const row = toRow({ ...base, food, indianFoodMatters: false }, 'u');
    expect(row.food_preferences).toEqual(expected);
  });

  it('none + indianFoodMatters keeps ONLY the indian-food flag', () => {
    const row = toRow({ ...base, food: 'none', indianFoodMatters: true }, 'u');
    expect(row.food_preferences).toEqual(['indian-food-matters']);
  });
});

/* ---- fromRow -------------------------------------------------------------- */

describe('fromRow (row → camelCase profile)', () => {
  it('round-trips a full profile through toRow → fromRow unchanged', () => {
    expect(fromRow(toRow(base, 'user-1'))).toEqual(base);
  });

  it('defaults every absent/null column safely (never undefined leaking into the form)', () => {
    expect(fromRow({})).toEqual({
      name: '',
      hometown: null,
      spouse: false,
      children: [],
      food: 'none',
      indianFoodMatters: false,
      budgetTier: 'comfort',
      brandPreferences: [],
      notes: null,
    });
  });

  it('resolves the food enum by precedence: vegan > vegetarian > other', () => {
    expect(fromRow({ food_preferences: ['vegetarian', 'vegan'] }).food).toBe('vegan');
    expect(fromRow({ food_preferences: ['other', 'vegetarian'] }).food).toBe('vegetarian');
    expect(fromRow({ food_preferences: ['other'] }).food).toBe('other');
    expect(fromRow({ food_preferences: [] }).food).toBe('none');
  });

  it('reads indianFoodMatters independently of the diet enum', () => {
    const p = fromRow({ food_preferences: ['indian-food-matters'] });
    expect(p.food).toBe('none');
    expect(p.indianFoodMatters).toBe(true);
  });

  it('tolerates partial family_members jsonb (spouse without children and vice versa)', () => {
    expect(fromRow({ family_members: { spouse: true } })).toMatchObject({
      spouse: true,
      children: [],
    });
    expect(fromRow({ family_members: { children: [{ name: 'V', age: 2 }] } })).toMatchObject({
      spouse: false,
      children: [{ name: 'V', age: 2 }],
    });
  });
});

/* ---- emptyProfile ---------------------------------------------------------- */

describe('emptyProfile', () => {
  it('is the documented blank base and a FRESH object each call (safe to mutate)', () => {
    expect(emptyProfile()).toEqual({
      name: '',
      hometown: null,
      spouse: false,
      children: [],
      food: 'none',
      indianFoodMatters: false,
      budgetTier: 'comfort',
      brandPreferences: [],
      notes: null,
    });
    expect(emptyProfile()).not.toBe(emptyProfile());
  });
});

/* ---- loadFamilyProfile / saveFamilyProfile (injected client) ---------------- */

function fakeSelectClient(result: { data: unknown; error: unknown }) {
  const maybeSingle = jest.fn(async () => result);
  const select = jest.fn(() => ({ maybeSingle }));
  const from = jest.fn(() => ({ select }));
  return { client: { from } as unknown as SupabaseClient, from, select, maybeSingle };
}

function fakeUpsertClient(result: { error: unknown }) {
  const upsert = jest.fn(async () => result);
  const from = jest.fn(() => ({ upsert }));
  return { client: { from } as unknown as SupabaseClient, from, upsert };
}

describe('loadFamilyProfile', () => {
  it('maps a saved row into the camelCase profile, reading family_profiles', async () => {
    const { client, from, select } = fakeSelectClient({
      data: toRow(base, 'user-1'),
      error: null,
    });
    await expect(loadFamilyProfile(client)).resolves.toEqual(base);
    expect(from).toHaveBeenCalledWith('family_profiles');
    expect(select).toHaveBeenCalledWith('*');
  });

  it('returns null when the user has no row yet (not an empty profile)', async () => {
    const { client } = fakeSelectClient({ data: null, error: null });
    await expect(loadFamilyProfile(client)).resolves.toBeNull();
  });

  it('throws the Supabase error through (callers own the fallback)', async () => {
    const dbError = Object.assign(new Error('permission denied'), { code: '42501' });
    const { client } = fakeSelectClient({ data: null, error: dbError });
    await expect(loadFamilyProfile(client)).rejects.toBe(dbError);
  });
});

describe('saveFamilyProfile', () => {
  it('upserts the mapped row keyed on user_id (one profile per user)', async () => {
    const { client, from, upsert } = fakeUpsertClient({ error: null });
    await expect(saveFamilyProfile(base, 'user-1', client)).resolves.toBeUndefined();
    expect(from).toHaveBeenCalledWith('family_profiles');
    expect(upsert).toHaveBeenCalledWith(toRow(base, 'user-1'), { onConflict: 'user_id' });
  });

  it('throws the Supabase error through (RLS WITH CHECK rejection surfaces)', async () => {
    const dbError = Object.assign(new Error('new row violates row-level security'), {
      code: '42501',
    });
    const { client } = fakeUpsertClient({ error: dbError });
    await expect(saveFamilyProfile(base, 'user-1', client)).rejects.toBe(dbError);
  });
});
