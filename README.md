# HotelZippo

An AI concierge that finds the right hotel for Indian families travelling with young children across five Asian destinations (Phuket, Hong Kong, Singapore, Maldives, Bali). It replaces hours of fragmented research with a single confident recommendation, backed by AI-synthesised family reviews — and never buries a hard flag.

## Stack
Next.js (App Router) · Tailwind CSS **v3** · Supabase (Postgres, Mumbai) · Anthropic Claude · Vercel AI SDK · Apify · RouteStack MCP · OpenTelemetry → Dash0. Hosted on Vercel.

## Documentation
- **Specs (contracts):** [`/specs`](./specs) — generated from the Notion build spine 01–16. Notion is the briefing + source of truth; `/specs` is the in-repo contract.
- **Docs:** [`/docs`](./docs) — [architecture](./docs/architecture.md), [data model](./docs/data-model.md), [glossary](./docs/glossary.md), [spec coverage](./docs/spec-coverage.md).
- **Design system (locked):** [`/design_handoff`](./design_handoff) — tokens, Tailwind config, prototypes.
- **Workflow:** [`CONTRIBUTING.md`](./CONTRIBUTING.md) — branching, commits, the PR merge gate.

## Getting started
```bash
npm install
cp .env.example .env.local   # fill in values — see specs/13-environment.md
npm run dev                  # http://localhost:3000
```

## Scripts
| Script | Purpose |
|---|---|
| `npm run dev` | Dev server |
| `npm run build` | Production build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | Next/ESLint |
| `npm run test` | Jest (unit / contract / smoke) |

## Build phases
0 Scaffold · 1 Data · 2 Recommendation engine · 3 Conversational UI · 4 Auth · 5 Session memory · 6 Review pipeline · 7 Booking · 8 Polish. See [Notion 11 · Build Sequence] and [`docs/spec-coverage.md`](./docs/spec-coverage.md). **Current: Phase 0.**
