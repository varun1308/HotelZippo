/* Verifies the production build safety guard (scripts/build/preflight.mjs).
 *
 * The guard is what stops NEXT_PUBLIC_ENABLE_DEV_LOGIN / NEXT_PUBLIC_E2E from being
 * baked into a production bundle (auth bypass + test stubs). We run the real script as
 * a subprocess with a controlled env and assert on exit code — same contract `prebuild`
 * relies on (a non-zero exit aborts `next build`). */
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const SCRIPT = path.join(process.cwd(), 'scripts/build/preflight.mjs');

/** Run the guard with a CLEAN env (only the overrides given) + return {code, output}. */
function runGuard(env: Record<string, string>): { code: number; output: string } {
  try {
    const output = execFileSync('node', [SCRIPT], {
      // Bare env so an ambient NEXT_PUBLIC_* in the dev shell can't leak in and flip a case.
      // Cast: the repo augments ProcessEnv with required keys; we deliberately pass a minimal env.
      env: { PATH: process.env.PATH ?? '', ...env } as unknown as NodeJS.ProcessEnv,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, output };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { code: err.status ?? 1, output: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}

describe('build preflight guard', () => {
  it('passes a clean build (no flags set)', () => {
    expect(runGuard({}).code).toBe(0);
  });

  it('passes when flags hold harmless values (false / 0)', () => {
    expect(runGuard({ NEXT_PUBLIC_ENABLE_DEV_LOGIN: 'false', NEXT_PUBLIC_E2E: '0' }).code).toBe(0);
  });

  it('FAILS when the dev-login bypass is enabled', () => {
    const { code, output } = runGuard({ NEXT_PUBLIC_ENABLE_DEV_LOGIN: 'true' });
    expect(code).toBe(1);
    expect(output).toContain('NEXT_PUBLIC_ENABLE_DEV_LOGIN');
  });

  it('FAILS when the E2E stub flag is enabled', () => {
    const { code, output } = runGuard({ NEXT_PUBLIC_E2E: '1' });
    expect(code).toBe(1);
    expect(output).toContain('NEXT_PUBLIC_E2E');
  });

  it('allows the exempted E2E/stub build (ALLOW_UNSAFE_FLAGS=1) but warns', () => {
    const { code, output } = runGuard({
      ALLOW_UNSAFE_FLAGS: '1',
      NEXT_PUBLIC_E2E: '1',
      NEXT_PUBLIC_ENABLE_DEV_LOGIN: 'true',
    });
    expect(code).toBe(0);
    expect(output).toMatch(/ALLOW_UNSAFE_FLAGS/);
  });
});
