/* J5 — Admin curation via the Apify Run Ledger (specs/15a §J5, 12h).
 *
 * Runs against the real Next server + real local Supabase, with the Apify provider swapped for the
 * deterministic E2E stub (NEXT_PUBLIC_E2E=1 → lib/curation/e2e-stub): a started run "succeeds" at
 * once and Ingest stages 3 fixture candidates. So the page's real React flow — Start Fetch → poll
 * the Runs panel → Ingest → candidates render — is exercised end-to-end with NO Apify spend.
 *
 * /admin/curation is ungated (no-auth internal tool, v1), so no sign-in is needed. We reset the
 * apify_runs + curation_hotels rows for the test destination before each run so state is clean. */
import { test, expect, type Page } from '@playwright/test';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

const DEST = 'Maldives'; // a destination the demo seed doesn't curate, so the test owns its rows

async function resetState(): Promise<void> {
  const h = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, Prefer: 'return=minimal' };
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/apify_runs?scope_value=eq.${DEST}`, { method: 'DELETE', headers: h });
    await fetch(`${SUPABASE_URL}/rest/v1/curation_hotels?destination=eq.${DEST}`, { method: 'DELETE', headers: h });
  } catch {
    /* best-effort */
  }
}

/** Select the destination tab. */
async function selectDest(page: Page): Promise<void> {
  await page.getByRole('button', { name: DEST, exact: true }).click();
}

test.beforeEach(async () => {
  await resetState();
});
test.afterAll(async () => {
  await resetState();
});

test.describe('J5 · Admin curation (Apify run ledger)', () => {
  test('AC5.1 — the curation page loads with tabs, actions, and a Runs panel', async ({ page }) => {
    await page.goto('/admin/curation');
    await expect(page.getByRole('heading', { name: /hotel curation/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /start fetch/i })).toBeVisible();
    await expect(page.getByText(/apify runs ·/i)).toBeVisible();
  });

  test('AC5.2 — Start Fetch → run appears, succeeds, Ingest stages candidates', async ({ page }) => {
    await page.goto('/admin/curation');
    await selectDest(page);

    await page.getByRole('button', { name: /start fetch/i }).click();

    // The stubbed run succeeds immediately; the Runs panel shows a succeeded run with an Ingest button.
    const ingest = page.getByRole('button', { name: /^ingest$/i }).first();
    await expect(ingest).toBeVisible({ timeout: 15_000 });

    // Ingest stages the fixture candidates → they render as candidate cards.
    await ingest.click();
    await expect(page.getByText(`E2E ${DEST} Hotel 1`)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(`E2E ${DEST} Hotel 3`)).toBeVisible();

    // The staged count reflects 3 candidates.
    await expect(page.getByText(/3 staged/i)).toBeVisible();
  });

  test('AC5.3 — a second Start Fetch triggers the reuse guard (warn, not auto-run)', async ({ page }) => {
    await page.goto('/admin/curation');
    await selectDest(page);

    // First run → succeeds.
    await page.getByRole('button', { name: /start fetch/i }).click();
    await expect(page.getByRole('button', { name: /^ingest$/i }).first()).toBeVisible({ timeout: 15_000 });

    // Second Start Fetch within the window → reuse-guard warning with the three choices.
    await page.getByRole('button', { name: /start fetch/i }).click();
    await expect(page.getByRole('button', { name: /re-pull free/i })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: /force fresh fetch/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /cancel/i })).toBeVisible();
  });
});
