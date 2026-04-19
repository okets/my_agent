# M9.6-S17 Test Report

**Date:** 2026-04-19
**Branch:** `sprint/m9.6-s17-reflect-collapse`

## Summary

All new tests pass. Pre-existing failures (7 dashboard tests) are unrelated to S17 changes and were present on master before the branch.

## New Tests Added

### packages/dashboard/tests/unit/capabilities/await-automation-status.test.ts
10 tests — unit-level verification of the `KNOWN_TERMINAL` set and normalisation logic.

| Test | Result |
|------|--------|
| maps "completed" to "done" | ✓ |
| passes "done" through unchanged | ✓ |
| passes "failed" through unchanged | ✓ |
| passes "needs_review" through unchanged | ✓ |
| passes "interrupted" through unchanged | ✓ |
| passes "cancelled" through unchanged | ✓ |
| returns null for "running" (non-terminal) | ✓ |
| returns null for "pending" (non-terminal) | ✓ |
| returns null for unknown status | ✓ |
| includes "completed" in KNOWN_TERMINAL | ✓ |

### packages/dashboard/tests/integration/orchestrator-completed-status.test.ts
3 tests — integration test with real `AutomationJobService` verifying the bridge.

| Test | Result |
|------|--------|
| normalises job.status="completed" to "done" via KNOWN_TERMINAL closure | ✓ |
| does NOT recognise "running" or "pending" as terminal | ✓ |
| pre-fix: absent "completed" causes unknown-status branch to return "failed" | ✓ |

### packages/core/tests/capabilities/fix-mode-invocation.test.ts (new tests)
3 new Item A tests added to existing file.

| Test | Result |
|------|--------|
| prompt includes ## Smoke Output section when failure.detail is set | ✓ |
| prompt omits ## Smoke Output section when failure.detail is absent | ✓ |
| spec.smokeOutput equals failure.detail | ✓ |

### packages/core/tests/capabilities/fix-mode-escalate.test.ts (new tests)
2 new FU-1/FU-2 tests added to existing file.

| Test | Result |
|------|--------|
| FU-1: session.attempts has 1 entry with failureMode containing "escalate" after ESCALATE | ✓ |
| FU-2: logs a warning when ESCALATE line has no known reason token | ✓ |

## Modified Tests

### packages/core/tests/capabilities/orchestrator/orchestrator-state-machine.test.ts
- Updated `EXECUTING + success → SPAWN_REFLECT_JOB` to `→ REVERIFY`
- Removed 2 REFLECTING/REFLECT_JOB_DONE cases
- Updated budget exhaustion threshold from `totalJobsSpawned: 5` to `4`

### packages/core/tests/capabilities/orchestrator/orchestrator-budget.test.ts
- Rewritten: "1 execute per attempt, no reflect", ceiling at `MAX_JOBS=4`, `spawnCount === 3`

## Suites Run

| Suite | Result |
|-------|--------|
| `packages/core/tests/capabilities/` (49 files) | 321 pass, 3 skip, **0 fail** |
| `packages/dashboard/tests/unit/capabilities/` (2 files) | 10 pass |
| `packages/dashboard/tests/integration/` (new file) | 3 pass |
| Full dashboard suite (147 files) | 1115 pass, 7 pre-existing failures |

## Pre-existing Failures (Not S17)

These were present on master before the branch:
- `tests/browser/automation-ui.test.ts` — Playwright, requires live server
- `tests/browser/capabilities-singleton-visual.test.ts` — Playwright
- `tests/browser/progress-card.test.ts` — Playwright
- `tests/unit/ui/progress-card.test.ts` — design token mismatch (pre-existing)
- `tests/mcp/skill-triage-scenarios.test.ts` — missing task-triage.md skill (pre-existing)
- `tests/browser/capability-ack-render.test.ts` — Playwright
- `tests/e2e/whatsapp-before-browser.test.ts` — live e2e (pre-existing)

## tsc

Both packages clean:
```
packages/core: no errors
packages/dashboard: no errors
```

## Reflect Purge Check

No references to `REFLECTING`, `SPAWN_REFLECT_JOB`, `REFLECT_JOB_DONE`, `reflectJobId`, `renderReflectPrompt`, or `fix-automation.md` in production source code. Stale references only in `packages/core/dist/` (compiled output, not checked in).
