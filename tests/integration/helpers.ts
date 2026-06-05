/* Integration-test helpers against the local Supabase stack. */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export function serviceClient(): SupabaseClient {
  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export interface TestUser {
  id: string;
  email: string;
  /** Anon-key client authenticated AS this user — RLS is enforced for it. */
  client: SupabaseClient;
}

/** Create a confirmed auth user, its public.users row, and an authenticated client.
 * Uses the service role to provision, then signs in with a real session so that
 * auth.uid() is populated and RLS policies actually apply. */
export async function createTestUser(label: string): Promise<TestUser> {
  const admin = serviceClient();
  const email = `${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`;
  const password = 'test-password-123!';

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (createErr || !created.user) throw createErr ?? new Error('createUser failed');
  const id = created.user.id;

  // The public.users row is created by the on_auth_user_created trigger (migration 0006),
  // exactly as it will be on a real first sign-in — no manual insert needed here.

  const client = createClient(url, anonKey);
  const { error: signInErr } = await client.auth.signInWithPassword({ email, password });
  if (signInErr) throw signInErr;

  return { id, email, client };
}

/** Best-effort cleanup of an auth user (cascades to public rows via FKs). */
export async function deleteTestUser(id: string): Promise<void> {
  const admin = serviceClient();
  await admin.auth.admin.deleteUser(id).catch(() => {});
}
