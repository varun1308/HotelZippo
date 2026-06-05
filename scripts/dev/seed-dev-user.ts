/* Seed a LOCAL dev user for email/password sign-in (LOCAL DEVELOPMENT ONLY).
 *
 *   npm run dev:user                          # dev@hotelzippo.local / dev-password-123! / "Raj"
 *   npm run dev:user -- me@x.test secret Asha  # custom email + password + display name
 *
 * Production auth is Google-only; this exists so you can reach the hard-gated /chat locally
 * without Google OAuth. It uses the service role to create a CONFIRMED auth user against
 * local Supabase; the on_auth_user_created trigger (migration 0006) makes the public.users
 * row, exactly as a real first sign-in would. Idempotent — re-running is a no-op if the user
 * already exists. Pair it with NEXT_PUBLIC_ENABLE_DEV_LOGIN=true (+ the dev sign-in button).
 *
 * Run with: npm run dev:user  (tsx loads .env.local for the local Supabase service key). */
import { createClient } from '@supabase/supabase-js';

const DEFAULT_EMAIL = 'dev@hotelzippo.local';
const DEFAULT_PASSWORD = 'dev-password-123!';

const DEFAULT_NAME = 'Raj';

async function main() {
  const email = process.argv[2] ?? DEFAULT_EMAIL;
  const password = process.argv[3] ?? DEFAULT_PASSWORD;
  const fullName = process.argv[4] ?? DEFAULT_NAME;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (start local Supabase; see specs/13).');
  }
  // Guard: this is a local-dev tool. Refuse to run against anything that looks remote.
  if (!/127\.0\.0\.1|localhost/.test(url)) {
    throw new Error(`Refusing to seed a dev user against a non-local Supabase URL (${url}). This script is local-only.`);
  }

  const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

  // Set user_metadata.full_name so it mirrors a real Google sign-in (where the display name
  // lives in user_metadata) — the chat page reads this via useUser and hands it to the agent.
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });
  if (error) {
    if (/already.*registered|already.*exists|duplicate/i.test(error.message)) {
      // eslint-disable-next-line no-console
      console.log(`[dev:user] ${email} already exists — ready to sign in.`);
      return;
    }
    throw error;
  }

  // eslint-disable-next-line no-console
  console.log(`[dev:user] created ${email} (id ${data.user?.id}).`);
  // eslint-disable-next-line no-console
  console.log(`[dev:user] password: ${password}`);
  // eslint-disable-next-line no-console
  console.log('[dev:user] Set NEXT_PUBLIC_ENABLE_DEV_LOGIN=true in .env.local, then use the "Dev sign-in" button on /.');
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error('[dev:user] failed:', e instanceof Error ? e.message : e);
  process.exit(1);
});
