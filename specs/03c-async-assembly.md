# 03c · Async Recommendation Assembly (job + polling + staged progress)

- **Notion:** extends 03b (Recommendation Flow & Card Contract) · 08b-2 (Assembly Prompt) · 08b (Conversation Agent). **Phase:** post-v1 robustness. **Status:** BUILT (branch `feat/async-assembly`) — gated by `ASYNC_ASSEMBLY=1`, off by default. Migration 0018 + job-ledger + worker route + poll route + progress UX + reload re-attach + stuck-job reclaim. Verified locally end-to-end (chat turn returns ~170ms; worker assembles off the chat budget; poll surfaces cards).
- **Cross-refs:** 03b · Recommendation Flow · 08b · Conversation Agent · 08b-2 · Assembly · 07 · Data Model (`recommendation_jobs` new) · 12h · Apify Run Ledger (the job-ledger pattern reused) · 13 · Environment · 14 · Error Handling/OTEL · 15 · Test Strategy.

> **Why.** Recommendation assembly is a slow LLM call (measured 2026-06-30: ~34s Sonnet, ~14–17s Haiku for 3 candidates; prod has 15 → larger). It runs **inline inside the `/api/chat` turn**, which on Vercel Hobby has a **hard 60s wall-clock cap**. A slow assembly rides that cap → `Task timed out after 60 seconds`, the stream is dropped mid-flight, and the user gets **nothing** — no cards, no error, no recovery (the client has no reconnect; the busy-guard never clears). The Haiku swap (PR #70) bought headroom but did **not** make the system robust: it's still one long synchronous request with a single point of failure and no progress feedback. This spec makes assembly **asynchronous, durable, and observable to the user**.

## Goals / non-goals

**Goals**
- Assembly survives a slow model call **without** the chat function hitting its 60s cap.
- The user sees **honest, advancing progress** while it runs ("Finding hotels… → Checking review intelligence… → Writing your recommendations…").
- A dropped connection / page reload **recovers** — the job persists; the user re-attaches and still gets their cards.
- Reuse the **proven `apify_runs` ledger pattern** (12h) — no new external infra, works on **Hobby today**.
- The recommendation **output is persisted** (a side-benefit: a `recommendation_jobs` row holds the result), enabling idempotent re-attach and future history.

**Non-goals (v1 of this spec)**
- No Vercel plan upgrade, no external queue (Inngest/QStash), no `waitUntil`/Cron. (Listed as alternatives below; chosen approach is DB-job + client polling — founder decision 2026-06-30.)
- No change to the assembly *prompt* or the card *contract* (03b/08b-2 unchanged).
- No speculative/pre-emptive assembly (only runs on an explicit recommendation turn).

## Architecture — DB job + polling (the `apify_runs` pattern, applied to assembly)

Today (synchronous): `chat turn → tool execute → runAssembly (≤60s budget, model call inline) → cards in the same stream`.

New (async):
```
1. Chat turn: the assemble_recommendations tool does NOT run the model. It
   CREATES a recommendation_jobs row (status=pending, input = {trip_brief,
   family_profile hash, destination}) and returns { jobId, status:'started' }
   to the agent → the agent emits a staged-progress chunk and ends the turn FAST
   (well under 60s — no model call on this path).

2. Worker step: a short server route POST /api/assembly/run advances ONE job:
   pending → running → (queryCandidates → assembleRecommendations → hydrate) →
   succeeded(result) | failed(reason). Each invocation has its OWN 60s budget,
   fully isolated from the chat function. Kicked off best-effort by the chat
   turn (fire-and-forget fetch) AND idempotently re-kicked by the poll route, so
   a missed kick still runs.

3. Client poll: while a job is pending/running, the client polls
   GET /api/assembly/:jobId every ~2s. The response carries the current stage →
   the chat renders an advancing status line. On succeeded → the result (already
   hydrated) is rendered as the recommendation-set cards. On failed → a warm
   conversational fallback (spec 14).
```

This mirrors `apify_runs`: a ledger row with a status lifecycle, `createRun`/`markRunning`/`markStatus` equivalents, a concurrency guard, and start-decoupled-from-consume. The worker route is the analogue of the curation `run/status`+`run/ingest` step.

### Why polling (not SSE/streaming the job)
The existing chat transport is NDJSON-over-one-request, which is exactly what breaks at 60s. A **separate, short poll request** every ~2s each completes in well under a second, never approaches any cap, and is **reconnect-free by construction** (each poll is independent; a dropped poll just retries next tick). The job row is the single source of truth, so a reload re-attaches by `jobId`.

## Data model — `recommendation_jobs` (migration, 07)

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | the `jobId` |
| `user_id` | uuid (nullable) | owner; nullable for anon/dev. **owner-read RLS** `auth.uid() = user_id` (mirrors `booking_orders`) so a user can only poll their own job |
| `trip_brief_id` | uuid (nullable, FK) | links to the turn's trip brief when available |
| `destination` | text | for display + the reuse key |
| `input_hash` | text | stable hash of {destination, trip_type, budget, food, candidate-set key} — the **idempotency/reuse key** (so a repeat identical turn re-attaches instead of re-spending) |
| `status` | text | `pending → running → succeeded \| failed` (CHECK constraint) |
| `stage` | text | `queued \| finding_hotels \| checking_intelligence \| writing \| done` — drives the progress UX |
| `result` | jsonb (nullable) | the **hydrated** assembly output (the exact `recommendation-set` props) on success |
| `error_kind` | text (nullable) | warm error kind on failure (spec 14: `no_eligible_hotels \| model_failed \| timeout \| unknown`) |
| `attempts` | int default 0 | retry guard (worker bumps; cap at e.g. 2) |
| `created_at` / `started_at` / `finished_at` | timestamptz | lifecycle stamps |

- **Service-role writes only** (the worker route uses the service client); **owner-read SELECT** so the client poll (anon/cookie client) can read its own job under RLS — same split as `booking_orders` (07).
- `input_hash` + a recency window = the **reuse guard** (don't re-run an identical assembly within N minutes; re-attach to the existing succeeded/running job). Optional in v1-of-build but cheap.
- **NO `import 'server-only'`** on the job-ledger lib (`lib/recommendations/job-ledger.ts`) — same as `lib/apify/run-ledger.ts`, so a tsx/worker context can use it. The assembly call itself (`assemble.ts`) keeps its lazy Anthropic import + server-only; the worker ROUTE imports it (route context, fine).

## Protocol — staged progress chunks (08b / types)

Extend the `StreamChunk`/component registry (`lib/chat/types.ts`) minimally:
- The `assemble_recommendations` tool result becomes `{ result: 'assembly_started', jobId, stage:'queued' }`. The agent narrates a short "let me pull those together" line and the route emits a new **`{ type:'component', component:'assembly-progress', props:{ jobId, stage } }`** chunk (reuses the existing `ComponentChunk` envelope; add `'assembly-progress'` to `ComponentName`).
- The client renders an `AssemblyProgress` component for that part. A `useAssemblyJob(jobId)` hook polls `GET /api/assembly/:jobId`; each response updates the part's `stage` (advancing status line), and on `succeeded` it **replaces** the progress part with the `recommendation-set` cards (from `result`), or on `failed` swaps to the warm fallback text.

**Stage → copy** (honest, advances; never fabricates a step that didn't run):
| stage | line |
| --- | --- |
| `queued` / `finding_hotels` | 🔍 Finding family-friendly hotels in {destination}… |
| `checking_intelligence` | 📊 Checking the review intelligence… |
| `writing` | ✍️ Writing your recommendations… |
| `done` | → cards render |

## Routes

| Route | Method | Auth | Job |
| --- | --- | --- | --- |
| `/api/assembly/run` | POST `{ jobId }` | service (internal kick) | Advance ONE job a step: claim `pending`→`running` (atomic), run query→assemble→hydrate, write `succeeded(result)`/`failed`. Idempotent: a job already `running`/terminal is a no-op. Own 60s budget. |
| `/api/assembly/:jobId` | GET | **owner-read RLS** | Return `{ status, stage, result?, error_kind? }`. Also best-effort **re-kicks** `/api/assembly/run` if the job is still `pending` (covers a missed initial kick) — so progress never stalls. |

The chat tool creates the job + fires a best-effort `POST /api/assembly/run` (fire-and-forget, never blocks the turn). If that kick is lost, the first client poll re-kicks. (On Hobby there's no `waitUntil`, so the kick is a plain `fetch` we don't await — acceptable because the poll route is the reliable backstop.)

## Error handling (14)

- **Model timeout / failure** → job `failed(model_failed)` → poll returns it → chat speaks a warm retry ("I had trouble pulling those together — want me to try again?"). The 45s assembly timeout (already shipped) bounds the worker step under its own 60s budget.
- **No eligible hotels / preview-seeding** → reuse the existing `no_eligible_hotels` / `preview_seeding` results as terminal job states with their existing copy (this spec doesn't change that logic, just moves *where* it runs).
- **Stuck job** (worker died mid-run) → `attempts`+a `running`-age check lets the poll route re-claim a stale `running` job once; after the cap → `failed`. No infinite spin.
- **Hard-flag invariant preserved** — assembly output is unchanged; run the existing `hard-flag-audit` over the persisted `result` so a flag dropped by the model is caught the same as today (15).

## Observability (14)

- OTEL span per worker step (`assembly.run`: jobId, destination, stage, model, candidates, duration, success/failure) — the worker route is the new traced boundary.
- The existing `DEBUG_BOOKING` timing logs move into the worker step (same marks: queryCandidates / assemble.model / done) so prod logs still pinpoint latency, now **off the chat critical path**.

## Build invariants (carry from prior phases)
- Injectable model seam preserved (`deps.callModel`) → contract tests + key-free CI unchanged (the worker route injects the real model; tests inject a fake).
- Job-ledger lib has **no** `server-only` (tsx-safe, like `run-ledger.ts`); routes own the Anthropic import.
- Client poll uses the anon/cookie Supabase client under **owner-read RLS** (a user can't poll another user's job); the worker uses the service client.
- Lazy env; no NEXT_PUBLIC_ leakage; graceful warm errors, never a dead-end.

## Scope

| In scope (v1) | Out of scope (deferred) |
| --- | --- |
| `recommendation_jobs` table + owner-read RLS (migration, 07) | Vercel plan upgrade / `maxDuration>60` / `waitUntil` / Cron |
| `lib/recommendations/job-ledger.ts` (create/claim/markStage/markResult; no server-only) | External queue (Inngest/QStash) — listed as the scale-out path |
| `/api/assembly/run` worker step (own 60s budget) + `/api/assembly/:jobId` poll (owner-read, re-kick) | Pre-emptive/speculative assembly |
| Async path in the `assemble_recommendations` tool (create job + fire kick, return fast) | Changing the assembly prompt or card contract (03b/08b-2) |
| `assembly-progress` component + `useAssemblyJob` poll hook + staged copy | A full `/recommendations` history page (the job rows make it possible later) |
| Reconnect/reload re-attach by `jobId`; reuse guard via `input_hash` | Streaming partial cards as they assemble (one model call → one result) |
| OTEL `assembly.run` span; DEBUG_BOOKING moved to the worker | |

## Acceptance criteria (15)

- **AC1 — turn never blocks on the model.** A recommendation turn returns (job created + progress chunk) in well under 60s regardless of model latency; the chat function never makes the assembly model call inline.
- **AC2 — staged progress.** The client shows an advancing status line (finding → checking → writing) driven by the job `stage`, then swaps to the `recommendation-set` cards on success.
- **AC3 — durability / reconnect.** Killing the page mid-assembly and reloading re-attaches to the same `jobId` and still renders the cards when the job finishes (the job row is the source of truth).
- **AC4 — warm failure.** A `failed` job surfaces the spec-14 warm fallback in chat (retry offered), never a dropped stream or a raw error.
- **AC5 — no double-spend.** Two identical recommendation turns within the reuse window re-attach to one job (one model call), proven by the `input_hash` guard + `attempts`.
- **AC6 — invariants.** Hard-flag audit passes over the persisted `result`; owner-read RLS proven (user A cannot poll user B's job); key-free CI green (model seam injected).
- **Test type:** unit/jsdom (job-ledger state machine, `useAssemblyJob` poll reducer, progress component states, the tool's create-job branch) + node integration (worker route advances a seeded job to succeeded; owner-read RLS isolation; reuse guard) — all key-free (fake model injected).

## Alternatives considered (recorded, not chosen)

1. **Vercel Pro + `maxDuration=300`** — simplest code (keep synchronous, more headroom), but costs a plan upgrade, is still one long request (a disconnect loses everything), and gives no progress granularity. Rejected for v1 (founder: stay on Hobby; want resilience + progress).
2. **External queue (Inngest / Upstash QStash / dedicated worker)** — most robust + retries + scale, but adds an external dependency to run/pay/operate. This spec's DB-job pattern is the **same shape**, so migrating to a queue later is a worker-host swap, not a redesign. Recorded as the scale-out path.

## Claude Code Action Items

1. **Confirm this plan with the founder** (this spec) — esp. the DB-job-vs-Pro-upgrade choice and the staged-progress copy.
2. **Slice 1 — ledger + worker:** migration `recommendation_jobs` (07) + `lib/recommendations/job-ledger.ts` (no server-only) + `/api/assembly/run` (claim+run+persist, own budget) + unit/integration tests (seeded job → succeeded; injected fake model; RLS isolation).
3. **Slice 2 — async tool + poll + UX:** flip the `assemble_recommendations` tool to create-job-and-return-fast + fire the kick; `assembly-progress` chunk/component + `useAssemblyJob` poll hook + staged copy; `/api/assembly/:jobId` poll route (owner-read + re-kick); reconnect/reload re-attach. E2E journey (J2 variant: progress → cards).
4. **Slice 3 — hardening + docs:** reuse guard (`input_hash`), stuck-job reclaim, OTEL `assembly.run` span, move DEBUG_BOOKING into the worker; sync 03b/08b/07/13/15 + Notion + `.env.example`.
5. **PAUSE for founder review** after the spec + Notion, before building — per the standing spec-first cadence.
