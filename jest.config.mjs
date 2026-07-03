import nextJest from 'next/jest.js';

/* Force test mode regardless of the invoking shell. A stray NODE_ENV (e.g. `dev` exported in a
 * shell profile) makes next/jest load `.env.local` — leaking live paid credentials into the
 * suite — and defeats every `NODE_ENV === 'test'` gate (TC-P4 mock opt-in), failing the
 * pipeline-worker happy path locally while CI stays green. Workers inherit this env. */
process.env.NODE_ENV = 'test';

const createJestConfig = nextJest({ dir: './' });

const moduleNameMapper = { '^@/(.*)$': '<rootDir>/$1' };
const ignore = ['<rootDir>/.next/', '<rootDir>/node_modules/'];

/** Two projects:
 *  - jsdom : component/unit/smoke tests (tests/smoke, tests/unit, contract tests)
 *  - node  : DB integration tests against local Supabase (tests/integration), loads .env.test
 */
const jsdomProject = createJestConfig({
  displayName: 'jsdom',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  testEnvironment: 'jest-environment-jsdom',
  moduleNameMapper,
  testMatch: ['<rootDir>/tests/(smoke|unit|contract)/**/*.test.{ts,tsx}'],
  testPathIgnorePatterns: ignore,
});

const nodeProject = createJestConfig({
  displayName: 'integration',
  testEnvironment: 'node',
  moduleNameMapper,
  setupFiles: ['<rootDir>/tests/integration/load-env.ts'],
  testMatch: ['<rootDir>/tests/integration/**/*.test.ts'],
  testPathIgnorePatterns: ignore,
});

export default async () => ({
  projects: [await jsdomProject(), await nodeProject()],
  /* Coverage (npm run test:coverage — CI gate): measured over ALL app source, not just files a
   * test happened to import, so an untested module reads 0% instead of vanishing. Scripts,
   * fixtures, and type-only barrels are excluded. Thresholds sit just under the measured
   * baseline — they are a regression floor, not a target. */
  collectCoverageFrom: [
    'app/**/*.{ts,tsx}',
    'components/**/*.{ts,tsx}',
    'lib/**/*.{ts,tsx}',
    'middleware.ts',
  ],
  /* Baseline 2026-07-03: 63.3 st / 59.5 br / 66.3 fn / 65.5 ln (jsdom project only — server
   * modules covered by the integration project legitimately read low here). Raise as coverage
   * improves; never lower to admit a regression. */
  coverageThreshold: {
    global: { statements: 62, branches: 58, functions: 65, lines: 64 },
  },
});
