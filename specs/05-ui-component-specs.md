# 05 · UI Component Specs

- **Notion:** https://app.notion.com/p/3744958429ac81b8b5e6f1c28b36a948
- **Phase:** 0 (tokens wiring) + 3 (components) · **Status:** briefing (visual design locked via `design_handoff/`)
- **Design source of truth:** `design_handoff/` — `tailwind.config.js`, `tokens.css`, `brand-themes.css`, and the prototype HTMLs + screenshots. The design system is **locked**; mine exact values from these, ship idiomatic React + Tailwind.

## Locked design system (Phase 0 wiring)

- **Tailwind v3 config** (`design_handoff/tailwind.config.js`) — drop-in; content globs already target App Router (`./app`, `./components`). Exports `brandThemes` (terracotta/teal/ocean/plum, 10-stop OKLCH ramps; hard-flag amber/red never themed). **Decision (2026-06-05): pin Tailwind v3** in the scaffold so this config works unchanged (do not use v4).
- **`tokens.css`** — CSS custom properties + Google Fonts import (Newsreader serif, Geist sans, Geist Mono) + reusable type classes (`.t-*`, `.t-verdict`) + `.photo-slot` placeholder + `prefers-reduced-motion` handling.
- **`brand-themes.css`** — runtime `[data-brand]` accent switching.
- **Icons:** `lucide-react`, outline, 1.75 stroke. Category: `bed-double` / `waves` / `utensils` / `map-pin`. Flag: `triangle-alert` (amber) / `octagon-alert` (red). Top Pick: `award`. Loyalty: `badge-check`. Concierge: `concierge-bell`. Source: `message-square-quote`.

## Components (7 + interaction states)

1. **Chat interface** — streaming word-by-word with blinking caret (no mid-word reflow), 3-dot typing indicator (never a spinner except the brief "researching" pill), inline components, max-width 760px, mobile-responsive. Composer: auto-grow textarea, Enter-to-send / Shift+Enter newline, disabled until non-empty.
2. **Hotel recommendation card** — Top Pick + Standard variants. Top Pick must be **visually unmistakable** (border `primary-200`, `r-card`, shadow `lg`, "Top Pick" `award` badge). Fields per the card contract in `03b-recommendation-flow.md`. Standard cards collapsed by default → expand to full Top Pick layout in place (animate **position only**, never opacity-from-0).
3. **Hard flag alert** — see rules below.
4. **Onboarding flow** — one question per message; "switch to form" offer after Q2 (once); resumable.
5. **Trip brief collection** — conversational, hard-gated on destination + trip type; desktop Trip Brief rail (6 fixed essentials + freeform preference chips; "Find hotels" enables at 4 core items); tablet → toggle; mobile → slide-in.
6. **Shortlist panel** — slides in (right 392px desktop / bottom sheet mobile); save/share/clear; flag dots; counts sync; empty state.
7. **Post-recommendation action bar** — Save · Share · Proceed to book (primary) · **escape hatch** ("Tell me what you want to do"; always accessible; focuses composer). Mobile: horizontal scroll, escape hatch always reachable.

## Hard-flag visual rules (CLAUDE.md rule 1, 4 — non-negotiable)

- `moderate` → **amber** palette; `severe` → **red** palette. **Never grey, never muted.**
- These hues are reserved exclusively for hard flags — never used for any other UI purpose.
- **Always above the fold on the card, before any positive content** — even on the #1 pick.
- **Cannot be collapsed or dismissed.** Icon (`triangle-alert`/`octagon-alert`) in a solid colored tile + bold category label + 1–2 sentence description + source line ("Based on recent guest reviews", mono, `message-square-quote`).
- Also renders as a standalone inline chat message when the concierge surfaces a flag pre-recommendation (`Hard Flag - Inline Message.html`).

## Interaction states (every component)

Default · **Loading (skeleton** — card-shaped shimmer in exact proportions, no layout shift; skeletons over spinners) · **Error (warm**, concierge voice, never raw; see 14) · **Empty (always a next step)** · **Mobile (works at 375px)**.

## Hard constraints (do not violate)

1. Hard flags always amber/red, never collapsed/dismissed, always above the fold.
2. Top Pick visually unmistakable vs standard cards.
3. No AI-generated hotel images — real photography; placeholders elegant, never broken.
4. Streaming text must not reflow.
5. Escape hatch always accessible.
6. Works for a 43-year-old in Mumbai on a phone — every component at 375px.

## Action items

- **Phase 0:** copy `tailwind.config.js` + `tokens.css` + `brand-themes.css` into the app; wire fonts + Tailwind; render `Design System.html` equivalent to verify tokens.
- **Phase 3:** build components from tokens (use the `component-from-tokens` skill) with all interaction states + a11y baseline; enforce hard-flag visual rules + the placeholder-never-broken rule (`hard-flag-audit` for the flag-survival side).
