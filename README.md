# HotelZippo

An AI concierge that finds the right hotel for Indian families travelling with young children across five Asian destinations (Phuket, Hong Kong, Singapore, Maldives, Bali). It replaces hours of fragmented research with a single confident recommendation, backed by AI-synthesised family reviews — and never buries a hard flag.

## Stack
Next.js (App Router) · Tailwind CSS **v3** · Supabase (Postgres, Mumbai) · Anthropic Claude · Vercel AI SDK · Apify · RouteStack MCP · OpenTelemetry → Dash0. Hosted on Vercel.

## Documentation
- **Specs (contracts):** [`/specs`](./specs) — generated from the Notion build spine 01–16. Notion is the briefing + source of truth; `/specs` is the in-repo contract.
- **Docs:** [`/docs`](./docs) — [architecture](./docs/architecture.md), [data model](./docs/data-model.md), [glossary](./docs/glossary.md), [spec coverage](./docs/spec-coverage.md).
- **Design system (locked):** [`/design_handoff`](./design_handoff) — tokens, Tailwind config, prototypes.
- **Workflow:** [`CONTRIBUTING.md`](./CONTRIBUTING.md) — branching, commits, the PR merge gate.

## Running it locally

There are two tiers — pick what you need.

### Tier 1 — just the UI (no env, no database, no API key)
```bash
npm install
npm run dev          # http://localhost:3000
```
`/` (landing) and `/chat` render immediately. The chat shell, composer, and the **trip-brief rail** all work — the rail even fills in as you type (a deterministic client-side detector reads your own messages). Nothing calls the database or Claude on page load, so missing env never breaks the render.

**What you _can't_ do at this tier:** get an actual hotel recommendation. Sending a message that asks for one will fail *gracefully* (a warm "Hmm — I lost my footing…" message; the page never crashes), because the recommendation tool needs Supabase + an Anthropic key.

### Tier 2 — full chat with real recommendations
Prerequisites: **Docker**, the **Supabase CLI**, and an **Anthropic API key**.

1. **Start local Supabase** (boots Postgres + Storage; applies the migrations in `supabase/`):
   ```bash
   supabase start
   ```

2. **Create `.env.local`** (git-ignored — never commit it). Grab the local Supabase values from `supabase status -o env`:
   ```bash
   NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
   NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key from `supabase status -o env`>
   SUPABASE_SERVICE_ROLE_KEY=<service_role key from `supabase status -o env`>
   ANTHROPIC_API_KEY=<your key — server-side only, never exposed to the browser>
   ```
   > The Supabase local keys are well-known dev defaults (the same ones in `.env.test`), not secrets. `ANTHROPIC_API_KEY` **is** a secret — keep it only in `.env.local`.

3. **Run the app:**
   ```bash
   npm run dev
   ```

4. **Sign in without Google (local dev).** Since Phase 4, `/chat` is hard-gated by auth — production uses **Google only**, but you don't need Google credentials to develop. Enable the local email/password path instead:
   ```bash
   # in .env.local (local only — NEVER set this in production):
   NEXT_PUBLIC_ENABLE_DEV_LOGIN=true
   ```
   Then seed a local dev user (uses the service role against local Supabase; the `on_auth_user_created` trigger creates its `public.users` row, exactly like a real first sign-in):
   ```bash
   npm run dev:user                      # dev@hotelzippo.local / dev-password-123!
   # or: npm run dev:user -- you@x.test yourpassword
   ```
   Restart `npm run dev` (so the `NEXT_PUBLIC_*` flag is picked up), open [`/`](http://localhost:3000), and use the **"Dev sign-in"** box below the trust row → it signs you in and lands on `/chat`. The Google button stays the only auth in production (the dev box renders **nothing** without the flag, and `dev:user` refuses any non-local Supabase URL).
   > Prefer no auth at all? Unset `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` and the gate self-disables (`/chat` renders, but persistence + booking no-op / 401 — UI-only).

5. **Seed demo hotel data.** v1 ships demo intelligence for **Phuket and Bali only** (5 hotels each). The pipeline is fetch → approve → publish → seed. Easiest via the admin UI at [`/admin/curation`](http://localhost:3000/admin/curation), or with curl (replace `$SR` with your service-role key):
   ```bash
   SR=<service_role key>; BASE=http://localhost:3000
   # 1. fetch candidates into the curation staging table (mock source = the bundled fixtures)
   curl -s -X POST $BASE/api/admin/fetch-hotels -H 'content-type: application/json' -d '{"destination":"Phuket"}'
   curl -s -X POST $BASE/api/admin/fetch-hotels -H 'content-type: application/json' -d '{"destination":"Bali"}'
   # 2. approve the candidates with >=100 reviews (set each staged row's status to "approved"
   #    via PATCH /api/admin/hotels {id,status:"approved"} — or click Approve in /admin/curation)
   # 3. publish approved rows into public.hotels (downloads each hero image into Storage)
   curl -s -X POST $BASE/api/admin/publish-hotels -H 'content-type: application/json' -d '{}'
   # 4. seed the AI review intelligence for the published hotels
   curl -s -X POST $BASE/api/admin/seed-intelligence -H 'content-type: application/json'
   ```

6. **Chat.** Open [`/chat`](http://localhost:3000/chat) and ask for, e.g., *"a vegetarian family resort trip to Phuket in December"* → a recommendation set renders inline (top pick + alternatives, with any hard flag surfaced above the fold).

### Troubleshooting
| Symptom | Cause |
|---|---|
| `/chat` redirects back to `/` | Not signed in (the Phase 4 auth gate). Locally: set `NEXT_PUBLIC_ENABLE_DEV_LOGIN=true`, run `npm run dev:user`, and use the **Dev sign-in** box (see step 4). |
| **Dev sign-in** box doesn't appear on `/` | `NEXT_PUBLIC_ENABLE_DEV_LOGIN` isn't `true`, or `npm run dev` wasn't restarted after setting it (`NEXT_PUBLIC_*` is baked at build/start). |
| Chat says *"I lost my footing…"* | `ANTHROPIC_API_KEY` missing, or Supabase isn't running / `.env.local` Supabase keys are wrong. |
| Agent says it found *no hotels* for a destination | That destination isn't seeded — only **Phuket** and **Bali** ship demo records in v1. |
| `publish-hotels` returns hotels under `skipped` with *"hero image store failed"* | The source hero URL couldn't be fetched. Publish is **atomic** — those hotels are **not** written to `public.hotels` (no orphaned 0-image rows). Use reachable image URLs in the fixtures, or check your network. |
| Page renders but fonts look plain | Google Fonts CDN unreachable; the UI falls back to system fonts and stays legible. |

## Scripts
| Script | Purpose |
|---|---|
| `npm run dev` | Dev server |
| `npm run build` | Production build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | Next/ESLint |
| `npm run test` | Jest (all projects) |
| `npm run test:unit` | Unit / contract / smoke (jsdom — no DB) |
| `npm run test:integration` | Integration (node — needs local Supabase running) |

## Build phases
0 Scaffold · 1 Data · 2 Recommendation engine · 3 Conversational UI · 4 Auth · 5 Session memory · 6 Review pipeline · 7 Booking · 8 Polish. See [Notion 11 · Build Sequence] and [`docs/spec-coverage.md`](./docs/spec-coverage.md). **Current: Phases 0–3 complete** (the conversational UI runs end-to-end against seeded demo data); Phase 4 (auth) is next.
