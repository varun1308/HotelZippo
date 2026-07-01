/* Agent profile persistence — end-to-end against local Supabase, AS a real signed-in user so
 * the write goes through RLS (auth.uid() = user_id) exactly as in the browser. Asserts the
 * `update_profile` tool path: a first confirmed fact CREATES the row (onboarding capture), a
 * confirmed change to an existing profile updates it, and a no-change patch writes nothing.
 * Cross-user isolation is already proven by rls.test.ts (WITH CHECK on family_profiles); here
 * we focus on the tool semantics. */
import { createTestUser, deleteTestUser, serviceClient, type TestUser } from './helpers';
import { saveFamilyProfile } from '@/lib/db/persistence/family-profiles';
import type { FamilyProfile } from '@/components/profile';

jest.mock('server-only', () => ({}));
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { runUpdateProfile } = require('@/lib/chat/agent') as typeof import('@/lib/chat/agent');

jest.setTimeout(30_000);

let user: TestUser;
beforeAll(async () => {
  user = await createTestUser('updprofile');
});
afterAll(async () => {
  if (user) await deleteTestUser(user.id);
});

const seeded: FamilyProfile = {
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

describe('update_profile against a real RLS client', () => {
  it('CREATES the row from the first confirmed fact when the user has no profile yet', async () => {
    const res = await runUpdateProfile(
      { children: [{ name: 'Aanya', age: 7 }, { name: 'Vir', age: 2 }] },
      user.id,
      user.client,
    );
    expect(res.updated).toEqual(['children']);
    const { data } = await serviceClient()
      .from('family_profiles')
      .select('family_members')
      .eq('user_id', user.id)
      .single();
    expect((data?.family_members as { children: unknown[] }).children).toHaveLength(2);
  });

  it('persists a confirmed change to an existing profile (budget → luxury)', async () => {
    await saveFamilyProfile(seeded, user.id, user.client);

    const res = await runUpdateProfile({ budgetTier: 'luxury' }, user.id, user.client);
    expect(res.updated).toEqual(['budget']);

    const { data } = await serviceClient()
      .from('family_profiles')
      .select('budget_tier')
      .eq('user_id', user.id)
      .single();
    expect(data?.budget_tier).toBe('luxury');
  });

  it('still exactly one row after the update (upsert, not insert)', async () => {
    const { data } = await serviceClient()
      .from('family_profiles')
      .select('id')
      .eq('user_id', user.id);
    expect(data ?? []).toHaveLength(1);
  });

  it('writes nothing for a patch that matches current values', async () => {
    const res = await runUpdateProfile({ budgetTier: 'luxury' }, user.id, user.client);
    expect(res).toEqual({ updated: [] });
  });
});
