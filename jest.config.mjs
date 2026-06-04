import nextJest from 'next/jest.js';

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
});
