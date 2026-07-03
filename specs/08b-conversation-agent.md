# 08b · Conversation Agent

- **Notion:** https://app.notion.com/p/3754958429ac81dca34bf484b049de61
- **Phase:** 3 (recommendation assembly 2–3) · **Status:** built ✅ (runtime `lib/chat/agent.ts`; this page is the parent contract — build against the sub-specs below)

Powers the real-time user experience: onboarding, family-profile collection, trip-brief capture, recommendation assembly, session memory. Framework: **Vercel AI SDK** (streaming, tool use).

## Runtime contract (as built — summary of locked decisions)

- Runtime: `lib/chat/agent.ts` (`runConversation`, injectable model for key-free tests) behind `POST /api/chat` — **signed-in users only** (401 `auth_required`, per 04).
- Model: `claude-haiku-4-5` default, env-overridable via `AGENT_MODEL` (revert to `claude-sonnet-4-6` in prod if quality regresses) — same pattern as `ASSEMBLY_MODEL` / `SNAPSHOT_MODEL` (08b-2 / 08b-3).
- Tools: `assemble_recommendations` (→ query 08a-5 consumption + assemble 08b-2; async dispatch when `ASYNC_ASSEMBLY=1`, see 03c), `update_profile` (RLS-scoped; requires signed-in user id — absent ⇒ tool not offered so CI/env-free stays green), `offer_profile_form` (inline chip UX).
- Deterministic persistence net: profile facts passed to `assemble_recommendations` are persisted at assemble-time even if the model skipped `update_profile` (Haiku safety net, PR #75).
- Onboarding gates, hard-flag prominence, and prose discipline live in the system prompt (08b-1); never query `raw_reviews` at request time.

## Flows

- **New user:** Google Sign-In → conversational onboarding (collect family profile one field at a time) → profile saved → trip brief begins.
- **Returning user:** session snapshot loaded as context → resume naturally (Phase 5).
- **Trip brief → recommendation:** collect brief (destination, dates, trip type, focus areas, pre-shortlist) → query `hotel_intelligence` → assemble 2–3 from **cached intelligence only** → render inline cards → **hard flags prominent** → top pick called out.
- **Session memory (Phase 5):** periodic snapshot to `sessions` as compressed context (no full-history replay).

## Sub-specs

- System prompt → `08b-1-system-prompt.md` (`/prompts/conversation-agent/system-prompt.md`)
- Recommendation assembly → `08b-2-recommendation-assembly.md` (`/prompts/conversation-agent/recommendation-assembly.md`)
- Session snapshot → 08b-3 (Phase 5; `/prompts/conversation-agent/session-snapshot.md`)
- Test fixtures → `08b-4-test-fixtures.md`
- Runtime + card contract → `03b-recommendation-flow.md`

## Action items (from Notion)

- Implement the system prompt, recommendation-assembly prompt, and session-snapshot prompt per 08b-1/08b-2/08b-3; tests per 08b-4.
- Assemble recommendations from cached `hotel_intelligence` only; never query `raw_reviews` at request time.
- Always surface hard flags prominently; apply brand preference as a tiebreaker, never a trump card.
