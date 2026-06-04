# Handoff: HotelZippo — AI Family Travel Concierge (Web)

## Overview

HotelZippo is an **AI agentic travel web platform** that finds the right hotel for Indian families travelling with small kids. It replaces 30–40 hours of fragmented research (TripAdvisor, Google Maps, YouTube, hotel sites) with a **single confident recommendation**, backed by synthesised family reviews.

The entire experience is **conversational**. There are no search-results pages, no filter panels, no ranked lists. The user talks to an AI concierge ("Claude"), it asks the right questions, and returns 2–3 hotel recommendations as rich visual cards **inline within the conversation** — a clear top pick plus alternatives, with transparent reasoning and honest warnings ("hard flags").

This bundle covers: the **landing page**, the **conversational onboarding + trip brief**, the **inline hotel cards** (top pick + standard), the **hard-flag alert**, the **shortlist panel**, the **post-recommendation action bar**, the **opt-in family profile form**, and all required **interaction states**. Plus the full **design system** (tokens, Tailwind config, runtime brand themes).

---

## About the Design Files

The files in this bundle are **design references created in HTML/CSS/vanilla JS** — prototypes that show the intended look, motion, and behavior. **They are not production code to copy verbatim.**

The task is to **recreate these designs in the target codebase** using its established environment and patterns. The intended stack (from the product brief) is:

- **Framework:** Next.js (App Router)
- **Styling:** Tailwind CSS — `tailwind.config.js` in this bundle is ready to drop in
- **Conversational UI:** Vercel AI SDK (streaming responses, tool use)
- **Target:** Web first, fully mobile-responsive. No native app for v1.

If you are starting fresh, use that stack. If a codebase already exists, map these designs onto its conventions (component library, theming, icon set). The HTML prototypes encode every spacing, color, type, and motion decision precisely — mine them for exact values, but ship idiomatic React + Tailwind.

---

## Fidelity

**High-fidelity (hifi).** These are pixel-level mockups with final colors, typography, spacing, shadows, motion, and interaction states. Recreate the UI faithfully using the codebase's libraries. All tokens are provided in three forms (CSS variables, Tailwind config, runtime theme CSS) so you should not need to eyeball anything.

---

## Design Tokens

> Source of truth: **`tokens.css`** (CSS custom properties), **`tailwind.config.js`** (Tailwind theme), **`brand-themes.css`** (runtime accent switching). The brand color ramp is authored in **OKLCH** so every step shares hue + chroma harmony.

### Color — Brand (Terracotta, default)
| Token | Value | Use |
|---|---|---|
| `primary-50` | `oklch(0.971 0.013 46)` ≈ `#FBF1EC` | Welcome surface, verdict callout tint |
| `primary-100` | `oklch(0.940 0.028 45)` | Tint borders |
| `primary-200` | `oklch(0.890 0.050 44)` | Top-pick card border |
| `primary-300` | `oklch(0.818 0.078 43)` | Hover borders |
| `primary-400` | `oklch(0.728 0.105 42)` | Gradient start (avatar) |
| **`primary-500`** | `oklch(0.638 0.122 41)` ≈ **`#C75C3C`** | **Brand core** — primary buttons, badges, user bubbles |
| `primary-600` | `oklch(0.576 0.118 40)` | Hover |
| `primary-700` | `oklch(0.502 0.100 39)` | Press / active text |
| `primary-800` | `oklch(0.430 0.082 38)` | Deep text on tint |
| `primary-900` | `oklch(0.366 0.064 37)` | Darkest |

### Color — Warm Neutrals (stone)
| Token | Value | Use |
|---|---|---|
| `bg` | `#FBFAF8` | App canvas |
| `surface` | `#FFFFFF` | Cards |
| `surface-2` | `#F5F3EF` | Recessed panels, skeleton base |
| `surface-3` | `#EEEBE4` | Deeper recess, badge bg |
| `border` | `#E8E4DD` | Default border |
| `border-strong` | `#D8D2C8` | Inputs, button outlines |
| `overlay` | `rgba(31,27,23,0.42)` | Scrim behind panels/overlays |
| `text` | `#1F1B17` | Primary text (warm near-black) |
| `text-secondary` | `#6B6359` | Body secondary |
| `text-tertiary` | `#9A9186` | Meta, captions, placeholders |
| `text-on-dark` | `#FBFAF8` | Text on dark surfaces |

