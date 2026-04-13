# M10-S0 Decisions Log

Decisions made during sprint execution. Appended chronologically.

---

## 2026-04-13 — Sprint start

**Mode:** Trip sprint (CTO on mobile).

**Pre-execution decisions (CTO confirmed):**

- **Task 6 Option A approved.** After the presence-rule fix lands, we manually re-enqueue a `job_completed` notification for job `594f1962` (the lost April-13 Chiang Mai research) with no `sourceChannel`. Heartbeat picks it up, presence rule routes to WA. Real code path, proves fix end-to-end.
- **No auto-merge.** Sprint ends at `sprint/m10-s0-routing-simplification` branch + `/trip-review`. CTO decides merge after walkthrough.

**Validation approach (CTO approved):**

1. Regression-first — integration tests against current master must fail (prove they catch Issue #4) before any code deletion.
2. Unit tests for `getLastUserTurn()` and `alert()` presence rule.
3. Integration tests via AppHarness — real ConversationManager, mocked transports (no live outreach).
4. Mechanical: grep `sourceChannel` / `source_channel` in `packages/dashboard/src/` → zero prod hits; typecheck; existing suite passes.
5. External reviewer (trip-mode mandate) — independent Opus, runs tests, spec-gap analysis.
6. Production proof — Task 6 re-enqueue. If message lands on WA, fix is real.
