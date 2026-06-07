# Conversation Agent — Test Fixtures

> Canonical spec: [`specs/08b-4-test-fixtures.md`](../../specs/08b-4-test-fixtures.md) ·
> Notion 08b-4. This file is the **index** that closes the 08b-4 "Author
> `/prompts/conversation-agent/test-fixtures.md`" action item. The fixtures themselves
> live as typed code under `tests/fixtures/` (not duplicated here) and are exercised by
> the contract tests under `tests/contract/`. Tests validate **structure / format /
> contract**, never content (per `specs/15-test-strategy.md`).

## Where each fixture set lives

| Set | Fixture source | Tested by |
|---|---|---|
| **SP-01…SP-05** (system prompt) | `tests/fixtures/system-prompt.ts` | `tests/unit/system-prompt-fixtures.test.ts` |
| **RA-01…RA-05** (recommendation assembly) | `tests/fixtures/recommendation-assembly.ts` | `tests/contract/recommendation-assembly.test.ts` |
| **SS-01…SS-02** (session snapshot, Phase 5) | snapshot prompt cases | `tests/contract/session-snapshot-prompt.test.ts` |
| Standard family profile + trip brief | `tests/fixtures/family-profile.ts` | shared by the above |

The standard profile is **"Raj Mehta" (Mumbai, vegetarian, kids Aanya & Vir)** — see
`tests/fixtures/family-profile.ts`. Use it as the default actor in any new fixture.

## What each case asserts (summary — spec 08b-4 is authoritative)

### System Prompt — SP-01…SP-05
- **SP-01** New-user onboarding: one question at a time; first question is **name only**.
- **SP-02** Returning user (complete profile + partial brief): don't repeat confirmed
  fields; resume from the last unanswered field.
- **SP-03** Transactional: all required fields in one message → go straight to
  `assemble_recommendations`, no clarifying questions.
- **SP-04** Hard-flag acknowledgement: a severe flag on the top pick is surfaced in the
  conversational wrapper, not just the card. Pins the wrapper-prose discipline (one framing
  sentence before cards, one short forward line after, never restate the cards in prose).
- **SP-05** Out-of-scope destination (e.g. Bangkok): decline warmly, list the 5 covered
  destinations, name no hotels.

### Recommendation Assembly — RA-01…RA-05
- **RA-01** Resort-anchored (Phuket): Indian-food + family signal wins top pick; preferred
  brand with no Indian-guest reviews lands in `other_picks` with the gap stated; flagged
  hotel demoted.
- **RA-02** Low-confidence filter: a `low_confidence: true` hotel is excluded; `other_picks = []`.
- **RA-03** Evaluate-only: only the shortlisted hotels are assessed; stronger non-shortlisted
  ones excluded; `evaluate_only_applied = true`, `alternatives_introduced = false`.
- **RA-04** Budget mismatch: `value` tier against all-`ultra-luxury` candidates → error object
  with `available_tiers`. (Budget→price-tier map is canonical in spec 02 + `lib/review-intelligence/query.ts`.)
- **RA-05** All hotels flagged: best-of-bad top pick; every hard flag verbatim;
  `recommendation_notes` states all options are flagged.

### Session Snapshot — SS-01…SS-02 (Phase 5)
- **SS-01** Mid-onboarding snapshot — plain text, < 400 tokens.
- **SS-02** Post-recommendation snapshot with the user's decision — plain text, < 400 tokens.

## Coverage note (per spec 15)
RA-* back the **Phase 2 contract tests** (live today). SP-* were originally intended to also
back **Phase 3 E2E (Playwright)**; E2E is **deferred post-v1** (see `specs/15-test-strategy.md`),
so SP-* are currently exercised by the jsdom unit test above, not by an E2E run.