### Color — Semantic (hard-flag reserved — **never use these hues for anything else**)
| Token | Value | Use |
|---|---|---|
| `amber` | `#F59E0B` | **Moderate** hard-flag icon bg |
| `amber-bg` | `#FEF6E7` | Moderate flag surface |
| `amber-border` | `#F4D38C` | Moderate flag border |
| `amber-text` | `#8A540A` | Moderate flag label text |
| `red` | `#EF4444` | **Severe** hard-flag icon bg |
| `red-bg` | `#FDEDEC` | Severe flag surface |
| `red-border` | `#F3BFBC` | Severe flag border |
| `red-text` | `#A82820` | Severe flag label text |
| `success` | `#0E7C66` (bg `#E7F2EE`, text `#0B5E4D`) | Confirmations (e.g. "link copied") |
| `star` | `#E0972B` | Rating stars (gold) |

### Typography
Three families, loaded from Google Fonts in `tokens.css`:
- **Newsreader** (serif) — `--font-serif` — display, headings, hotel names, and the concierge **verdict** (rendered *italic*). The product's "voice."
- **Geist** (sans) — `--font-sans` — body, controls, nav, category summaries, UI.
- **Geist Mono** — `--font-mono` — eyebrow labels, price tiers, source attributions, placeholder captions.

| Role | Size / line-height / tracking | Family / weight |
|---|---|---|
| Display LG | 52 / 1.04 / -0.02em | serif 500 |
| Display | 40 / 1.08 / -0.018em | serif 500 |
| H1 | 32 / 1.14 / -0.015em | serif 500 |
| H2 | 24 / 1.22 / -0.01em | serif 500 |
| H3 | 20 / 1.3 / -0.006em | sans 600 |
| Body LG | 18 / 1.55 | sans 400 |
| Body | 16 / 1.6 | sans 400 |
| Body SM | 14 / 1.55 | sans 400 |
| Caption | 13 / 1.45 | sans 400 |
| Label | 12 / 1.2 / 0.08em / UPPERCASE | sans 600 |
| Verdict | 18 / 1.5 *italic* | serif 400 |

### Spacing (4px base)
`4 · 8 · 12 · 16 · 20 · 24 · 32 · 40 · 48 · 64 · 80` (tokens `space-1`…`space-20`). Generous by default — whitespace is part of the premium feel.

### Border Radius
| Token | Value | Use |
|---|---|---|
| `r-xs` | 6px | Small inset elements |
| `r-input` | 10px | Inputs |
| `r-btn` | 10px | Buttons |
| `r-card` | 16px | Cards |
| `r-panel` | 20px | Slide-over panels, bottom sheets |
| `r-pill` | 999px | Badges, chips, pills |

### Shadows (warm-tinted — three altitudes)
| Token | Value | Use |
|---|---|---|
| `sh-xs` | `0 1px 2px rgba(31,27,23,0.06)` | Subtle lift (chips, small buttons) |
| `sh-sm` | `0 1px 2px rgba(31,27,23,0.05), 0 1px 3px rgba(31,27,23,0.06)` | **Standard card** (resting) |
| `sh-md` | `0 4px 14px -4px rgba(31,27,23,0.10), 0 2px 4px rgba(31,27,23,0.04)` | Composer, hover |
| `sh-lg` | `0 14px 36px -10px rgba(31,27,23,0.18), 0 3px 8px rgba(31,27,23,0.06)` | **Top Pick card** (lifted) |
| `sh-panel` | `-24px 0 60px -20px rgba(31,27,23,0.22)` | **Shortlist / form panel** (floating) |
| `ring-primary` | `0 0 0 3px color-mix(in oklch, var(--primary) 22%, transparent)` | Focus ring |

### Motion
| Token | Value |
|---|---|
| `dur-fast` | 120ms |
| `dur-base` | 200ms |
| `dur-slow` | 320ms |
| `dur-panel` | 380ms |
| `ease-out` | `cubic-bezier(0.2, 0.7, 0.2, 1)` |
| `ease-standard` | `cubic-bezier(0.4, 0, 0.2, 1)` |
| `ease-in` | `cubic-bezier(0.4, 0, 1, 1)` |

