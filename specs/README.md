# /specs — the in-repo contracts

Notion is the **briefing + source of truth**; each file here is the **contract** generated from a Notion spec page's "Claude Code Action Items." Code is written against these files.

**Change protocol (CLAUDE.md hard rule 7):** to change a contract, update the **Notion page first**, then this `/specs` file, then the code. Never let `/specs` and Notion diverge silently.

**Naming:** `<spine-number><opt-letter>-<kebab-topic>.md`. Where Notion 16 re-keys a page to its build phase, that filename is honoured (e.g. `08b-6` → `03b-recommendation-flow.md`, `12g` → `01b-image-sourcing.md`). See `docs/spec-coverage.md`.

Each file links back to its Notion page and states its build phase + status.
