/* Playwright config — the E2E suite (specs/15a-e2e-test-strategy.md).
 *
 * Runs the four critical-journey specs against a REAL production server (`next start`)
 * backed by a REAL local Supabase, with the agent + booking providers swapped for
 * deterministic stubs via NEXT_PUBLIC_E2E (see lib/chat/e2e-stub.ts). The whole default
 * suite is KEY-FREE: no ANTHROPIC / APIFY / ROUTESTACK / Google secrets.
 *
 * Pre-reqs (handled by `npm run dev:db` + `npm run dev:user`, and by the CI e2e job):
 *   • local Supabase running + seeded (10 hotels + intelligence)
 *   • a seeded dev user (dev@hotelzippo.local) for dev-login
 *   • a production build present (`next build`) — `next start` serves it
 *
 * Env comes from .env.e2e (committed, no secrets). The webServer block boots `next start`
 * with that env so NEXT_PUBLIC_* flags are present at runtime; the BUILD must also see
 * .env.e2e so the flags are baked in (the CI step / local runbook builds with it). */
import { defineConfig, devices } from '@playwright/test';
import { config as loadEnv } from 'dotenv';
import path from 'node:path';

// Load .env.e2e for the test runner process (base URL, etc.) AND capture it as a plain
// object to hand to the `next start` webServer — so the server has the local Supabase
// URL/keys at RUNTIME (server-only keys aren't baked into the build).
const e2eEnv = loadEnv({ path: path.resolve(__dirname, '.env.e2e') }).parsed ?? {};

const PORT = Number(process.env.E2E_PORT ?? 3100);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const isCI = !!process.env.CI;

export default defineConfig({
  testDir: './e2e',
  // Each spec mutates shared DB state (shortlist/profile rows) → run files serially to
  // keep journeys deterministic. Within a file, tests run in order.
  fullyParallel: false,
  workers: 1,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  reporter: isCI ? [['github'], ['list']] : 'list',
  timeout: 30_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'off',
  },

  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],

  // Boot the production server with the E2E env. `next build` is expected to have run with
  // the same env (so NEXT_PUBLIC_* flags are baked); reuse a running server locally.
  webServer: {
    command: `npx next start -p ${PORT}`,
    url: BASE_URL,
    timeout: 120_000,
    reuseExistingServer: !isCI,
    // Hand the full .env.e2e to `next start` so it has the local Supabase URL + server-only
    // service key at runtime (only NEXT_PUBLIC_* values are baked into the build).
    env: {
      ...e2eEnv,
      NEXT_PUBLIC_E2E: '1',
      NEXT_PUBLIC_ENABLE_DEV_LOGIN: 'true',
    },
  },
});
