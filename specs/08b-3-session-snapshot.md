# 08b-3 · Conversation Agent — Session Snapshot

- **Notion:** https://app.notion.com/p/3754958429ac814a8e99e6dc122ef7d0
- **Phase:** 5 · **Status:** SPECCED
- **Prompt artifact:** `/prompts/conversation-agent/session-snapshot.md`
- **Model:** `claude-sonnet-4-6`

> Production prompt for the Session Snapshot step. A one-shot generation that compresses a full conversation transcript into a dense plain-text summary, stored in `sessions.session_summary`, and injected into the Conversation Agent system prompt as `<session_snapshot>` on resumption so a returning user picks up exactly where they left off. **No schema change** — `sessions.session_summary text` + `sessions.last_active timestamptz` already exist (migration `0001_core_tables.sql`). Phase 5 builds the **generate + persist + load** sides; the **consumption seam already exists** (Phase 3).

## Runtime note (for engineers)

- Called as a **one-shot generation** at snapshot trigger points: **session end**, **30 min inactivity**, or **user navigation away**.
- Pass the **full conversation history as the user turn**.
- The output is stored as **plain text** in `sessions.session_summary`.
- It is injected into the Conversation Agent system prompt as **`<session_snapshot>`** on resumption.
- **Token budget:** under **400 tokens** preferred. **Hard ceiling: 500 tokens.**

## System prompt (verbatim)

```text
You are a session state compressor for HotelZippo. You receive a conversation transcript and produce a compact plain-text summary that allows the conversation to resume naturally without any repetition or loss of context.

Your output is injected directly into a system prompt. It must be plain text only — no JSON, no markdown, no headers, no bullet symbols. Write in clear, dense prose. Every word must earn its place.
```

## Your task (verbatim)

```text
Read the conversation transcript and produce a single plain-text block capturing the complete state of the session. A returning user should be able to pick up exactly where they left off. The concierge reading this snapshot should never need to ask the user for information that is already captured here.
```

## What to capture

Capture the following, **omitting any section for which no information exists**:

1. **Family profile state** — which fields are confirmed, with the **actual values** (not just field names). E.g.: "Name: Raj. Family: spouse + 2 kids (ages 2 and 7) + grandparents. Food: vegetarian. Budget: comfort. Brands: Marriott Bonvoy, Hilton Honors. Freestyle: wants kids club and pool quality confirmed, values vegetarian food for grandparents."
2. **Profile completion status** — state clearly whether the profile is **complete** (all required fields captured) or **partial**. If partial, name the specific fields still outstanding.
3. **Trip brief state** — which fields are confirmed, with actual values. E.g.: "Destination: Phuket. Trip type: resort-anchored. Dates: not provided. Focus areas: kids club, pool, vegetarian dinner options. Pre-shortlisted: none."
4. **Trip brief completion status** — state clearly whether the trip brief is **complete** (destination + trip type confirmed) or **partial**. If partial, name what is outstanding.
5. **Recommendations shown** — if recommendations were produced: name the top pick and other picks. **Note any hard flags that were surfaced.** Note whether the user reacted to the recommendations.
6. **User decisions and expressed preferences** — any constraints or preferences the user stated during the conversation that are **not** in the formal profile or trip brief. E.g.: "User said they don't want anything near the airport." "User liked the top pick but asked for a cheaper alternative." "User said they are travelling in October."
7. **Where the conversation was left** — one sentence: onboarding in progress / trip brief in progress / recommendations shown, awaiting user decision / user proceeding to booking / session ended without recommendation.

## Rules

- **Under 400 tokens preferred. 500 tokens is the hard ceiling.** If approaching the ceiling, compress ruthlessly — field names over sentences, values over explanations.
- Do **not** include any information that was not stated or confirmed in the conversation. Do **not** infer or assume.
- Do **not** reproduce full review text or hotel descriptions — these are available in the database and do not belong in the snapshot.
- Do **not** include conversational pleasantries, greetings, or any exchange that contains no state information.
- Write in the **third person**, referring to the user by their first name if captured, otherwise as "the user."

## Output format

Plain text, no formatting. Dense, factual, chronological within each section. Start directly with the content — no preamble, no label for the document itself.

Example structure (adapt to what actually occurred):

