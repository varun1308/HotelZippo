---
name: git-ops
description: Execute the HotelZippo git workflow the same way every time — branch from main, commit (Conventional Commits), push, open a PR, enable squash auto-merge, then watch checks and report. Use whenever shipping a change set or phase. Trigger - "commit and open a PR", "ship this", "merge when green", end of a build phase.
---

# git-ops

The standard branch → commit → PR → review loop. Full policy in `CONTRIBUTING.md`. **Merge gate = green CI + founder's manual merge; merge style = squash.**

> **Repo reality (2026-06-05):** `varun1308/HotelZippo` is **private on GitHub Free**, so branch protection / required reviews / enforced auto-merge are **not available**. The agreed model: Claude opens the PR with green CI and **stops** — the **founder merges manually** (Claude never merges). Do **not** enable `gh pr merge --auto` here; it would merge unguarded. Revisit if the repo goes public or upgrades to Pro.

## Preconditions
- `gh auth status` is authenticated. If not, STOP and ask the user to run `! gh auth login` (interactive — Claude cannot do it).
- Working from the latest `main`.

## Procedure
1. **Branch.** `git switch main && git pull --ff-only` (skip pull if `main` is unborn), then `git switch -c <type>/<topic>` (e.g. `phase-0-scaffold`, `chore/project-baseline`). Never commit directly to `main`.
2. **Stage + commit.** Review `git status` and `git diff`. Verify no secrets / no `.env.local`. Commit with a Conventional Commits message ending in the `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` trailer.
3. **Push.** `git push -u origin <branch>`.
4. **PR.** `gh pr create` filling the PR template — link the `/specs` file + Notion page, tick the phase acceptance criteria + non-negotiables checklist. PR body ends with the Claude Code attribution line.
5. **Watch + report — then STOP.** `gh pr checks --watch` (or poll). Report the PR URL and check status, and explicitly hand off to the founder to merge. **Claude does not merge.** If a check fails, push fixes to the same branch — never bypass the gate.
6. (Founder merges via the GitHub UI or tells Claude to run `gh pr merge --squash --delete-branch`. Only merge on an explicit founder instruction for that specific PR.)

## Hard rules
- Never merge without green CI **and** an explicit founder go-ahead for that PR. No admin-merge, no `--auto` (unenforced on this repo).
- One PR per branch; keep it focused. Squash only.
- Contract changes originate in Notion first (CLAUDE.md rule 7) — ideally a separate PR from the code that consumes them.
- If the repo later gains protection (public / Pro), switch to `gh pr merge --squash --auto --delete-branch` + required-approval rules.

## Output
Report: branch name, commit subject(s), PR URL, auto-merge enabled (y/n), and current check status.
