/* Production build safety guard (runs as `prebuild`, before `next build`).
 *
 * Two NEXT_PUBLIC_ flags are baked into the browser bundle at build time and weaken
 * the app if they ship to production:
 *   - NEXT_PUBLIC_ENABLE_DEV_LOGIN === 'true'  → email/password sign-in that BYPASSES
 *     Google OAuth (lib/auth/devSignin.ts). In prod this is an auth bypass — anyone in.
 *   - NEXT_PUBLIC_E2E === '1'                   → injects test STUBS for chat + booking
 *     (lib/chat/e2e-stub.ts, lib/booking/e2e-stub.ts). In prod this fakes the product.
 *
 * Because they're inlined at build time, the only reliable place to stop them is the
 * build itself. This guard FAILS the build if either flag is truthy.
 *
 * Exemption: the CI E2E suite legitimately builds with both flags ON (it runs the stubbed
 * app under Playwright). That build sets `ALLOW_UNSAFE_FLAGS=1` explicitly (see the
 * `e2e:build` npm script) to opt out. The exemption is named + opt-in, so a Vercel
 * production build — which never sets it — can never bypass the guard by accident.
 */

const DANGEROUS = [
  {
    name: 'NEXT_PUBLIC_ENABLE_DEV_LOGIN',
    unsafeWhen: (v) => v === 'true',
    risk: 'enables the dev email/password sign-in that BYPASSES Google OAuth',
  },
  {
    name: 'NEXT_PUBLIC_E2E',
    unsafeWhen: (v) => v === '1',
    risk: 'injects E2E test stubs for chat + booking (fake responses, no real provider calls)',
  },
];

const exempt = process.env.ALLOW_UNSAFE_FLAGS === '1';

const violations = DANGEROUS.filter((f) => f.unsafeWhen(process.env[f.name]));

if (violations.length > 0 && exempt) {
  // CI E2E build (or an explicit, deliberate local stub build). Allowed, but loud.
  // Written to stdout (not stderr): this is a successful build, just a noisy one.
  console.log(
    `[preflight] ⚠️  Building with unsafe flags (ALLOW_UNSAFE_FLAGS=1): ` +
      violations.map((f) => f.name).join(', ') +
      `. This is expected ONLY for the E2E/stub build — it must NEVER run on a production deploy.`,
  );
} else if (violations.length > 0) {
  console.error('\n[preflight] ❌ Refusing to build: unsafe NEXT_PUBLIC_ flag(s) are set.\n');
  for (const f of violations) {
    console.error(`  • ${f.name}=${JSON.stringify(process.env[f.name])} — ${f.risk}.`);
  }
  console.error(
    '\n  These flags are baked into the browser bundle and must be UNSET in production.\n' +
      '  Fix: remove them from the build environment (e.g. the Vercel project env vars).\n' +
      '  If this is the intentional E2E/stub build, run it via `npm run e2e:build` (sets ALLOW_UNSAFE_FLAGS=1).\n',
  );
  process.exit(1);
} else {
  console.log('[preflight] ✓ No unsafe build flags set.');
}
