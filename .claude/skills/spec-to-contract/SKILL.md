---
name: spec-to-contract
description: Turn a Notion spec page (and its "Claude Code Action Items") into a normalised /specs/*.md contract plus an implementation stub and a test skeleton. Use this whenever generating or refreshing a /specs file from Notion. Trigger - "generate the spec for <page>", "refresh /specs from Notion", spec-sync work.
---

# spec-to-contract

The standard spec-driven loop: **Notion page → `/specs/*.md` contract → stub + test skeleton.**

## When to use
A Notion spec page needs an in-repo contract, or an existing `/specs` file must be refreshed because its Notion source changed.

## Procedure
1. **Fetch** the Notion page (`mcp__claude_ai_Notion__notion-fetch`). Read it fully, including the "Claude Code Action Items" section.
2. **Resolve the filename** using the convention `<spine-number><opt-letter>-<kebab-topic>.md`. Check Notion 16 · Spec Index for an explicit re-key (e.g. `08b-6`→`03b-recommendation-flow.md`, `12g`→`01b-image-sourcing.md`, `08a-5`→`02-review-intelligence-pipeline.md`); Notion wins.
3. **Write `/specs/<file>.md`** with this shape:
   - Header: Notion URL, **Phase**, **Status** (from 16).
   - Canonical content distilled from the page (decisions, schema/config, file paths, env var names it names).
   - The **Action Items** reproduced close to verbatim.
   - Any hard rules the contract must encode.
4. **Trace, don't invent.** Every line must come from the page. Ambiguity → record it as an open item, don't guess.
5. **Stub + test skeleton:** create the file paths the Action Items name (empty stubs with a `// TODO (spec: <file>)` and a matching `*.test.ts` skeleton referencing the acceptance criteria). Do not implement logic here.
6. **Update `docs/spec-coverage.md`** — set the row's status to `generated`.

## Hard rules
- Contract changes originate in **Notion first** (CLAUDE.md rule 7). If code needs something the page lacks, stop and flag — do not add new decisions to `/specs`.
- Never contradict 07 (data model), 03 (locked scope), or CLAUDE.md hard rules.

## Output
Report: the file written, its phase/status, the stubs/tests created, and any open items or Notion↔/specs drift found.
