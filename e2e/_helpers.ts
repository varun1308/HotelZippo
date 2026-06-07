/* Shared E2E helpers (specs/15a-e2e-test-strategy.md).
 *
 * Centralises the dev-login flow + the seeded dev-user creds so every spec authenticates
 * the same deterministic way. Auth is REAL (a Supabase cookie session via dev-login); only
 * the agent + booking PROVIDERS are stubbed (NEXT_PUBLIC_E2E). */
import { expect, type Page } from '@playwright/test';

/** The seeded dev user (scripts/dev/seed-dev-user.ts defaults; created by `npm run e2e:user`). */
export const DEV_USER = {
  email: 'dev@hotelzippo.local',
  password: 'dev-password-123!',
  name: 'Raj',
} as const;

// Local Supabase URL + the PUBLIC well-known service-role demo key (localhost-only; the same
// value in .env.e2e). Used only to reset per-test DB state — never a real secret.
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

/** Reset the dev user's working shortlist so each persistence test starts clean (the shortlist
 * is now durable, so prior runs would otherwise leak saved hotels into the next test). Deletes
 * via the service role over REST — localhost demo key only. Best-effort. */
export async function clearDevUserShortlist(): Promise<void> {
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/shortlists?hotel_ids=not.is.null`, {
      method: 'DELETE',
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, Prefer: 'return=minimal' },
    });
  } catch {
    /* best-effort */
  }
}

/** Sign in via the landing-page Dev sign-in form (flag-gated; present under NEXT_PUBLIC_ENABLE_DEV_LOGIN).
 * Lands on /chat with a real cookie session, then waits for the composer to confirm arrival. */
export async function signInAsDev(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByLabel('Dev email').fill(DEV_USER.email);
  await page.getByLabel('Dev password').fill(DEV_USER.password);
  await page.getByRole('button', { name: 'Dev sign-in' }).click();
  await page.waitForURL('**/chat');
  await expect(composer(page)).toBeVisible();
}

/** The message composer textarea — the stable "chat is loaded" anchor. */
export function composer(page: Page) {
  return page.getByRole('textbox', { name: 'Message your concierge' });
}

/** The authentic Google sign-in button on the landing page. Its visible copy is the
 * prototype's "Sign up to try — it's free" (GoogleSignInButton default label); matched
 * loosely so a copy tweak doesn't break the gate-presence assertion. There are two on the
 * page (hero + nav can both trigger Google) — `.first()` anchors the primary hero CTA. */
export function googleSignIn(page: Page) {
  return page.getByRole('button', { name: /sign up to try/i }).first();
}

/** Send one user message through the composer (Enter sends). Waits for the composer to be
 * re-enabled afterwards (it's disabled while the assistant streams) so sequential sends are
 * safe — the stubbed stream settles near-instantly. */
export async function sendMessage(page: Page, text: string): Promise<void> {
  const box = composer(page);
  await box.click();
  await box.fill(text);
  await box.press('Enter');
  await expect(box).toBeEnabled();
}

/** The recommendation set rendered inline in the conversation (J2+). */
export function recommendationSet(page: Page) {
  return page.getByTestId('recommendation-set');
}

/** Drive the conversation until a recommendation-set renders inline, then return it.
 * The deterministic stub clamps to its final (recommendation) turn after enough user
 * turns, so a bounded loop of sends always reaches cards. */
export async function reachRecommendations(page: Page) {
  const set = recommendationSet(page);
  for (let i = 0; i < 8; i += 1) {
    if (await set.count()) break;
    await sendMessage(page, i === 0 ? 'Phuket, beach resort in December' : 'go on');
  }
  await expect(set).toBeVisible();
  return set;
}
