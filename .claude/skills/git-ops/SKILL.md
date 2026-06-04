---
name: git-ops
description: Execute the HotelZippo git workflow the same way every time — branch from main, commit (Conventional Commits), push, open a PR, enable squash auto-merge, then watch checks and report. Use whenever shipping a change set or phase. Trigger - "commit and open a PR", "ship this", "merge when green", end of a build phase.
---

# git-ops

The standard branch → commit → PR → auto-merge loop. Full policy in `CONTRIBUTING.md`. **Merge gate = green CI + 1 human approval; merge style = squash; auto-merge on.**

## Preconditions
- `gh auth status` is authenticated. If not, STOP and ask the user to run `! gh auth login` (interactive — Claude cannot do it).
- Working from the latest `main`.

## Procedure
1. **Branch.** `git switch main && git pull --ff-only` (skip pull if `main` is unborn), then `git switch -c <type>/<topic>` (e.g. `phase-0-scaffold`, `chore/project-baseline`). Never commit directly to `main`.
2. **Stage + commit.** Review `git status` and `git diff`. Verify no secrets / no `.env.local`. Commit with a Conventional Commits message ending in the `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` trailer.
3. **Push.** `git push -u origin <branch>`.
4. **PR.** `gh pr create` filling the PR template — link the `/specs` file + Notion page, tick the phase acceptance criteria + non-negotiables checklist. PR body ends with the Claude Code attribution line.
5. **Auto-merge.** `gh pr merge --squash --auto --delete-branch`. GitHub merges automatically once approval + checks are satisfied.
6. **Watch + report.** `gh pr checks --watch` (or poll). Report the PR URL and the check status. If a check fails, push fixes to the same branch — do not bypass the gate.

## Hard rules
- Never merge without green CI + the required approval. Do not use admin-merge to skip the gate.
- One PR per branch; keep it focused. Squash only.
- Contract changes originate in Notion first (CLAUDE.md rule 7) — ideally a separate PR from the code that consumes them.
- Branch protection / auto-delete are configured once via `gh api` (see CONTRIBUTING.md); if a `gh pr merge --auto` fails because protection isn't set, report it and offer to apply the protection rules.

## Output
Report: branch name, commit subject(s), PR URL, auto-merge enabled (y/n), and current check status.
