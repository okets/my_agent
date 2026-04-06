# External Verification Report

**Sprint:** M9.1-S3 Heartbeat Jobs Service
**Reviewer:** External Opus (independent)
**Date:** 2026-04-05
**Branch:** `sprint/m9.1-s3-heartbeat` (4 commits)

## Spec Coverage

| Spec Requirement | Status | Evidence |
|-----------------|--------|----------|
| S3: 30-second setInterval loop inside dashboard process | COVERED | `heartbeat-service.ts` line 39: `setInterval(..., this.config.tickIntervalMs)`, wired in `app.ts` with `tickIntervalMs: 30 * 1000` |
| S3a: Stale job detection -- running + last_activity > 5 min | COVERED | `heartbeat-service.ts` lines 62-73: reads `todos.json`, compares `last_activity` against `staleThresholdMs`. Unit test: "detects stale job (old last_activity) and marks interrupted" |
| S3a: Stale job detection -- running + no todos.json + created > 2 min | COVERED | `heartbeat-service.ts` lines 74-76: `neverStarted` check on empty items + old `created`. Unit test: "detects never-started job (empty todos, old created)" |
| S3a: Stale jobs marked `interrupted` with todo progress notification | COVERED | `heartbeat-service.ts` lines 87-103: calls `updateJob(status: 'interrupted')` and `enqueue()` with todo counts and incomplete items |
| S3b: Pending notification delivery via `ci.alert()` | COVERED | `heartbeat-service.ts` lines 112-137: reads pending queue, attempts `ci.alert()`, moves to delivered or increments attempts. Unit tests: "delivers pending notifications via ci.alert()" and "increments attempts when ci.alert() returns false" |
| S3c: Capability health checks (hourly) | COVERED | `heartbeat-service.ts` lines 140-152: time-gated by `capabilityHealthIntervalMs`, calls optional `capabilityHealthCheck()`. Unit test: "capability health check fires on schedule" |
| S3: Persistent notification queue -- pending/delivered dirs on disk | COVERED | `persistent-queue.ts`: `PersistentNotificationQueue` class with `pending/` and `delivered/` subdirectories. 6 unit tests including persistence across re-instantiation |
| S3: Notification shape matches spec (job_id, automation_id, type, summary, todos_completed, todos_total, created, delivery_attempts) | COVERED | `persistent-queue.ts` lines 4-22: `PersistentNotification` interface includes all spec fields plus optional `incomplete_items`, `resumable`, `_filename` |
| S3: handleNotification simplified to queue writes | COVERED | `automation-processor.ts` lines 177-265: writes to `notificationQueue.enqueue()` instead of inline `ci.alert()` logic. Falls back to direct `ci.alert()` when no queue configured |
| S3: Coexistence -- `checkStaleJobs()` replaced by heartbeat | COVERED | `automation-scheduler.ts` line 43: commented out from interval, heartbeat service handles stale detection |
| S3: Coexistence -- `SessionManager.pendingNotifications` replaced | PARTIAL | See Gaps Found below (D1 deviation) |
| S3: Coexistence -- `response-watchdog.ts` kept | COVERED | No changes to response-watchdog.ts in diff |
| S3: Coexistence -- `ConversationInitiator.alert()` kept as push mechanism | COVERED | `heartbeat-service.ts` line 118: calls `ci.alert()` for delivery |

## Test Results

- **Dashboard TypeScript:** Compiles clean (0 errors)
- **Core TypeScript:** Compiles clean (0 errors)
- **Sprint test suite:** 79 passed, 0 failed, 0 skipped (10 test files)
  - `persistent-queue.test.ts`: 6 passed
  - `heartbeat-service.test.ts`: 7 passed
  - `heartbeat-acceptance.test.ts`: 3 passed
  - `todo-server.test.ts`: 15 passed
  - `todo-validators.test.ts`: 13 passed
  - `todo-file.test.ts`: 4 passed
  - `todo-templates.test.ts`: 8 passed
  - `automation-types.test.ts`: 11 passed
  - `todo-acceptance.test.ts`: 6 passed
  - `todo-lifecycle-acceptance.test.ts`: 6 passed
- **Pre-existing failures (NOT caused by this sprint):** `automation-processor.test.ts` has 3 failures (empty_deliverable detection, notification prompt format assertions). Verified these fail identically on master with the master version of the file. These are pre-existing from S1/S2 changes.

## Browser Verification

Skipped -- sprint is pure backend/service work with no UI or server route changes.

