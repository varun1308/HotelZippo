/* Assembly model-call timeout (lib/recommendations/assemble.ts).
 * A hung Anthropic call must fail WARM before the 60s serverless kill (prod 2026-06-30 symptom).
 * The timeout is 45s by default, env-overridable via ASSEMBLY_TIMEOUT_MS. */
import { assemblyTimeoutMs } from '@/lib/recommendations/assemble';

const savedEnv = { ...process.env };
afterEach(() => {
  process.env = { ...savedEnv };
});

describe('assemblyTimeoutMs', () => {
  it('defaults to 45000ms when unset', () => {
    delete process.env.ASSEMBLY_TIMEOUT_MS;
    expect(assemblyTimeoutMs()).toBe(45_000);
  });

  it('honours a valid positive override', () => {
    process.env.ASSEMBLY_TIMEOUT_MS = '30000';
    expect(assemblyTimeoutMs()).toBe(30_000);
  });

  it('falls back to the default for non-numeric, zero, or negative values', () => {
    for (const bad of ['', 'abc', '0', '-5']) {
      process.env.ASSEMBLY_TIMEOUT_MS = bad;
      expect(assemblyTimeoutMs()).toBe(45_000);
    }
  });

  it('stays under the 60s serverless kill so a hung call fails warm first', () => {
    delete process.env.ASSEMBLY_TIMEOUT_MS;
    expect(assemblyTimeoutMs()).toBeLessThan(60_000);
  });
});
