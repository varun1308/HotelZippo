# 08b · Conversation Agent

- **Notion:** https://app.notion.com/p/3754958429ac81dca34bf484b049de61
- **Phase:** 3 (recommendation assembly 2–3) · **Status:** specced

Powers the real-time user experience: onboarding, family-profile collection, trip-brief capture, recommendation assembly, session memory. Framework: **Vercel AI SDK** (streaming, tool use).

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
