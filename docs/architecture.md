# Architecture Overview

> Derived from Notion **06 · System Overview** (canonical). Notion is the briefing; this doc is the in-repo summary. If this diverges from 06, 06 wins — update Notion first, then this doc.

## What HotelZippo is

An AI agentic travel platform that finds the right hotel for **Indian families travelling with young children** to five Asian destinations (Phuket, Hong Kong, Singapore, Maldives, Bali). It replaces ~30–40 hours of fragmented research with a single confident recommendation, backed by AI-synthesised family reviews. The experience is fully **conversational** — no search results pages, no filters, no ranked lists.

**Benchmark failure case:** *Holiday Inn Karon, Phuket* — looks fine on paper, fails families on arrival. Every recommendation must make this outcome impossible. Hard flags (structural/refurbishment/maintenance issues) must always surface prominently and never be diluted.

## Three layers, one data store

```
┌─────────────────────────┐     ┌─────────────────────────┐     ┌─────────────────────────┐
│ Review Intelligence      │     │ Conversation platform    │     │ Booking handoff          │
│ (08a) — Phase 6          │     │ (08b) — Phases 2,3,5     │     │ (08c) — Phase 7          │
│                          │     │                          │     │                          │
│ Offline batch.           │     │ Online, real-time,       │     │ On-demand.               │
│ Separate Node/TS worker. │     │ user-facing.             │     │ RouteStack MCP handoff.  │
│ Manual admin trigger     │     │ Vercel AI SDK chat.      │     │ "Proceed to book".       │
│ (cron deferred post-v1). │     │ Onboarding, trip brief,  │     │ Thin wrapper.            │
│ Scrape→tag→synthesise→   │     │ recommendation assembly. │     │                          │
│ store.                   │     │                          │     │                          │
└───────────┬──────────────┘     └───────────┬──────────────┘     └───────────┬──────────────┘
            │                                 │                                │
            └─────────────────────────────────┴────────────────────────────────┘
                                              │
                                  ┌───────────▼───────────┐
                                  │  Supabase (PostgreSQL) │
                                  │  Mumbai region          │
                                  │  10 core tables +       │
                                  │  curation_hotels staging│
                                  └────────────────────────┘
```

| Agent | Type | Trigger | Responsibility |
|---|---|---|---|
| Review Intelligence (08a) | Batch, offline (Node/TS worker) | Manual admin UI (v1); cron post-v1 | Scrape → segment → synthesise → store |
| Conversation (08b) | Real-time, online | User session | Onboarding, trip brief, recommendations |
| Booking (08c) | On-demand | "Proceed to book" | RouteStack MCP handoff |

## Data flow

The Review Intelligence worker populates `raw_reviews` (permanently accumulated, deduped, carries `pipeline_run_id`) and `hotel_intelligence` (replaced per run). The **Conversation Agent reads only cached `hotel_intelligence`** — never `raw_reviews` at request time — and assembles 2–3 recommendations live against the user's trip brief + family profile. The Booking Agent hands a selected hotel off to RouteStack MCP on demand.

## The recommendation runtime (two steps, server-side only)

Defined in **08b-6**. When the Conversation Agent has confirmed destination + trip type, it calls the `assemble_recommendations` tool → `/app/api/recommendations/assemble`:

1. **Candidate query** (deterministic; consumption contract from 08a-5, implemented in `/lib/review-intelligence/query.ts`): query `hotel_intelligence` joined to `hotels` for the destination → exclude `review_count_total = 0` and `low_confidence = true` → branch on `evaluate_only` → apply budget→price_tier map → drop hotels whose `family_signal_strength` is `none` across all four categories → sort by `review_count_family` desc → **take top 15**.
2. **Assembly LLM call** (08b-2 prompt): invoke server-side with `family_profile`, `trip_brief`, and ≤15 candidate records → parse JSON (malformed → fail per 14, never a partial result).

The agent wraps the returned JSON in one sentence before/after (08b-1) and the frontend renders it as inline cards (05), hydrating display-only hotel metadata by `hotel_id`. The two-step design keeps the LLM focused on judgement over a clean ≤15-record set and keeps `raw_reviews` and `low_confidence` hotels out of the model entirely.

## Tech stack

| Layer | Choice |
|---|---|
| Frontend | Next.js (App Router) |
| Hosting | Vercel |
| Database | Supabase (PostgreSQL, Mumbai region) |
| Auth | Supabase Auth + Google OAuth (Phase 4) |
| AI model | `claude-sonnet-4-6` (Anthropic API) |
| Conversational UI | Vercel AI SDK |
| Scraping | Apify (Playwright fallback) |
| Booking | RouteStack MCP |
| Instrumentation | OpenTelemetry (OTEL), initialised in `instrumentation.ts` |
| Observability | Dash0 |

## Key architecture decisions

1. **Multi-agent, not single agent** — pipeline and conversational interface are architecturally separated.
2. **Pre-cached intelligence, not live review processing** — the Conversation Agent queries structured `hotel_intelligence` only.
3. **Live recommendation assembly** — the final 2–3 matches are assembled at request time.
4. **Apify for scraping (pilot)** — graduate to official APIs post-pilot.
5. **Vercel AI SDK** for the conversational UI.
6. **Session snapshots, not full replay** — compressed context in `sessions`.
7. **Supabase as single source of truth** — no fragmented storage.
8. **Manual pipeline trigger for v1** — admin UI; automated cron deferred post-v1.

## Server-side boundary (absolute — see 13)

All AI inference and all service-role DB access are **server-side only**. `ANTHROPIC_API_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are never referenced in client code. `NEXT_PUBLIC_` is the only browser-safe prefix.

## Cross-references

- Data model → [`docs/data-model.md`](./data-model.md) (canonical: Notion 07)
- Glossary → [`docs/glossary.md`](./glossary.md)
- Spec coverage → [`docs/spec-coverage.md`](./spec-coverage.md)
- Build sequence → Notion 11 · entry point & hard rules → Notion CLAUDE.md
