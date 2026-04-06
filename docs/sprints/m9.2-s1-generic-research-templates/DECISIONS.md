# M9.2-S1 Decisions Log

**Sprint:** M9.2-S1 Generic & Research Todo Templates
**Branch:** `sprint/m9.2-s1-generic-research-templates`
**Started:** 2026-04-06
**Mode:** Trip (CTO on mobile)

---

## D1: Single-agent execution (no team)

**Decision:** Execute sequentially without multi-agent team.
**Why:** All 10 steps are strictly sequential (TDD flow), no parallelizable work.
**Impact:** Minor — faster startup, simpler coordination.

## D2: Update executor unit tests for generic fallback

**Decision:** Update existing unit tests that assert `success: true` / `status: completed` to expect `needs_review` when the mock brain doesn't complete mandatory items.
**Why:** The generic fallback now adds mandatory items to all jobs (including test jobs with no `job_type`). The todo completion gating correctly catches incomplete mandatory items. The existing tests used mocked brains that don't complete todos, so they now correctly get `needs_review`.
**Impact:** Medium — changes test expectations. Also updated old `__tests__/todo-templates.test.ts` to expect generic fallback items instead of empty results.

