/* J2 — Onboarding → recommendations (specs/15a §4, maps spec-15 Phase 3).
 *
 * The headline journey: a signed-in user converses, the trip-brief gates enable
 * "Find hotels", and a recommendation set renders INLINE in the conversation with a
 * distinguished top pick + a prominent hard flag. The agent is stubbed (deterministic),
 * so these assertions are about STRUCTURE + BEHAVIOUR, never live-LLM content. AC2.1–2.5. */
import { test, expect } from '@playwright/test';
import { signInAsDev, sendMessage, recommendationSet, reachRecommendations } from './_helpers';

test.describe('J2 · Onboarding → recommendations', () => {
  test.beforeEach(async ({ page }) => {
    await signInAsDev(page);
  });

  test('AC2.1 — a sent message yields a streamed assistant reply', async ({ page }) => {
    await sendMessage(page, 'Hi, I need help planning a family trip.');
    const assistant = page.getByTestId('assistant-message').last();
    await expect(assistant).toBeVisible();
    await expect(assistant).not.toHaveText('');
  });

  test('AC2.2 — filling the brief hard gates enables "Find hotels"', async ({ page }) => {
    const findHotels = page.getByRole('button', { name: /find hotels/i });
    // Disabled before all four hard gates (destination + trip type + dates + who) are known.
    await expect(findHotels).toBeDisabled();
    // Destination + trip type alone is NOT enough anymore — the deterministic detector fills
    // only two of the four gates, so the button stays disabled.
    await sendMessage(page, 'We want Phuket — a beach resort.');
    await expect(findHotels).toBeDisabled();
    // Adding WHEN (dates) and WHO (travelling party) fills the remaining two gates → enabled.
    await sendMessage(page, 'Travelling in December with my wife and two kids.');
    await expect(findHotels).toBeEnabled();
  });

  test('AC2.3 — a recommendation set renders inline with one distinguished top pick', async ({
    page,
  }) => {
    await reachRecommendations(page);
    const set = recommendationSet(page);
    // Exactly one top pick, distinguished by the "Top Pick" badge ON the top-pick card.
    const topPick = set.getByTestId('top-pick-card');
    await expect(topPick).toHaveCount(1);
    await expect(topPick.getByText('Top Pick', { exact: false })).toBeVisible();
    // Alternatives render as their own (visually lighter) cards, with NO "Top Pick" badge.
    await expect(set.getByTestId('alt-card').first()).toBeVisible();
    const alts = await set.getByTestId('alt-card').count();
    expect(alts).toBeGreaterThanOrEqual(1);
    expect(alts).toBeLessThanOrEqual(2); // spec 08b-2: 1–2 alternatives
  });

  test('AC2.4 — a hard flag renders prominently on its card', async ({ page }) => {
    await reachRecommendations(page);
    const set = recommendationSet(page);
    // The hard-flag bar is role=alert and carries a severity (amber=moderate / red=severe).
    const flag = set.getByRole('alert').first();
    await expect(flag).toBeVisible();
    await expect(flag).toHaveAttribute('data-severity', /moderate|severe/);
  });

  test('AC2.5 — the trip-brief hard gates are captured + locked once recommendations arrive', async ({
    page,
  }) => {
    await reachRecommendations(page);
    // "Lock" = the hard-gate values are now authoritative + displayed as FILLED in the brief
    // (applyRecommendationGates), not a pending/italic placeholder. The detector read "Phuket"
    // from the user's message; after cards it is shown as the captured destination value.
    const brief = page.getByLabel('Trip brief').first();
    await expect(brief.getByText('Phuket', { exact: false }).first()).toBeVisible();
  });
});
