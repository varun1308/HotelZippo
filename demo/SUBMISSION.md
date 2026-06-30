# HotelZippo — Contest Submission Write-up

> *An AI concierge that finds the right hotel for Indian families travelling with young children — and never buries a dealbreaker.*

---

## The 30-second version (for the submission form)

**HotelZippo** replaces the 30–40 hours of fragmented research a family does across TripAdvisor, Google Maps, YouTube and hotel sites with **one conversation**. You tell an AI concierge who's travelling and where; it asks the right questions, builds a complete picture of your family, and returns a single confident recommendation — backed by guest reviews **synthesised by AI into family-specific intelligence**, not a wall of links. Its defining trait: it **never buries a "hard flag."** When a hotel has a real problem (an active refurbishment, a safety concern), the warning is surfaced in red, above everything else — even on the top pick. Honesty over polish. Then it takes you straight to booking. Built as a fully agentic, conversational web app — no search results pages, no filter panels.

---

## The problem

Planning a family trip is uniquely painful for parents of young kids. A hotel that's perfect for a couple can be wrong for a family of six travelling with a 2-year-old and grandparents — the pool may be too deep, the "kid-friendly" label may be marketing, the great reviews may all predate a refurbishment. Families end up spending **30–40 hours** stitching together TripAdvisor, Maps, YouTube walkthroughs and forum threads, and *still* book with anxiety. The information exists; it's just scattered, generic, and never filtered for *this* family's needs.

## The solution

HotelZippo is an **AI agentic travel concierge**. The entire experience is a conversation:

1. **Conversational onboarding.** No forms (one is offered as an opt-in). The concierge asks one question at a time, acknowledges each answer, and pushes back warmly when you're too vague — then captures everything into a live **Trip Brief** (destination, dates, who's travelling, food needs, budget, plus freeform preferences).
2. **AI-synthesised review intelligence.** Behind the scenes, real guest reviews are scraped and **synthesised by Claude** into family-relevant signal — what the rooms, food, facilities and location are actually like *for a family with young kids* — instead of an average star rating.
3. **One confident recommendation.** The concierge returns a clear **top pick** plus 1–2 alternatives as rich cards **inline in the chat**, each with a plain-language "why this one" verdict and a 2×2 breakdown (Rooms / Facilities / Food / Location).
4. **The hard flag — the trust differentiator.** If a hotel has a genuine problem, a **hard-flag alert** (amber = moderate, red = severe) is rendered **above the fold, before any positive content, and it cannot be dismissed** — even on the #1 pick. This is the product's soul: it would rather tell you the uncomfortable truth than make a polished sale.
5. **Shortlist → booking.** Save hotels to a shortlist, share with a partner, and proceed to a **real booking handoff** — all without leaving the conversation.

## Why it's genuinely "AI" and agentic

- **Agentic conversation loop** — built on the Vercel AI SDK with Claude doing tool-calling: it decides when it has enough context, calls a recommendation tool, assembles results, and narrates them back in the concierge's voice.
- **AI review synthesis is the moat** — Claude transforms hundreds of raw reviews per hotel into structured, family-specific intelligence (including the hard flags), not a generic summary.
- **Async assembly architecture** — recommendation assembly runs as a durable background job with client polling and staged progress, so a heavy multi-hotel model call never blocks the chat.
- **Honest by construction** — the hard-flag rule is enforced from the synthesis output all the way to the rendered card (verified in CI), so a real warning can never be silently dropped on the way to the user.

## What's real (not a mockup)

- **Live, deployed product** on Vercel + Supabase (Postgres in Mumbai), Google-authenticated.
- **Real data pipeline:** guest reviews via Apify, place resolution via Google Places, intelligence synthesis via Claude — curated through an admin pipeline into a published hotel set.
- **Real booking integration** via the RouteStack hotel API (deep-link handoff + order-lifecycle webhooks that track a booking from pending to confirmed).
- **Tested:** unit + contract + integration + Playwright end-to-end suites across the critical journeys, with the hard-flag survival asserted in CI.
- **Design-system-driven:** a locked token set (terracotta brand, Newsreader serif "voice"), fully mobile-responsive — built for "a 43-year-old in Mumbai on a phone," not just a designer's desktop.

## Tech stack

**Next.js (App Router)** · **Tailwind CSS** · **Supabase** (Postgres + Storage + RLS) · **Anthropic Claude** (concierge + review synthesis) · **Vercel AI SDK** (streaming, tool use) · **Apify** (review scraping) · **Google Places** · **RouteStack** (booking) · **OpenTelemetry → Dash0** (observability). Hosted on **Vercel**.

## The 60-second demo shows

The landing page → a real conversation about a vegetarian family trip to Phuket with kids and grandparents → the Trip Brief filling in live → one confident top-pick recommendation backed by synthesised family reviews → **the red hard-flag surfaced above the fold** → save to shortlist → the booking handoff. From a single question to a booking you can trust, in under a minute.

---

*HotelZippo — the family travel concierge.*
