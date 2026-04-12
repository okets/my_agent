---
sprint: M9.4-S5
mode: trip
created: 2026-04-12
---

# M9.4-S5 Test Report

> **Closing UX validation (CTO requirement):** sprint is not signed off until CTO repeats the M9.5-S6 closing CNN smoke test on the dashboard and confirms a smooth handoff (no perceptible silent gap). Logged here under "Closing smoke test" once performed.

## Pre-implementation timing baseline

CNN smoke test (cnn-homepage-screenshot, notify=immediate), fired via
`POST /api/automations/cnn-homepage-screenshot/fire`, 2026-04-12 04:29 UTC.

| Event | Elapsed from job:done |
|-------|----------------------|
| handleNotification | +10 ms |
| enqueued | +12 ms |
| deliverPending start | +12 560 ms |
| alert() invoked | +12 560 ms |
| start emitted | (immediately after; not jobId-mapped yet) |

**Heartbeat wait between `enqueued` and `deliverPending start`: ~12.5 s.**

Notes:
- 12.5 s is well within the 0–30 s expected window for a 30 s tick — the run happened to land mid-tick.
- Confirms Contributor 1 (heartbeat-driven delivery) as dominant. Proceeding with structural changes (Tasks 3–13).
- Job summary work and sendSystemMessage init were both <50 ms in this run.

## Unit test results

| Suite | Tests | Status |
|-------|-------|--------|
| `tests/integration/state-publishing-jobs.test.ts` | 4 | ✓ all pass (2 existing + 2 new M9.4-S5) |
| `tests/unit/chat/send-system-message.test.ts` | 8 | ✓ all pass (6 existing + 2 new M9.4-S5) |
| `tests/unit/automations/heartbeat-service.test.ts` | 5 | ✓ all pass (new, M9.4-S5) |
| `tests/unit/automations/automation-processor.test.ts` | 11 | ✓ all pass (9 existing + 2 new M9.4-S5) |
| `tests/unit/ui/ws-client.test.ts` | 3 | ✓ all pass (new, M9.4-S5) |
| `tests/unit/ui/progress-card.test.ts` | 13 | ✓ all pass (existing; `handleJobCompleted` assertion updated to new method names) |

## Browser test results

Run against `http://localhost:4321` with the dashboard on our sprint branch.

### M9.4-S5 suite — `tests/browser/progress-card-handoff.test.ts`

| AC | Test | Duration | Status |
|----|------|----------|--------|
| 4 | card stays in 'Done' until matching tagged start arrives | 6.2 s | ✓ |
| 5 | sibling card resets safety net when A fades | 13.6 s | ✓ |
| 6 | notify='none' runs legacy 2 s fade, no handing-off | 3.0 s | ✓ |
| 6b (NF5) | notify=undefined treated as debrief (legacy fade) | 3.0 s | ✓ |
| 7 | safety net fires at 10 s with no start and no handoff_pending | 13.5 s | ✓ |
| 12 | handoff_pending for own jobId resets safety net (cold-start) | 14.6 s | ✓ |

### M9.4-S3 regression — `tests/browser/progress-card.test.ts`

All 10 existing browser tests (T1–T10) pass.

## Post-implementation timing

(filled by Task 13)

## Closing smoke test (CTO, human-led)

(filled by CTO after sprint review)
