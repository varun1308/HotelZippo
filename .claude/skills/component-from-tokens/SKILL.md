---
name: component-from-tokens
description: Scaffold a React component from the locked 05 design tokens (design_handoff/) with all required interaction states (default / loading-skeleton / error / empty / mobile-375) and a baseline a11y pass. Use when building any HotelZippo UI component. Trigger - "build the <X> component", "scaffold the card", ui-builder work.
---

# component-from-tokens

Every HotelZippo component is built the same way: from the locked tokens, with all five states, accessible, mobile-first.

## When to use
Building or revising any React component in the app (chat, cards, hard-flag, shortlist, onboarding, trip brief, action bar).

## Source of truth
`design_handoff/` — `tailwind.config.js` (v3, drop-in; exports `brandThemes`), `tokens.css` (CSS vars + fonts + `.t-*` type classes + `.photo-slot`), `brand-themes.css` (`[data-brand]`), the prototype HTMLs, and `screenshots/`. Mine exact spacing/color/type/motion from these; **never copy HTML verbatim** — ship idiomatic React + Tailwind. Icons: `lucide-react`, outline, 1.75 stroke.

## Procedure
1. **Find the prototype** for the component (e.g. `Top Pick Card.html`, `Hard Flag - Inline Message.html`) and read its structure + class names for exact values.
2. **Scaffold** `/components/<area>/<Component>.tsx` using Tailwind tokens (not raw hex). Use the type classes / font families from tokens.css.
3. **Implement all five states** as the component requires: `default`, `loading` (card-shaped skeleton shimmer in exact proportions — no layout shift), `error` (warm, concierge voice per 14 — never raw), `empty` (always a next step), and `mobile` (must work at **375px**).
4. **Motion:** entrance animates **position only** (never opacity-from-0); decorative motion gated on `prefers-reduced-motion`. Streaming text: word-by-word, blinking caret, no reflow; `<em>` reveals whole-token. Typing = 3-dot blink, not a spinner.
5. **a11y baseline:** semantic elements, labelled controls, focus-visible ring (`ring-primary`), keyboard reachability, alt/aria for icons-with-meaning, color-contrast check.
6. **Test:** an RTL/Playwright component test rendering each state at 375px and at desktop.

## Hard rules (enforce in every component)
- Hard flags: amber(moderate)/red(severe) only; above the fold; never collapsible/dismissible; amber/red used nowhere else.
- Top Pick visually unmistakable vs standard cards.
- Missing image → `.photo-slot` placeholder, never broken.
- Escape hatch (action bar) always accessible.

## Output
List the component + test files, the states implemented, and confirm the hard-flag/placeholder/375px checks.