## Sprint Validation Criteria (7 items)

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | `npx vitest run` -- all tests pass | PASS (with pre-existing exceptions) | 79/79 tests pass in the sprint test suite. The 3 pre-existing `automation-processor.test.ts` failures are confirmed on master |
| 2 | Acceptance test passes -- stale job detected, marked interrupted, notification with todo progress created | PASS | `heartbeat-acceptance.test.ts` "stale running job" test passes: job marked interrupted, notification has `todos_completed: 1`, `todos_total: 2`, `incomplete_items` contains "Step 2" |
| 3 | Heartbeat service logs `[Heartbeat] Started` on dashboard startup | PASS | `heartbeat-service.ts` line 44: `console.log('[Heartbeat] Started ...')`. Wired in `app.ts` line 1389: `heartbeatService.start()` |
| 4 | After delivery, notification moves from `pending/` to `delivered/` | PASS | Unit test "markDelivered moves to delivered/" + heartbeat unit test "delivers pending notifications via ci.alert()" + acceptance test "delivered notification moves from pending to delivered" |
| 5 | Dashboard restart: notifications in `pending/` survive and are delivered on first tick | PASS | Unit test "survives re-instantiation (disk persistence)" + acceptance test "notification queue survives re-instantiation". Queue reads from disk on construction |
| 6 | `SessionManager.pendingNotifications` no longer exists in code | FAIL | `session-manager.ts` still has `pendingNotifications` (lines 225, 324-325, 495, 505). See D1 deviation in DECISIONS.md |
| 7 | `checkStaleJobs()` no longer runs from the scheduler | PASS | `automation-scheduler.ts` line 43: call removed from interval, replaced with comment. Method body retained but never invoked |

## Gaps Found

### 1. SessionManager.pendingNotifications retained (Validation Criterion 6 -- FAIL)

The spec explicitly states: "`SessionManager.pendingNotifications[]` -- **Replaced** by persistent notification queue on disk."

The implementation keeps `pendingNotifications` and documents this as Decision D1: "They're complementary, not redundant."

**Assessment:** The decision has technical merit -- `pendingNotifications` serves in-session delivery (when a conversation is already streaming), while the persistent queue handles cross-session persistence. However, the validation criterion is explicit: "no longer exists in code." The implementation team made a deliberate deviation but did not update the validation criteria to reflect it.

This is a **deviation from spec**, not a bug. The CTO should decide whether to accept D1 or require full removal.

### 2. No formal traceability matrix in the implementation plan

The external reviewer procedure requires a traceability matrix mapping spec requirements to plan tasks. The Sprint 3 plan has clear task-to-spec mapping but not in the prescribed table format. The mapping is nonetheless traceable from the task descriptions.

### 3. Automation-processor tests not updated for new prompt format

The `handleNotification` refactor changed the fallback (no-queue) notification prompt format from verbose mediator framing ("A working agent just finished...") to terse format ("[job_failed]..."). The existing `automation-processor.test.ts` assertions check for the old format. While these 3 test failures are pre-existing (confirmed on master), 2 of them (`should notify immediately` and `should notify on needs_review`) are now additionally mismatched because the sprint changed the prompt text in the fallback path. These tests should be updated to match the new format as part of this sprint's cleanup.

**Correction after verification:** The test file was NOT modified in this sprint, and the same 3 tests fail identically on master even with master's version of `automation-processor.ts`. This means the test expectations were already broken before this sprint. No new regression introduced.

## Decisions Review

- **D1 (Keep pendingNotifications):** Reasonable engineering judgment but contradicts spec. Needs CTO sign-off.
- **D2 (Keep checkStaleJobs method, remove from interval):** Clean approach. Method body is dead code but causes no harm.
- **D3 (Simplify handleNotification):** Well-executed. The new code is significantly simpler (~60 lines vs ~95 lines) with clear separation of concerns.

## Code Quality Notes

- Error handling is thorough: `readTodoFile` gracefully handles missing files, heartbeat tick errors are caught and logged, notification delivery failures increment attempts.
- The `conversationInitiator` getter in `app.ts` uses a property getter to handle late binding (`get conversationInitiator() { return app.conversationInitiator ?? null; }`). This is a good pattern for the startup ordering.
- `formatNotification()` includes proper mediator framing in all notification types, following the dashboard CLAUDE.md pattern.
- Atomic writes for `writeTodoFile` (temp + rename) prevent corruption from concurrent heartbeat reads.

## Verdict

**PASS WITH CONCERNS**

The sprint delivers working heartbeat service, persistent notification queue, stale job detection, and notification delivery -- all tested and compiling clean. The core spec requirements are met.

The one concern is Validation Criterion 6: `SessionManager.pendingNotifications` was explicitly required to be removed but was intentionally retained (D1). This is a documented, reasoned deviation, not an oversight. The CTO should confirm whether D1 is accepted or whether the in-session delivery path should be migrated to the persistent queue as well.