```text
Family profile — complete. Name: Raj. Family: spouse + 2 kids (ages 2 and 7) + grandparents travelling. Food: vegetarian. Budget: comfort tier. Brand preferences: Marriott Bonvoy, Hilton Honors. Freestyle: prioritises kids club quality, pool experience, and vegetarian dinner options for grandparents.

Trip brief — complete. Destination: Phuket. Trip type: resort-anchored. Dates: not provided. Focus areas: kids club, pool, vegetarian options at dinner. Pre-shortlisted hotels: none. Evaluate-only: false.

Recommendations shown. Top pick: [Hotel Name]. Other picks: [Hotel Name], [Hotel Name]. Hard flag surfaced on top pick: active refurbishment (moderate). User expressed interest in top pick but asked whether a cheaper alternative exists.

Conversation left at: post-recommendation, user considering alternatives.
```

## Resume UX (Phase 5 default — set 2026-06-05)

On return, an authenticated user **auto-resumes their most recent session**: the latest `sessions` row for the user (by `last_active`) is loaded and its `session_summary` injected as `<session_snapshot>`, so the concierge continues from where they left off with no repetition.

- **v1 has no multi-session picker or history UI** — one rolling resume per user. A session list/picker is a post-v1 candidate.
- If **no prior session** exists, onboarding **starts fresh**.
- This is the lean v1 default; revisit if multi-trip history becomes a need.

## Schema — no change needed

`sessions.session_summary text` + `sessions.last_active timestamptz` **already exist** (migration `0001_core_tables.sql`, "conversation snapshots for memory (Phase 5)"). Phase 5 does **not** alter the schema — it writes the snapshot to `session_summary`, touches `last_active`, and reads the latest row back.

## Consumption seam — already exists (Phase 3)

The `<session_snapshot>` consumption path was built in Phase 3 and is unit-tested. Phase 5 builds only the **generate + persist + load** sides that feed it:

- `lib/chat/build-system.ts` — `buildSystem(base, ctx)` injects `<session_snapshot>` (empty block signals a new user).
- `lib/chat/agent.ts` — `runConversation()` accepts `sessionSnapshot` and threads it into `buildSystem`.
- `app/api/chat/route.ts` — already threads `body.sessionSnapshot` into `runConversation`.

## Phase 5 acceptance criteria (→ 15)

- A snapshot is **written to `sessions.session_summary`** at each trigger point (session end / 30-min inactivity / navigation away).
- On return, the user **auto-resumes their most recent session** (latest `sessions` row by `last_active`), its `session_summary` injected as `<session_snapshot>` — concierge continues with no repetition.
- Output **respects the ≤500-token hard ceiling** (≤400 preferred).
- **Missing snapshot** (first session, no prior `sessions` row) is handled gracefully — onboarding **starts fresh**, no broken/blank state.
- The snapshot is **plain text** (no JSON, no markdown) and is injected as **`<session_snapshot>`**.

## Claude Code Action Items (from Notion)

1. Author the prompt at `/prompts/conversation-agent/session-snapshot.md` — the production prompt **verbatim** from this page (system prompt + your task + what to capture + rules + output format/example).
2. **Snapshot generator** — calls the prompt **one-shot** with the full conversation history as the user turn. **Injectable model** (default = Anthropic `claude-sonnet-4-6`, `ANTHROPIC_API_KEY` server-side only) so CI runs key-free, like the other prompts (08b-1 / 08b-2).
3. **Persist** the generated snapshot to `sessions.session_summary` (and touch `last_active`) at the **trigger points** — session end, 30-min inactivity, navigation away. No schema change.
4. **Resume loader** — fetch the **latest `sessions` row** for the user (by `last_active`) and thread its `session_summary` → the existing `sessionSnapshot` seam. **The consumption seam already exists** (`lib/chat/build-system.ts` injects `<session_snapshot>`; `lib/chat/agent.ts` `runConversation` accepts `sessionSnapshot`; `app/api/chat/route.ts` already threads `body.sessionSnapshot`) — Phase 5 builds the **generate + persist + load** sides only.
5. Tests per 15 (add the Phase 5 criteria above): snapshot written at trigger points, auto-resume of most recent session, ≤500-token ceiling, missing-snapshot fresh-start, plain-text + `<session_snapshot>` injection. Generator tests inject a fake model so CI runs with no key.

## Cross-references

04 · Auth & Persistence (Phase 4; persists `sessions`, unblocks this) · 07 · Data Model (`sessions`) · 08b · Conversation Agent · 08b-1 · System Prompt (`<session_snapshot>` injection contract) · 10a · Supabase · 14 · Error Handling (missing-snapshot warm states) · 15 · Test Strategy · 16 · Spec Index
