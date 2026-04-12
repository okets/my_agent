---
sprint: M9.4-S5
mode: trip
created: 2026-04-12
---

# M9.4-S5 Decisions Log

## D1 — Smoke test gating (Task 2)

**Date:** 2026-04-12
**Type:** medium
**Decision:** Replace human-driven CNN smoke test in Task 2 with headless-App-driven automation trigger to record `[timing]` baseline. Add a final human-led closing smoke test (mirroring M9.5-S6's closing test) to the sprint exit criteria.

**Why:**
- CTO is on mobile (trip mode), cannot run live CNN test before structural tasks ship.
- Headless App (`docs/design/headless-api.md`) is the prescribed substitute for browser/HTTP testing.
- CTO explicitly requested human-led smoke test at the end as the real UX validator.

**Pros:** unblocks all 13 tasks; preserves measurement intent; preserves human-eyes UX validation.
**Cons:** measured baseline taken via programmatic trigger may differ slightly from real CNN flow (acceptable — magnitude of 30s gap dwarfs noise).

