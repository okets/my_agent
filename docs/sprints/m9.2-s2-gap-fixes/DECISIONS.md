# M9.2-S2 Decisions Log

**Sprint:** M9.2-S2 S1 Gap Fixes
**Branch:** `sprint/m9.2-s2-gap-fixes`
**Started:** 2026-04-06
**Mode:** Trip (CTO on mobile)

---

## D1: Single-agent execution

**Decision:** Sequential single-agent, no team.
**Why:** 5 small independent fixes, all strictly sequential. Not worth team overhead.

## D2: Smoke test for needs_review → debrief path

**Decision:** Accept integration test as proof. Real LLM smoke test could not produce `needs_review` because the todo enforcement is too strong — the worker wrote `status-report.md` even when explicitly told not to.
**Why:** The todo system's code enforcement overrides task instructions (M9.1's thesis). A `needs_review` state requires a worker that fails a validator, which real workers don't do when the mandatory item text tells them exactly what to write. The integration test (`automation-e2e.test.ts`, "debrief pipeline") uses a mock brain that can't complete todos, producing `needs_review` reliably and verifying the query includes it with `needsReview: true`.
**Impact:** None — the integration test covers the exact code path. The smoke test proved something arguably more important: real workers always complete generic mandatory items.