**Critical motion rules:**
- **Streaming text:** reveal word-by-word with a blinking caret. Inline emphasis (`<em>`) reveals as a *whole token* so there is **no mid-word reflow**.
- **Typing indicator:** 3-dot blink — **never** a spinner (a spinner only appears in the brief "researching" pill).
- **Entrance animations animate position only, never opacity-from-0**, so print/PDF/reduced-motion always show content. Gate all decorative motion on `@media (prefers-reduced-motion: no-preference)`.

### Iconography
**Lucide** icons, outline style, **1.75 stroke**. Key mappings:
- Category icons: Rooms `bed-double` · Facilities `waves` · Food `utensils` · Location `map-pin`
- Concierge avatar: `concierge-bell`
- Hard flag: `triangle-alert` (amber/moderate) · `octagon-alert` (red/severe)
- Top Pick badge: `award` · Loyalty: `badge-check` · Shortlist: `bookmark` · Source: `message-square-quote`

### Brand Accent Theming (developer flexibility)
Four harmonised accent ramps ship in `tailwind.config.js` (`brandThemes`) and `brand-themes.css`: **terracotta** (default, hue 41), **teal** (168), **ocean** (245), **plum** (338). All share lightness + chroma; only hue changes.
- **Build-time:** `primary: brandThemes.ocean` in the Tailwind config.
- **Runtime (no rebuild):** import `brand-themes.css`, set `<html data-brand="ocean">`.
- **Programmatic:** `require('./tailwind.config.js').brandThemes`.
- **Hard-flag amber/red are intentionally NOT themed** — they must stay constant.

---

## Screens / Views

### 1. Home Page / Landing — `Home Page.html`
**Purpose:** Communicate the value prop and get the user into the chat via sign-in.

**Layout:** Fixed top nav (68px desktop / 56px mobile, blurred translucent `bg`, bottom border). Split hero below: left column (52%) = editorial copy + sign-in CTAs; right column = app-showcase carousel on a `surface-2` panel with a faint 135° diagonal hatch texture. Footer with border-top.

**Mobile (<900px):** single column, reordered **copy → carousel → CTA** (uses `display:contents` on the wrapper + `order`). The right-panel grey background goes **transparent** on mobile (cards float on `bg`); CTA block is **center-aligned**.

**Components:**
- *Eyebrow:* mono 11px uppercase, `primary-600`, with a pulsing 8px `primary-500` dot.
- *Headline:* serif `clamp(36px,3.8vw,56px)`, line2 italic `primary-600`. Copy: "One confident recommendation. *No more research spiral.*"
- *Sub:* 16–18px `text-secondary`, names the "30–40 hours" problem.
- *Google button:* authentic Google style — white bg, `#dadce0` border, multicolor G logo (provided as inline SVG), Roboto/sans 15.5px `#3c4043`, `r-btn`, max 280px. Label: "Sign up to try — it's free". Hover `#f8f9fa`.
- *"or" divider*, then *email button* (secondary outline, `mail` icon).
- *Sign-in note* (12px tertiary, links to Terms/Privacy).
- *Trust row:* 4 items with `primary-500` icons — Real guest reviews / Red flags surfaced / Built for families / Free in beta.
- *Showcase carousel:* 4 slides, each a 460px card with a unified app-chrome header (brand dot + "HotelZippo" + contextual mono label). Slides: (1) Conversation, (2) Top Pick card, (3) Hard-flag honesty screen, (4) Shortlist. Auto-advances every 4500ms; tappable dots (active dot elongates to 22px `primary-500`); a caption line updates per slide. Native scroll-snap for swipe; `pointerdown` resets the auto-timer.

**All CTAs route to the chat** (`HotelZippo Prototype.html`) — simulating completed auth.

### 2. Chat Interface — `HotelZippo Prototype.html` (the hero), also `Chat - Empty State.html`, `Chat - Active & Streaming.html`
**Purpose:** The primary surface. Full-viewport-height conversation where everything happens.

**Layout:** Column: top bar (64/56px) → scrollable message stream (max-width 760px, centered) → composer pinned to bottom. On desktop ≥1024px the prototype also shows a **right-hand Trip Brief rail** (captured context); on the action-bar state a **post-recommendation action bar** sits between stream and composer.

