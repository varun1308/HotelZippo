/* J4 — Booking room-picker, stubbed (specs/15a §4, maps spec-15 Phase 7).
 *
 * The booking UI flow end-to-end with RouteStack STUBBED (admin-blocked anyway, and a real
 * booking must never run): Proceed-to-book → confirm turn → rooms/rates → select → deep-link
 * payment URL (new tab) — plus the warm fallback on a business failure. Auth + DB are real;
 * the /api/booking/* provider is swapped via NEXT_PUBLIC_E2E. AC4.1–4.4.
 *
 * The recommendation cards now carry real seeded hotelIds (Slice 3), so Proceed-to-book is
 * live; the rates/payment-url responses come from lib/booking/e2e-stub.ts. */
import { test, expect, type Page } from '@playwright/test';
import { signInAsDev, reachRecommendations, recommendationSet } from './_helpers';

/** Open the room-picker from the top pick and reach the confirm screen. */
async function openBooking(page: Page) {
  await reachRecommendations(page);
  await recommendationSet(page)
    .getByRole('button', { name: /proceed to book/i })
    .first()
    .click();
  return page.getByRole('dialog', { name: /^book /i });
}

/** Fill the confirm screen's dates (the E2E brief carries none) + continue. */
async function confirmAndContinue(modal: ReturnType<Page['getByRole']>) {
  await modal.getByLabel('Check-in date').fill('2026-12-10');
  await modal.getByLabel('Check-out date').fill('2026-12-13');
  await modal.getByRole('button', { name: /continue/i }).click();
}

test.describe('J4 · Booking room-picker (stubbed)', () => {
  test.beforeEach(async ({ page }) => {
    await signInAsDev(page);
  });

  test('AC4.1 — Proceed-to-book opens the confirm screen (travellers + rooms + dates)', async ({
    page,
  }) => {
    const modal = await openBooking(page);
    await expect(modal).toBeVisible();
    await expect(modal.getByText(/confirm the details/i)).toBeVisible();
    // The combined confirm turn collects travellers, rooms AND dates in one screen.
    await expect(modal.getByText('Travellers')).toBeVisible();
    await expect(modal.getByText('Rooms').first()).toBeVisible();
    await expect(modal.getByLabel('Check-in date')).toBeVisible();
  });

  test('AC4.2 — confirming lists rooms/rates; present fields show, absent ones omit gracefully', async ({
    page,
  }) => {
    const modal = await openBooking(page);
    await confirmAndContinue(modal);

    const options = modal.getByTestId('room-option');
    await expect(options).toHaveCount(2);
    // Option 1 is fully described — its fields render.
    const first = options.first();
    await expect(first.getByText('Deluxe Pool Access')).toBeVisible();
    await expect(first.getByText(/USD|482/)).toBeVisible();
    await expect(first.getByText(/free cancellation/i)).toBeVisible();
    // Option 2 is sparse (only a name) — it still renders as a selectable row, not broken.
    const second = options.nth(1);
    await expect(second.getByText('Garden Twin')).toBeVisible();
    await expect(second).toBeEnabled();
  });

  test('AC4.3 — selecting a room produces the deep-link URL in a NEW TAB (after the pick)', async ({
    page,
  }) => {
    // Record window.open calls (the handoff target + that it's a new tab) without navigating
    // off-site to a non-routable demo host. This IS the behaviour under test: the deep link is
    // handed to a new tab, and ONLY after an explicit room choice.
    await page.addInitScript(() => {
      (window as unknown as { __opened: Array<[string, string]> }).__opened = [];
      const orig = window.open;
      window.open = ((url?: string | URL, target?: string) => {
        (window as unknown as { __opened: Array<[string, string]> }).__opened.push([
          String(url ?? ''),
          String(target ?? ''),
        ]);
        return null as unknown as ReturnType<typeof orig>;
      }) as typeof window.open;
    });
    // The init script only applies to documents loaded AFTER it's registered; beforeEach
    // already navigated to /chat, so reload to install the window.open shim on this page.
    await page.reload();
    await expect(page.getByRole('textbox', { name: 'Message your concierge' })).toBeVisible();

    const modal = await openBooking(page);
    await confirmAndContinue(modal);
    await expect(modal.getByTestId('room-option').first()).toBeVisible();

    // No URL has been opened yet — it must come only AFTER the pick.
    expect(await page.evaluate(() => (window as unknown as { __opened: unknown[] }).__opened.length)).toBe(0);

    await modal.getByTestId('room-option').first().click();

    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __opened: unknown[] }).__opened.length))
      .toBeGreaterThan(0);
    const opened = await page.evaluate(
      () => (window as unknown as { __opened: Array<[string, string]> }).__opened[0],
    );
    expect(opened[0]).toContain('example.test/checkout'); // the stubbed deep link
    expect(opened[1]).toBe('_blank'); // a new tab
  });

  test('AC4.4 — a business failure surfaces a warm fallback, not a dead-end', async ({ page }) => {
    // Force a no-availability outcome at the rates route (deterministic, provider-level).
    await page.route('**/api/booking/rates', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          error: 'no-availability',
          message: 'No rooms are available for those dates. Want me to try different dates?',
        }),
      }),
    );

    const modal = await openBooking(page);
    await confirmAndContinue(modal);

    // The modal shows the warm message + a recovery action (Try again) — never a raw error.
    await expect(modal.getByText(/no rooms are available/i)).toBeVisible();
    await expect(modal.getByRole('button', { name: /try again|retry/i })).toBeVisible();
  });
});
