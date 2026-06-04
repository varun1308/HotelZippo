# Security notes — tracked risks

Living record of accepted/deferred security risks. Review before launch (Phase 8).

## Next.js 14.2.x advisories (accepted for now — 2026-06-05)

**Status:** accepted & deferred. **Owner decision:** founder, 2026-06-05.

`npm audit` flags multiple Next.js advisories (DoS via Server Components / Image Optimizer, cache poisoning, SSRF on WebSocket upgrades, XSS in App Router with CSP nonces, middleware/i18n bypass, etc.). The advisory ranges (`next 9.3.4 – 16.3.0-canary`) currently have **no fixed release on the 14.2.x line** — `npm audit fix --force` only offers `next@16+`, a two-major jump that would also force Tailwind v4 migration against the **locked** design system (`design_handoff/`).

**Why accepted for Phase 0:**
- We pinned **Next 14.2.35** (latest 14.2.x patch) deliberately so the locked Tailwind v3 design config drops in unchanged (founder decision; see CONTRIBUTING / specs/05).
- Most flagged surfaces are **not in use**: `next/image` `remotePatterns` is empty (populated in Phase 1, Vercel-hosted), no i18n, no custom middleware/proxy, no self-hosting (we deploy on Vercel, which mitigates several of these at the platform edge).
- Phase 0 is a scaffold with a single static page and no Server Actions / user input yet.

**Deferred action (before launch):**
- Evaluate a major framework upgrade (Next 15 → likely Tailwind v3-compatible; or Next 16) as its **own dedicated PR**, re-verifying the locked design system builds green. Track against Phase 8 (polish + ship).
- Re-run `npm audit` at the start of each phase that adds an attack surface (Image Optimizer config in Phase 1; Server Actions / API routes in Phase 2–3) and re-assess.

**CI policy:** the audit is **not** a blocking CI gate (it would block every PR on an unfixable-on-14.2 advisory). It is reviewed manually per the above.

### glob / postcss (transitive, dev-only)
`glob` (via `eslint-config-next`) and a `postcss` advisory (via Next's bundled copy) are dev/transitive and resolve when Next is upgraded. No production exposure. Tracked with the Next upgrade above.