**States:**
- *Empty:* concierge avatar (46px rounded-13, terracotta gradient), serif greeting "Hi, I'm your *family travel concierge*", intro paragraph, a 3-item trust micro-row, and starter chips. Composer placeholder: "Tell me about your trip — who's travelling, and where to?"
- *Active / streaming:* assistant messages stream word-by-word with a blinking caret; user messages are right-aligned `primary-500` bubbles (radius `18px 18px 5px 18px`); 3-dot typing indicator before each assistant turn.
- *Loading (researching):* a pill with a small spinner: "Researching Phuket hotels for your family…"

**Top bar:** brand wordmark (serif, "Hotel**Zippo**" with terracotta "Zippo"), a rotated 12px square mark; right side has Replay + a Shortlist button with a count badge.

**Composer:** auto-growing textarea (max 160px), Enter-to-send / Shift+Enter newline, send button disabled until non-empty (42px, `primary-500`, `arrow-up`). Foot hint shows keyboard shortcuts + a subtle "Prefer a form?" link.

### 3. Conversational Onboarding + Trip Brief (within the chat)
**Purpose:** Gather family profile + trip details. **No separate screen.**

**Behavior:**
- One question per message bubble. Each assistant turn *acknowledges* the prior answer (softer `text-secondary`) then asks exactly one question (slightly stronger weight).
- After the 2nd question, a subtle dashed inline **"Switch to form"** offer appears → opens the Family Profile Form as an **overlay** (see §8).
- **Hard gate:** if the user is too vague ("somewhere warm and beachy"), the concierge pushes back firmly but warmly ("I need a little more to work with… Which country or city…"). Rendered in **normal text, not amber** — amber/red are reserved for hard flags only.
- **Trip Brief rail (desktop):** a persistent right rail showing captured context. **Fixed essentials** (Destination, When, Trip type, Who's travelling, Budget, Food) each settle in with a check; an open-ended **"Personal preferences"** section accumulates freeform chips (e.g. "Near main attractions & night markets", "Calm, shallow beach for toddler", "Kids' club a plus"). A meter tracks the 6 essentials; **"Find hotels"** enables once the 4 core items are present. Replaces a wizard-style progress bar. On tablet it collapses to a toggle; on mobile it's a slide-in panel.

### 4. Hotel Recommendation Cards — `Top Pick Card.html`, `Recommendation Set.html`
Render **inline in the message stream at full width** (max 680px).

**Top Pick Card (hero, visually unmistakable):**
- Border `1px primary-200`, `r-card`, shadow `sh-lg`.
- *Hero* (290px): full-bleed photo placeholder + bottom-up dark scrim; top-left **"Top Pick" badge** (`primary-500` pill, `award` icon, uppercase 12px 700); top-right glass **loyalty chip** ("Marriott Bonvoy", `badge-check`). Overlaid at bottom: hotel name (serif 29–32px, white), then a meta row — 5 gold stars + neighbourhood + a glass "Luxury" tier pill.
- *Hard-flag bar* (if applicable) — **directly below the hero, above the fold**, full-width (see §5).
- *Body* (24px padding, 22px gap): **Verdict callout** — `primary-50` bg, `primary-100` border, `r-14`, containing a "Why this one" mono label + concierge avatar, and the verdict in **serif italic 18px** (2–3 sentences, warm and specific to this family). Then a **2×2 category grid** (Rooms/Facilities/Food/Location, each: 34px `primary-50` icon tile + label + 1–2 sentence summary). Then **CTAs**: "Save to shortlist" (secondary, `bookmark`) + "Proceed to book" (primary, `arrow-right`), 48px, equal width.

**Standard Card (alternatives):**
- Border `1px border`, shadow `sh-sm` (clearly secondary to the Top Pick).
- Hero 180px (lighter), optional rank pill ("Runner-up") or loyalty chip. Hard-flag bar if applicable.
- **Collapsed by default:** shows a 1–2 sentence summary + a "See full details" button (with chevron) + a quick-save icon button.
- **Expanded:** reveals the same verdict callout + 2×2 category grid as the Top Pick, plus full CTAs and a "Show less". Expansion animates position only (no opacity-from-0).

**Reference scenario used throughout:** family of six (2 adults, kids aged 2 & 7, 2 grandparents), vegetarian + Indian food important, Phuket, late December, beach resort, comfort-to-luxury budget. Top pick = JW Marriott Phuket (amber minor-refurb flag); runner-up = Angsana Laguna (clean); third = Holiday Inn Karon (**red** severe active-refurbishment flag — the canonical "avoid for now" case).

### 5. Hard Flag Alert — on-card (in §4) and standalone `Hard Flag - Inline Message.html`
**The product's most important trust signal. It must never feel soft.**
- *Moderate* = **amber** palette; *Severe* = **red** palette. **Never grey, never muted.**
- High-visibility icon in a solid colored tile (`triangle-alert` amber / `octagon-alert` red), a bold category label (e.g. "Active refurbishment — avoid for now"), 1–2 sentence description, and a source line "Based on recent guest reviews" (mono, `message-square-quote`).
- **Always above the fold on the card, cannot be collapsed or dismissed.** It appears *before* any positive content — even on the #1 pick (honesty over polish).
- Also renders as a **standalone inline chat message** when the concierge surfaces a flag before recommendations (see the standalone file).

### 6. Shortlist Panel — in `HotelZippo Prototype.html`
**Purpose:** Collect saved hotels. **Slides in, not a page nav.**
- Desktop: slides from the **right** (392px, `sh-panel`, scrim behind). Mobile: rises as a **bottom sheet** (full width, 86vh, rounded top).
- Triggered by any "Save to shortlist" CTA.
- Header: "Your shortlist" + a `primary-500` count badge; close button.
- Each saved item: 60px thumbnail, name, "neighbourhood · tier" meta, an optional **flag dot** (amber "Note" / red "Flagged"), a per-item "Proceed to book", and a remove (×) button (remove animates out).
- Footer: "Share shortlist" (copies link → shows "Link copied" success state) + "Clear all".
- *Empty state:* bookmark icon + "You haven't saved any hotels yet. They'll appear here as you shortlist them."
- Count badges sync across the top bar and panel header.

### 7. Post-Recommendation Action Bar — in `HotelZippo Prototype.html`
Appears between the stream and composer once recommendations render; stays visible while scrolling.
- Four actions: **Save shortlist** · **Share with partner** · **Proceed to book** (primary) · **"Tell me what you want to do"** (the escape hatch — dashed, focuses the composer).
- On mobile the bar scrolls horizontally so all actions + the escape hatch stay reachable. **The escape hatch must always be accessible — users must never feel trapped.**

### 8. Family Profile Form (opt-in) — `Family Profile Form.html`
**Purpose:** Structured alternative to conversational onboarding. Opens as a **slide-over overlay inside the chat** (right sheet desktop / full-screen mobile), over a dimmed scrim. Closes via its "Back to chat" button, the scrim, or Esc. On submit it closes and **feeds answers back into the chat** (a concierge acknowledgment streams in; the Trip Brief rail auto-fills who/food/budget).
- Sections: **About you** (Name + Hometown, required) · **Who usually travels** (partner toggle, a children repeater with ages [add/remove], an "anyone else" field for grandparents) · **Food** (Vegetarian / Vegan / Indian-matters toggles; vegan implies vegetarian) · **Budget tier** (Value / Comfort / Luxury segmented selector) · **Loyalty programmes** (multi-select chips; "No preference" clears the others) · **Freestyle notes** (textarea).
- **Inline validation on blur** (not on submit): required fields flag red with an error line; valid fields get a success border.
- Submit CTA: "Save my profile" → success toast.
- Visually continuous with the chat (same top bar, type, color) — not a jarring context switch.

### 9. Interaction States — `Interaction States.html`
Every component ships with four states:
- **Loading (skeleton):** the recommendation card as a shimmering skeleton in the real card's exact proportions (no layout shift on arrival) under a cycling research-status pill. **Skeletons over spinners for cards.** Shimmer animation gated on reduced-motion.
- **Error (warm, never raw):** an *inline chat error* in the concierge's voice ("Hmm — I lost my footing for a second… That's on me, not you. Give me another go?") with a Try-again; and a *card-level error* ("I couldn't load this one") with Retry + Skip. No codes, no stack traces, no dead ends.
- **Empty (always a next step):** the shortlist empty state, and a no-results state that reframes rather than dead-ends ("Nothing cleared my bar. Loosen one and I'll find you something I'd genuinely stand behind." → "Adjust the brief").

---

## Interactions & Behavior (summary)

- **Streaming:** word-by-word reveal, blinking caret, scroll pinned to bottom, no reflow.
- **Typing indicator:** 3-dot blink before each assistant message.
- **Form-switch:** opens the profile form as an overlay; saving returns data to the chat + brief rail.
- **Hard gate:** firm-but-warm pushback when destination/trip-type missing (normal text, not a flag color).
- **Card expand/collapse:** standard cards expand to the full Top Pick layout in place.
- **Save → shortlist:** opens the panel; save buttons toggle to a "Saved" state; counts sync.
- **Share:** copies a link, shows a transient success state.
- **Action bar escape hatch:** always focuses the composer — never a dead end.
- **Responsive:** desktop ≥1280 (chat column + brief rail + right shortlist), tablet 768 (rail → toggle), mobile 375 (single column, category grid + CTAs stack, shortlist → bottom sheet, composer pins above keyboard). Every component must work at 375px.

## State Management (what the implementation needs)

- **Conversation:** ordered message list (role, content, streaming flag), typing/researching booleans, current onboarding/brief phase.
- **Family profile:** name, hometown, partner bool, children[] (name?, age), others (free text), food flags (veg/vegan/indianMatters), budget tier, loyalty[] (multi), notes. Validation state per required field.
- **Trip brief:** destination, dates, tripType, who, budget, food (fixed essentials) + preferences[] (freeform chips). Derived: coreReady (4 essentials) → enables "Find hotels".
- **Recommendations:** list of hotels (id, name, area, tier, stars, loyalty, verdict, categories[], flag {level: amber|red, label, text} | null), which is the top pick, expanded state per standard card.
- **Shortlist:** Set of saved hotel ids; panel open/closed; share-copied transient.
- **UI overlays:** brief rail open (mobile), shortlist open, profile-form overlay open, action-bar visible.

## Assets

- **No real photography is included** (the brief forbids AI-generated hotel images). Every image is an elegant placeholder: a `.photo-slot` element (subtle diagonal hatch + a mono caption naming the shot, e.g. "resort hero · pool & beach"). **Replace these with real, licensed hotel photography** in production — keep the same aspect ratios and the scrim treatment.
- **Icons:** Lucide (`lucide` / `lucide-react`), outline, 1.75 stroke.
- **Fonts:** Newsreader, Geist, Geist Mono (Google Fonts; imported at the top of `tokens.css`).
- **Google "G" logo:** provided as inline SVG in `Home Page.html` — replace with the official Google sign-in asset / your auth provider's button component in production.

## Files in this bundle

**Design system / tokens (drop-in):**
- `tailwind.config.js` — complete Tailwind theme (colors, type, spacing, radius, shadow, motion) + `brandThemes` export
- `tokens.css` — the same tokens as CSS custom properties; **every prototype imports this**
- `brand-themes.css` — runtime `[data-brand]` accent switching
- `Design System.html` — visual reference for all tokens

**Screens (design references):**
- `Home Page.html` — landing + sign-in + showcase carousel
- `HotelZippo Prototype.html` — **the hero**: full flow (onboarding → brief rail → inline cards → shortlist → action bar → profile-form overlay)
- `Chat - Empty State.html` — welcome state in isolation
- `Chat - Active & Streaming.html` — streaming conversation in isolation
- `Top Pick Card.html` — final Top Pick card in isolation
- `Recommendation Set.html` — Top Pick + 2 collapsible standard cards (incl. red-flag case)
- `Hard Flag - Inline Message.html` — standalone hard-flag chat message
- `Family Profile Form.html` — opt-in structured form
- `Interaction States.html` — skeleton / error / empty states

**Note:** open any HTML file directly in a browser to see it live. The prototypes use vanilla JS + Lucide via CDN; the chat prototype auto-plays its scripted flow on load (Replay button to repeat).

---

## Hard Constraints (do not violate)

1. Hard-flag alerts are **always amber or red** — never grey, never muted, never collapsed/dismissed, always above the fold.
2. The Top Pick card must be **visually unmistakably** different from standard cards (border, shadow, size, badge).
3. **No AI-generated hotel images** — real photography only; placeholders must be elegant, never broken.
4. **Streaming text must not reflow** as content arrives.
5. The **escape hatch** ("Tell me what you want to do") must always be accessible.
6. It must work for **a 43-year-old in Mumbai on a phone** — not just on a designer's desktop. Every component works at 375px.
