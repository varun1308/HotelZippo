---
name: hard-flag-audit
description: Validator that asserts every hard flag present in source hotel_intelligence survives into the assembly output AND into the rendered card. Run in CI for Phases 2–3. Trigger - "audit hard flags", "verify flags survive", any change to assembly or card-rendering code.
---

# hard-flag-audit

The product exists to make the *Holiday Inn Karon* failure impossible. This validator enforces CLAUDE.md hard rules 1 & 4: **no hard flag is ever buried.** It is a release gate for Phases 2–3, not an optional check.

## What it asserts
For a given recommendation run:
1. **Synthesis → assembly:** every `hard_flags[]` entry in a candidate `hotel_intelligence` record that ends up in the output (`top_pick` or `other_picks[]`) is present in that pick's `hard_flags[]` — same `category`, `description`, `severity`. None dropped, none softened (a `severe` must not become `moderate`).
2. **Assembly → card:** every `hard_flags[]` entry in the assembly JSON is rendered on the card — above the fold, before positive content, in the correct palette (`moderate`→amber, `severe`→red), and **not** collapsible/dismissible.
3. **Reserved hues:** amber/red appear in the rendered output **only** within hard-flag elements.

## Procedure
1. Run the candidate query + assembly (or use a captured fixture, e.g. 08b-4 RA-05 "all hotels flagged").
2. Diff source flags (for the picked hotels) against assembly-output flags → fail on any missing or down-graded flag.
3. For card tests: render the card with a flagged fixture; assert the flag node exists above the first positive-content node, carries the right palette class, and has no collapse/dismiss affordance.
4. Scan rendered output for amber/red usage outside flag elements → fail if found.

## Where it runs
- Phase 2: as a contract test alongside `prompt-contract-test`.
- Phase 3: as a component/E2E test in the card suite.
- CI: blocking for Phases 2–3.

## Output
PASS/FAIL with, on failure, the exact flag(s) dropped/softened/mis-rendered and where.
