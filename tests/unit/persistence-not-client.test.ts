/* Regression guard (agent profile persistence): lib/db/persistence/family-profiles.ts is
 * imported SERVER-SIDE by the conversation agent's update_profile tool (lib/chat/agent.ts,
 * which is `import 'server-only'`). If that persistence module carries a `'use client'`
 * directive, Next's RSC bundler turns its named exports into client reference proxies that
 * are NON-CALLABLE on the server — the live failure was `loadFamilyProfile is not a function`,
 * which neither unit nor integration tests caught (no RSC bundler). This asserts the directive
 * stays absent. The module is isomorphic: every function takes an injectable client. */
import { promises as fs } from 'node:fs';
import path from 'node:path';

const MODULES = [
  'lib/db/persistence/family-profiles.ts',
  'lib/db/ssr.ts',
];

describe('server-imported persistence modules are not `use client`', () => {
  for (const rel of MODULES) {
    it(`${rel} has no 'use client' directive`, async () => {
      const src = await fs.readFile(path.join(process.cwd(), rel), 'utf8');
      // A directive is a leading string-literal statement; match it at the top (allowing the
      // leading block comment + blank lines), not merely the words inside prose.
      expect(src).not.toMatch(/^\s*(['"])use client\1\s*;?\s*$/m);
    });
  }
});
