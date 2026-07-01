/* The `update_profile` tool's execute logic (runUpdateProfile), driven with a MOCK client —
 * no real DB. Asserts the branches: no existing profile → CREATE from a blank base (onboarding
 * capture); existing + real change → merged save + correct labels; existing + no-change patch →
 * no write. Runs in the integration (node) project because the agent module imports the AI SDK
 * (web-stream globals). */
import type { SupabaseClient } from '@supabase/supabase-js';

jest.mock('server-only', () => ({}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { runUpdateProfile, profilePatchFromAssembleInput, reconcileProfileFromAssembleInput } =
  require('@/lib/chat/agent') as typeof import('@/lib/chat/agent');

/** A minimal Supabase stub: .from('family_profiles').select().maybeSingle() returns the seeded
 * row (snake_case, as PostgREST would), and .upsert() records what was written. */
function mockClient(existingRow: Record<string, unknown> | null) {
  const upserts: Array<Record<string, unknown>> = [];
  const client = {
    from() {
      return {
        select() {
          return { maybeSingle: async () => ({ data: existingRow, error: null }) };
        },
        upsert(payload: Record<string, unknown>) {
          upserts.push(payload);
          return Promise.resolve({ error: null });
        },
      };
    },
  } as unknown as SupabaseClient;
  return { client, upserts };
}

const existing = {
  name: 'Raj',
  hometown: 'Mumbai',
  family_members: { spouse: true, children: [{ name: 'Aanya', age: 7 }] },
  food_preferences: [],
  budget_tier: 'comfort',
  brand_preferences: ['Marriott Bonvoy'],
  freestyle_notes: null,
};

const USER = '00000000-0000-0000-0000-0000000000aa';

describe('runUpdateProfile (update_profile tool execute)', () => {
  it('CREATES the profile from a blank base when the user has none yet (onboarding capture)', async () => {
    const { client, upserts } = mockClient(null);
    const res = await runUpdateProfile(
      { children: [{ name: 'Aanya', age: 7 }, { name: 'Vir', age: 2 }] },
      USER,
      client,
    );
    expect(res.updated).toEqual(['children']);
    expect(upserts).toHaveLength(1);
    expect(upserts[0]).toMatchObject({ user_id: USER });
    expect((upserts[0].family_members as { children: unknown[] }).children).toHaveLength(2);
  });

  it('still no-ops when a fresh user sends a patch equal to the blank defaults', async () => {
    // budget 'comfort' is the empty-profile default, so this changes nothing → no write.
    const { client, upserts } = mockClient(null);
    const res = await runUpdateProfile({ budgetTier: 'comfort' }, USER, client);
    expect(res).toEqual({ updated: [] });
    expect(upserts).toHaveLength(0);
  });

  it('merges + saves a real change and returns the human field labels', async () => {
    const { client, upserts } = mockClient(existing);
    const res = await runUpdateProfile({ budgetTier: 'luxury' }, USER, client);
    expect(res.updated).toEqual(['budget']);
    expect(upserts).toHaveLength(1);
    expect(upserts[0]).toMatchObject({ user_id: USER, budget_tier: 'luxury' });
    // Untouched fields carried through.
    expect(upserts[0].brand_preferences).toEqual(['Marriott Bonvoy']);
  });

  it('does NOT write when the patch matches current values (safe no-op)', async () => {
    const { client, upserts } = mockClient(existing);
    const res = await runUpdateProfile({ budgetTier: 'comfort' }, USER, client);
    expect(res).toEqual({ updated: [] });
    expect(upserts).toHaveLength(0);
  });

  it('maps the collapsed food enum into food_preferences on save', async () => {
    const { client, upserts } = mockClient(existing);
    const res = await runUpdateProfile({ food: 'vegetarian', indianFoodMatters: true }, USER, client);
    expect(res.updated).toEqual(
      expect.arrayContaining(['food preference', 'Indian food preference']),
    );
    expect(upserts[0].food_preferences).toEqual(
      expect.arrayContaining(['vegetarian', 'indian-food-matters']),
    );
  });
});

// The deterministic safety net for when the model runs a search having gathered profile facts but
// never calling update_profile (Haiku sometimes narrates instead of emitting the tool call).
describe('profilePatchFromAssembleInput (loose family_profile → ProfilePatch)', () => {
  it('reads snake_case model keys (food_preference, budget_tier) + structured children', () => {
    const patch = profilePatchFromAssembleInput({
      food_preference: 'vegetarian',
      budget_tier: 'comfort',
      children: [{ name: 'Aanya', age: 7 }, { name: 'Vir', age: 2 }],
    });
    expect(patch.food).toBe('vegetarian');
    expect(patch.budgetTier).toBe('comfort');
    expect(patch.children).toHaveLength(2);
  });

  it('tolerates camelCase + the `kids` alias + numeric-string ages', () => {
    const patch = profilePatchFromAssembleInput({
      budgetTier: 'luxury',
      kids: [{ name: 'Vir', age: '2' }],
    });
    expect(patch.budgetTier).toBe('luxury');
    expect(patch.children).toEqual([{ name: 'Vir', age: 2 }]);
  });

  it('DROPS unrecognised / out-of-range values instead of guessing', () => {
    const patch = profilePatchFromAssembleInput({
      budget_tier: 'platinum', // not a valid tier
      food_preference: 'pescatarian', // not a valid enum
      children: [{ name: 'X', age: 40 }], // out of 0–17 range
    });
    expect(patch).toEqual({});
  });

  it('empty / null input → empty patch', () => {
    expect(profilePatchFromAssembleInput(null)).toEqual({});
    expect(profilePatchFromAssembleInput({})).toEqual({});
  });
});

describe('reconcileProfileFromAssembleInput (safety-net persist)', () => {
  it('CREATES the row with the gathered kids when the model skipped update_profile', async () => {
    const { client, upserts } = mockClient(null);
    await reconcileProfileFromAssembleInput(
      { children: [{ name: 'Aanya', age: 7 }, { name: 'Vir', age: 2 }] },
      USER,
      client,
    );
    expect(upserts).toHaveLength(1);
    expect((upserts[0].family_members as { children: unknown[] }).children).toHaveLength(2);
  });

  it('writes nothing when the search input carries no interpretable profile facts', async () => {
    const { client, upserts } = mockClient(null);
    await reconcileProfileFromAssembleInput({ destination: 'Phuket' }, USER, client);
    expect(upserts).toHaveLength(0);
  });

  it('never throws — a persistence failure is swallowed', async () => {
    const throwing = {
      from() {
        throw new Error('db down');
      },
    } as unknown as import('@supabase/supabase-js').SupabaseClient;
    await expect(
      reconcileProfileFromAssembleInput({ children: [{ name: 'A', age: 7 }] }, USER, throwing),
    ).resolves.toBeUndefined();
  });
});
