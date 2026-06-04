# Contributing — git & GitHub workflow

The git strategy for HotelZippo. Claude Code follows this via the `git-ops` skill; humans follow it manually.

## Branching model (trunk-based, short-lived branches)

- **`main`** is the always-green trunk. It is **protected**: no direct pushes; changes land only via PR with green CI + 1 approval.
- Work happens on a short-lived branch off the latest `main`, named:
  - `phase-<N>-<topic>` — a build phase or slice (`phase-0-scaffold`, `phase-1-data`).
  - `feat/<topic>`, `fix/<topic>`, `chore/<topic>`, `docs/<topic>` — anything outside a phase.
- One PR per branch. Keep branches small and focused; delete after merge.

## Commit convention — Conventional Commits

`<type>(<scope>): <subject>` where type ∈ `feat | fix | chore | docs | test | refactor | ci | build`.

```
feat(phase-1): add hotels table migration + RLS

Implements specs/07-data-model.md hotels table with star_rating check
and the publish-to-hotels upsert path.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
```

Commit/push only when the work is ready for review. Never commit secrets — `.env.local` is git-ignored; only `.env.example` (names, no values) is committed.

## PR + merge gate

1. Open a PR into `main` using the PR template; link the `/specs` file + Notion page.
2. **CI must pass** (`.github/workflows/ci.yml`: typecheck → lint → Jest → build, plus Playwright once present). This is the "checks pass" half.
3. **Founder review.** Claude opens the PR with green CI and **stops**; the founder reviews and **merges manually**. Claude never merges (see constraint below).
4. **Squash merge**, delete the branch on merge.

**Merge style:** **squash** — each PR becomes one clean commit on `main`. History stays linear and phase-readable.

## Branch protection — constraint (2026-06-05)

This repo is **private on GitHub Free**, where branch protection / required reviews / enforced auto-merge are **unavailable** (`gh api .../protection` → 403 "Upgrade to GitHub Pro or make this repository public"). So the review gate is a **convention, not an enforced rule**: Claude always waits for the founder's explicit merge. Do **not** enable unguarded `--auto` merge.

When the repo goes **public** or upgrades to **Pro/Team**, enable on `main`: require a PR · 1 approving review · status checks (`build-and-test`, `e2e`) · up-to-date branches · dismiss stale approvals · allow auto-merge · auto-delete branches · squash-only. Claude can apply these via `gh api` at that point.

## The spec→code change protocol (CLAUDE.md rule 7)

A contract change originates in **Notion first**, then `/specs`, then code — in that order, ideally across separate commits/PRs so the contract change is reviewable on its own.

## Phase completion

A phase PR is not merge-ready until its acceptance criteria in `specs/15-test-strategy.md` pass. `qa-gate` is the gatekeeper; it reports PASS/FAIL with real output and never marks a phase done on a skipped/partial run.
