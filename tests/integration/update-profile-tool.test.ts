/* The `update_profile` tool's execute logic (runUpdateProfile), driven with a MOCK client —
 * no real DB. Asserts the three branches: no existing profile → no-op; existing + real change →
 * merged save + correct labels; existing + no-change patch → no write. Runs in the integration
 * (node) project because the agent module imports the AI SDK (web-stream globals). */
import type { SupabaseClient } from '@supabase/supabase-js';

jest.mock('server-only', () => ({}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { runUpdateProfile } = require('@/lib/chat/agent') as typeof import('@/lib/chat/agent');

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
  it('no-ops when the user has no saved profile (onboarding owns the first save)', async () => {
    const { client, upserts } = mockClient(null);
    const res = await runUpdateProfile({ budgetTier: 'luxury' }, USER, client);
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
