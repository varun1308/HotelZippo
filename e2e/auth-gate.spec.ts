/* J1 — Auth gate + landing (specs/15a §4, maps spec-15 Phase 4).
 *
 * Proves the middleware gate, the Google-only landing, responsive layout, the dev-login
 * round-trip (a real cookie session), and sign-out — all against the real server + real
 * local Supabase. AC1.1–1.5. */
import { test, expect } from '@playwright/test';
import { signInAsDev, composer, googleSignIn } from './_helpers';

test.describe('J1 · Auth gate + landing', () => {
  test('AC1.1 — unauthenticated /chat redirects to /', async ({ page }) => {
    await page.goto('/chat');
    await expect(page).toHaveURL(/\/$|\/\?/); // landed on the landing route (optionally ?error=)
    await expect(composer(page)).toHaveCount(0); // chat surface is NOT rendered
  });

  test('AC1.2 — landing shows the wordmark + Google sign-in, no production email field', async ({
    page,
  }) => {
    await page.goto('/');
    // Brand wordmark (split "Hotel" + "Zippo" in the nav + showcase).
    await expect(page.getByText('Zippo').first()).toBeVisible();
    // The authentic Google affordance is present (the prototype's "Sign up to try" copy).
    await expect(googleSignIn(page)).toBeVisible();
    // The production auth surface is Google-only: the prototype's "Continue with email"
    // button + "or" separator were dropped (spec 04 decision #1).
    await expect(page.getByRole('button', { name: /continue with email/i })).toHaveCount(0);
  });

  test('AC1.3 — landing is responsive at 390×844 (no horizontal overflow)', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await expect(googleSignIn(page)).toBeVisible();
    // No horizontal scrollbar: scrollWidth must not exceed the viewport width (allow 1px rounding).
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test('AC1.4 — dev-login lands on /chat with an active session', async ({ page }) => {
    await signInAsDev(page);
    await expect(page).toHaveURL(/\/chat$/);
    await expect(composer(page)).toBeVisible();
  });

  test('AC1.5 — sign-out returns to / and re-gates /chat', async ({ page }) => {
    await signInAsDev(page);
    // Open the account menu (its label embeds the display name) and sign out.
    await page.getByRole('button', { name: /account menu/i }).click();
    await page.getByRole('menuitem', { name: /sign out/i }).click();
    await page.waitForURL((url) => !url.pathname.startsWith('/chat'));
    // The gate is back: a fresh /chat visit redirects away.
    await page.goto('/chat');
    await expect(composer(page)).toHaveCount(0);
  });
});
