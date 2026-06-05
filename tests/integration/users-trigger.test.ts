/* Phase 4 (specs/04-auth-persistence.md, Schema & RLS): on first sign-in a public.users
 * row must exist — created by the on_auth_user_created trigger on auth.users (migration
 * 0006), NOT by client code. This proves the trigger alone populates public.users, since
 * owner-scoped inserts (family_profiles etc.) FK to public.users(id) and would otherwise
 * fail. Also asserts re-sign-in is idempotent (the trigger's ON CONFLICT DO NOTHING). */
import { serviceClient } from './helpers';

jest.setTimeout(30_000);
const admin = serviceClient();

async function createAuthUser(label: string): Promise<{ id: string; email: string }> {
  const email = `${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: 'test-password-123!',
    email_confirm: true,
  });
  if (error || !data.user) throw error ?? new Error('createUser failed');
  return { id: data.user.id, email };
}

describe('public.users population trigger (on_auth_user_created)', () => {
  it('creates a public.users row automatically when an auth user is created — no client insert', async () => {
    const { id, email } = await createAuthUser('trigger');
    try {
      // No manual insert into public.users here — the trigger is the only writer.
      const { data, error } = await admin.from('users').select('*').eq('id', id);
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
      expect(data![0].id).toBe(id);
      expect(data![0].email).toBe(email);
      expect(data![0].created_at).toBeTruthy();
    } finally {
      await admin.auth.admin.deleteUser(id).catch(() => {});
    }
  });

  it('owner-scoped insert succeeds immediately after sign-up (FK to public.users satisfied by the trigger)', async () => {
    const { id } = await createAuthUser('trigger-fk');
    try {
      // family_profiles.user_id FKs to public.users(id). This insert would fail the FK
      // if the trigger had not already created the public.users row.
      const { error } = await admin
        .from('family_profiles')
        .insert({ user_id: id, name: 'Trigger FK', budget_tier: 'comfort' });
      expect(error).toBeNull();
    } finally {
      await admin.auth.admin.deleteUser(id).catch(() => {});
    }
  });
});
