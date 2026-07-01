/* Phase 3d — SP-01…SP-05 structural contract (spec 08b-4 + spec 15).
 *
 * We assert STRUCTURE, never live-model content: (1) the prompt artifact encodes
 * each behaviour every fixture targets, and (2) buildSystem injects BOTH context
 * blocks for each fixture, with EMPTY blocks signalling a new user (SP-01). This
 * mirrors the recommendation-assembly contract test pattern — fixtures + invariants,
 * no key, no DB. */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { buildSystem } from '@/lib/chat/build-system';
import { SP_FIXTURES, type PromptBehaviour } from '../fixtures/system-prompt';

const PROMPT_PATH = path.join(
  process.cwd(),
  'prompts',
  'conversation-agent',
  'system-prompt.md',
);

/** Each behaviour → the regexes that prove the prompt encodes it. ALL must match. */
const BEHAVIOUR_EVIDENCE: Record<PromptBehaviour, RegExp[]> = {
  'one-question-at-a-time': [/one question per message/i],
  'first-question-name-only': [/first question is name only/i],
  'never-reask-known-fields': [/never re-?ask/i, /already present/i],
  'transactional-direct-to-assemble': [
    /transactional/i,
    /proceed straight to recommendations/i,
  ],
  'hard-flag-acknowledged-in-wrapper': [
    /acknowledge any flag in your\s+conversational wrapper/i,
    /never suppress, soften, or\s+dilute/i,
  ],
  'recommendation-wrapper-one-line-no-restate': [
    /ONE warm sentence of framing/i,
    /moves the user forward/i,
    /NEVER restate the cards in prose/i,
  ],
  'out-of-scope-decline-names-five': [
    /decline warmly/i,
    /Phuket.*Singapore.*Tokyo.*Orlando.*Bali/s,
  ],
  'confirmed-change-must-call-update-profile': [
    /MUST call\s+`update_profile`/i,
    /BEFORE replying/i,
    /without calling the tool is a failure/i,
    /budgetTier:'luxury'/i,
  ],
};

describe('SP-01…SP-05 system-prompt fixtures (structural)', () => {
  let prompt: string;
  beforeAll(async () => {
    prompt = await fs.readFile(PROMPT_PATH, 'utf8');
  });

  it('ships exactly the six SP fixtures with unique ids', () => {
    expect(SP_FIXTURES).toHaveLength(6);
    expect(new Set(SP_FIXTURES.map((f) => f.id)).size).toBe(6);
  });

  for (const fx of SP_FIXTURES) {
    describe(`${fx.id} — ${fx.title}`, () => {
      it('targets at least one behaviour', () => {
        expect(fx.expectBehaviours.length).toBeGreaterThan(0);
      });

      it('the prompt artifact encodes every targeted behaviour', () => {
        for (const behaviour of fx.expectBehaviours) {
          for (const re of BEHAVIOUR_EVIDENCE[behaviour]) {
            expect(prompt).toMatch(re);
          }
        }
      });

      it('buildSystem injects both context blocks (empty = new user)', () => {
        const system = buildSystem(prompt, {
          familyProfile: fx.familyProfile ?? undefined,
          sessionSnapshot: fx.sessionSnapshot,
        });
        expect(system).toContain('<family_profile>');
        expect(system).toContain('</family_profile>');
        expect(system).toContain('<session_snapshot>');
        expect(system).toContain('</session_snapshot>');

        const fpEmpty = system.match(/<family_profile>\n([\s\S]*?)\n<\/family_profile>/)?.[1] ?? '';
        if (fx.familyProfile == null) {
          // New user → empty family_profile block.
          expect(fpEmpty.trim()).toBe('');
        } else {
          expect(fpEmpty).toContain(fx.familyProfile.name);
        }
      });
    });
  }
});
