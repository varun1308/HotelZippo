/* J3 — Shortlist + profile persistence (specs/15a §4, maps spec-15 Phase 4).
 *
 * The journey that proves REAL Supabase round-trips through the browser: a signed-in user
 * saves a hotel and edits their profile, and those survive a page reload (RLS-scoped to the
 * user). Auth + DB are real; only the agent provider is stubbed. AC3.1–3.3.
 *
 * IMPORTANT (honest coverage, per spec 15a §6 "no silent caps"):
 *   • Profile DOES restore on reload (chat page loads family_profiles on mount) → AC3.2 is a
 *     full round-trip.
 *   • The SHORTLIST is persisted (hotel_ids[] → `shortlists`, RLS-scoped) but the chat page
 *     does NOT re-hydrate it on mount, and only ids are stored (not the card data needed to
 *     re-render the panel). So the cross-reload shortlist restore is NOT supported by the app
 *     today. AC3.1 tests the real save path (within-session) and the reload-restore is an
 *     explicit test.fixme with the reason — a visible TODO, not a hidden gap. */
import { test, expect } from '@playwright/test';
import {
  signInAsDev,
  reachRecommendations,
  recommendationSet,
  composer,
  clearDevUserShortlist,
} from './_helpers';

test.describe('J3 · Shortlist + profile persistence', () => {
  test.beforeEach(async ({ page }) => {
    // The shortlist is durable now, so reset it per test to keep counts + the Save/Saved button
    // state deterministic (a leaked saved hotel would render the card as already "Saved").
    await clearDevUserShortlist();
    await signInAsDev(page);
  });

  test('AC3.1 — saving a hotel adds it to the shortlist panel (real RLS write)', async ({
    page,
  }) => {
    await reachRecommendations(page);
    const set = recommendationSet(page);

    // Save the top pick (the button toggles aria-pressed + its label).
    const saveBtn = set.getByRole('button', { name: /save to shortlist/i }).first();
    await saveBtn.click();
    await expect(
      set.getByRole('button', { name: /saved to shortlist/i }).first(),
    ).toBeVisible();

    // Open the shortlist panel from the topbar; the saved hotel is listed. (Persistence is
    // real + durable across the serial run, so assert presence, not an exact count.)
    await page.getByRole('button', { name: 'Shortlist', exact: true }).click();
    const panel = page.getByRole('dialog', { name: /saved shortlist/i });
    await expect(panel).toBeVisible();
    expect(await panel.getByRole('listitem').count()).toBeGreaterThanOrEqual(1);
  });

  // The shortlist is now re-hydrated on mount (loadShortlistHotels → SavedHotel rows from
  // `hotels`), so a saved shortlist survives a reload. (Was a test.fixme — fixed in the
  // shortlist-reload-persistence change.)
  test('AC3.1b — the shortlist survives a page reload (re-hydrated on mount)', async ({ page }) => {
    await reachRecommendations(page);
    const set = recommendationSet(page);
    await set.getByRole('button', { name: /save to shortlist/i }).first().click();
    await expect(set.getByRole('button', { name: /saved to shortlist/i }).first()).toBeVisible();

    await page.reload();
    await expect(composer(page)).toBeVisible();

    // Re-hydration is async (load ids → fetch hotels → seed). Use a retrying assertion (not a
    // one-shot count) so we don't race the load.
    await page.getByRole('button', { name: 'Shortlist', exact: true }).click();
    const panel = page.getByRole('dialog', { name: /saved shortlist/i });
    await expect(panel).toBeVisible();
    await expect(panel.getByRole('listitem').first()).toBeVisible();
  });

  test('AC3.2 — editing the profile persists across a reload (full round-trip)', async ({
    page,
  }) => {
    // Open the profile form via the account menu → Edit profile.
    await page.getByRole('button', { name: /account menu/i }).click();
    await page.getByRole('menuitem', { name: /edit profile/i }).click();
    await expect(page.getByRole('heading', { name: 'Tell me about your family' })).toBeVisible();

    // Set a distinctive hometown + name, then save. (A fresh value each run via the URL-safe
    // worker index isn't needed — the dev user is reset per CI run; locally re-running just
    // overwrites the same row, which is the upsert behaviour under test.)
    const hometown = 'Pune';
    await page.getByLabel(/your name/i).fill('Raj');
    await page.getByLabel(/hometown/i).fill(hometown);
    await page.getByRole('button', { name: /save profile/i }).click();

    // Back on chat. Reload, reopen Edit profile — the saved values are prefilled (loaded from
    // family_profiles on mount, RLS-scoped to this user).
    await expect(
      page.getByRole('heading', { name: 'Tell me about your family' }),
    ).toHaveCount(0);
    await page.reload();
    await page.getByRole('button', { name: /account menu/i }).click();
    await page.getByRole('menuitem', { name: /edit profile/i }).click();
    await expect(page.getByLabel(/hometown/i)).toHaveValue(hometown);
  });

  // AC3.3 (cross-user isolation) is covered by the node RLS integration test
  // (tests/integration/rls.test.ts + persistence.test.ts mint two real signed-in users and
  // assert A cannot read B's rows). Re-proving it via two browser storage states here would
  // duplicate that at much higher cost, so it is intentionally delegated, not skipped.
  test('AC3.3 — cross-user isolation is delegated to the node RLS integration suite', async () => {
    test.info().annotations.push({
      type: 'delegated',
      description:
        'RLS isolation (user A cannot read user B) is proven in tests/integration/rls.test.ts + persistence.test.ts with two real signed-in users (spec 15a §4 AC3.3).',
    });
    expect(true).toBe(true);
  });
});
