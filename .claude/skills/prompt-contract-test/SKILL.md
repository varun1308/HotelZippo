---
name: prompt-contract-test
description: Given a prompt's JSON output schema, emit the Zod schema, contract tests, and fixtures (reusing /tests/fixtures/). Use when a prompt produces structured JSON that the rest of the system depends on. Trigger - "contract-test the assembly output", "validate the prompt JSON", prompt-engineer work.
---

# prompt-contract-test

Locks a prompt's structured output behind a Zod contract + tests, so downstream code (cards, routes) can trust the shape.

## When to use
A prompt emits JSON that something else consumes — chiefly the 08b-2 recommendation-assembly output, but also any future structured prompt output.

## Procedure
1. **Read the output schema** from the spec (e.g. `specs/08b-2-recommendation-assembly.md` — the verbatim JSON schema). Treat it as authoritative.
2. **Zod schema** in `/lib/contracts/<name>.ts` mirroring every field, including: `top_pick`, `other_picks[]`, `hard_flags[]` (`severity: 'moderate'|'severe'`), `brand_note: string|null`, `evaluate_only_applied`, `alternatives_introduced`, and the error variants (`{error:'no_eligible_hotels'|'budget_mismatch', ...}`).
3. **Fixtures** in `/tests/fixtures/` — reuse the 08b-4 cases (RA-01…RA-05). Each fixture = inputs (family profile, trip brief, candidate intelligence) + the expected **structural** assertions (not exact prose).
4. **Contract tests** (`/tests/contract/<name>.test.ts`): parse representative outputs through Zod; assert the structural invariants per fixture — e.g. RA-02 → `other_picks` empty; RA-03 → `evaluate_only_applied=true && alternatives_introduced=false`; RA-04 → budget_mismatch error with `available_tiers`; RA-05 → all source flags present.
5. **Validate structure/format/contract, not content** (per 15). Never assert exact sentences.

## Hard rules
- The schema is the **union** of the success object and the error objects — both must parse.
- Pair with `hard-flag-audit`: every hard flag in the input intelligence must be present in the parsed output.
- Schema change originates in Notion → `/specs` → here. Don't widen the Zod schema to make a test pass.

## Output
List the Zod schema, fixtures, and tests written, and the pass/fail of each RA fixture.
