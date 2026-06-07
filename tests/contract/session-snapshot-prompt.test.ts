/* Contract test for the Session Snapshot prompt artifact (spec 08b-3, Phase 5 Slice 1).
 *
 * Validates STRUCTURE/CONTRACT, never live-model content (per spec 15). We assert that
 * the on-disk prompt encodes every invariant the generator depends on, so drift in the
 * .md file is caught here rather than at runtime. Mirrors the system-prompt-fixtures
 * contract pattern: read the artifact from disk, assert resilient substring/regex
 * evidence for each invariant. No key, no DB, no model call. */
import { promises as fs } from 'node:fs';
import path from 'node:path';

const PROMPT_PATH = path.join(
  process.cwd(),
  'prompts/conversation-agent/session-snapshot.md',
);

describe('session-snapshot prompt artifact (contract)', () => {
  let prompt: string;
  beforeAll(async () => {
    prompt = await fs.readFile(PROMPT_PATH, 'utf8');
  });

  it('exists and is non-empty', () => {
    expect(prompt.trim().length).toBeGreaterThan(0);
  });

  it('pins the spec and the server-side model', () => {
    expect(prompt).toMatch(/specs\/08b-3-session-snapshot\.md/);
    expect(prompt).toMatch(/claude-sonnet-4-6/);
  });

  it('encodes the plain-text-only rule (no JSON, no markdown)', () => {
    expect(prompt).toMatch(/plain text only/i);
    expect(prompt).toMatch(/no JSON/i);
    expect(prompt).toMatch(/no markdown/i);
  });

  it('encodes the 500-token hard ceiling and 400 preferred budget', () => {
    expect(prompt).toMatch(/500 tokens is the hard ceiling/i);
    expect(prompt).toMatch(/under 400 tokens preferred/i);
  });

  it('encodes the third-person rule', () => {
    expect(prompt).toMatch(/third person/i);
  });

  it('encodes the do-not-infer / only-stated-or-confirmed rule', () => {
    expect(prompt).toMatch(/do\s+\*?\*?not\*?\*?\s+infer or assume/i);
    expect(prompt).toMatch(/not stated or confirmed|was not stated or confirmed/i);
  });

  it('instructs surfacing hard flags in the recommendations-shown section', () => {
    expect(prompt).toMatch(/hard flags? (that )?(were|was) surfaced|note any hard flags?/i);
  });

  it('encodes all seven capture categories', () => {
    const categories: RegExp[] = [
      /family profile state/i,
      /profile completion status/i,
      /trip brief state/i,
      /trip brief completion status/i,
      /recommendations shown/i,
      /user decisions and expressed preferences/i,
      /where the conversation was left/i,
    ];
    for (const re of categories) {
      expect(prompt).toMatch(re);
    }
  });
});
