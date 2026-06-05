# 08b-4 · Conversation Agent — Test Fixtures

- **Notion:** https://app.notion.com/p/3754958429ac81359c58c8d9c5836052
- **Phase:** 3 · **Status:** specced (v1.0.0)
- **Artifact:** `/prompts/conversation-agent/test-fixtures.md` + `/tests/fixtures/`

Structured fixtures for the three Conversation Agent prompts. Tests validate **structure/format/contract**, not content (per 15).

## System Prompt (SP-01…SP-05)
- **SP-01** New-user onboarding — one question at a time; first question is **name only**.
- **SP-02** Returning user, complete profile + partial brief — must not repeat confirmed fields; resume from last unanswered field.
- **SP-03** Transactional mode — all required fields in one message → proceed directly to `assemble_recommendations`, no clarifying questions.
- **SP-04** Hard-flag acknowledgement — top pick with severe flag surfaced explicitly in the conversational wrapper (not just the card). Also pins the recommendation-wrapper prose discipline: ONE framing sentence before the cards, ONE short forward-moving line after (book/shortlist/refine), and never restating the cards in prose.
- **SP-05** Out-of-scope destination (Bangkok) — decline warmly, list the 5 covered destinations, no hotel names.

## Recommendation Assembly (RA-01…RA-05)
- **RA-01** Resort-anchored (Varun, Phuket; Anantara / JW Marriott / Holiday Inn). Anantara = confirmed Indian food + strong family signal; JW Marriott = preferred brand but no Indian guest reviews; Holiday Inn = hard flag. Expect: Anantara top pick; JW Marriott in `other_picks` with explicit Indian-food gap; `why_top_pick` references vegetarian grandparents + kids-club need.
- **RA-02** Low-confidence filter — Marina Bay Sands (`low_confidence: true`) excluded; Shangri-La top pick; `other_picks = []`.
- **RA-03** Evaluate-only — Soneva Fushi + Six Senses Laamu with `evaluate_only: true`; Gili Lankanfushi (stronger but not shortlisted) excluded; `evaluate_only_applied = true`, `alternatives_introduced = false`.
- **RA-04** Budget mismatch — `value` tier, all Maldives `ultra-luxury` → error object, `available_tiers = ["ultra-luxury"]`.
- **RA-05** All hotels flagged — A (moderate, strong), B (severe refurb, thin), C (severe pest, thin). A top pick; all hard flags verbatim; `recommendation_notes` states all options flagged.

## Session Snapshot (SS-01…SS-02) — Phase 5
- **SS-01** Mid-onboarding snapshot, plain text <400 tokens.
- **SS-02** Post-recommendation snapshot with user decision, plain text <400 tokens.

## Action items

- Materialise fixtures in `/tests/fixtures/` (standard family profile + trip brief; RA candidate intelligence sets).
- Author `/prompts/conversation-agent/test-fixtures.md`.
- These fixtures back the Phase 2 contract tests (RA-*) and Phase 3 E2E (SP-*).
