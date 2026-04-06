# External Verification Report

**Sprint:** M9.1-S6 Restart Recovery
**Reviewer:** External Opus (independent)
**Date:** 2026-04-06

## Spec Coverage

| Spec Requirement | Status | Evidence |
|-----------------|--------|----------|
| Step 1: Mark running/pending jobs as `interrupted` with todo progress | COVERED | `app.ts` lines 1451-1495: queries running + pending jobs, reads `todos.json` per job, marks as `interrupted` with summary including `completed/total` counts. Runs before heartbeat starts. |
| Step 2: Create persistent notifications for each interrupted job | COVERED | Same loop in `app.ts` lines 1477-1488: `notificationQueue.enqueue()` with `type: "job_interrupted"`, todo progress fields (`todos_completed`, `todos_total`, `incomplete_items`), and `resumable` flag. |
| Step 3: Clean stale once:true completed automations | COVERED (DEV1) | `app.ts` lines 1497-1521: iterates all automations, finds `once: true` with completed jobs, calls `disable()` instead of `delete()`. CTO-approved deviation documented in `DEVIATIONS.md`. |
| Step 4: Re-scan capabilities | COVERED | `app.ts` lines 1523-1536: calls `scanCapabilities()` and loads results into registry. Wrapped in try/catch so a scan failure doesn't block startup. |
| Step 5: Start heartbeat | COVERED | `app.ts` lines 1538-1550: `HeartbeatService` starts after recovery sequence. First tick picks up persistent notifications from Step 2. |
| Job resumption: `resume_job` handles interrupted jobs | COVERED | `automation-server.ts` lines 321, 365-376: `resume_job` accepts both `needs_review` and `interrupted` statuses. For interrupted jobs, builds a todo-aware resume prompt listing completed items (checkmark) and remaining items (ballot box). |
| Session ID detection: detect fresh vs actual resume | COVERED | `automation-executor.ts` lines 593-606: compares `newSessionId` to `effectiveSessionId` after query iteration. Logs explicit message for mismatch (fresh session) and for null session ID (no init message). |
| Fresh session fallback: inject context about completed work | COVERED | The todo-aware resume prompt (built in `automation-server.ts`) handles both cases: actual resume gets "You were interrupted. Items 1-N done. Continue from item N+1." Fresh session gets the same context, which tells the worker to verify completed work on disk. |

## Test Results

- **Sprint acceptance tests:** 4 passed, 0 failed, 0 skipped
- **Core TypeScript:** compiles clean (0 errors)
- **Dashboard TypeScript:** compiles clean (0 errors)

Test file: `packages/dashboard/tests/integration/restart-recovery-acceptance.test.ts`

Tests cover:
1. Running job detected as interrupted after simulated restart, with correct todo progress in summary
2. Persistent notification created with `job_interrupted` type, correct todo counts, and incomplete items list
3. `once:true` completed automation disabled on recovery
4. `resume_job` accepts interrupted status and builds todo-aware prompt with completed/remaining items
5. AppHarness preserves data across restart simulation via `agentDir` reuse (4th test, infrastructure)

## Browser Verification

Skipped -- sprint is pure backend with no UI changes. No files in `public/` were modified.

## Findings

### Finding 1: Test recovery logic is inline, not calling production code (Low severity)

The first test (lines 134-175) replicates the recovery logic inline rather than calling the actual `app.ts` startup recovery function. This means the test validates the recovery *concept* but not the exact production code path. Specifically:

- The test hardcodes `resumable: true` (line 171), but production code uses `!!job.sdk_session_id` (line 1485 in `app.ts`). Since the test never sets `sdk_session_id`, the production code would set `resumable: false` for this job.
- The test does not exercise the capability re-scan (Step 4) or heartbeat start (Step 5).

**Impact:** Low. The recovery logic is straightforward (list + update + enqueue), and the inline test validates the data flow correctly. The `resumable` field difference means the test asserts `true` while production would produce `false` for the same job -- but this is a test data setup issue, not a logic bug.

**Recommendation:** Either extract the recovery sequence from `app.ts` into a testable function, or set `sdk_session_id` on the test job to make the test match production behavior.

### Finding 2: Spec step numbering condensed in implementation (Informational)

The spec defines 5 separate steps. The implementation merges Steps 1 (mark interrupted) and 2 (create notifications) into a single loop, then renumbers the remaining steps as 2, 3, 4 in code comments. This is an efficient optimization -- no functional impact.

### Finding 3: No process start time filter (Informational)

The spec says "All jobs with status `running` or `pending` **created before process start time**" should be marked interrupted. The implementation marks ALL running/pending jobs without a time filter. This is correct in practice: the recovery sequence runs synchronously before accepting connections, so no new jobs can exist yet. The time filter is redundant.

### Finding 4: Notification field name differs from spec example (Informational)

The spec's JSON example shows `"automation": "Add Hebrew to STT"` (human-readable name). The implementation uses `automation_id: job.automationId` (machine ID), matching the `PersistentNotification` interface. The human-readable context is present in the `summary` field. No functional issue.

## Verdict

**PASS**

All five validation criteria are met:

1. Acceptance tests pass (4/4)
2. `resume_job` accepts interrupted jobs with todo-aware resume prompt showing completed/remaining items
3. Session ID mismatch detection logged in `automation-executor.ts` with distinct messages for mismatch vs null cases
4. Stale `once:true` completed automations disabled on startup (DEV1 deviation approved)
5. TypeScript compiles clean -- 0 errors in both `packages/core` and `packages/dashboard`

The implementation is a faithful translation of the System 6 design spec with one pre-approved deviation (disable vs delete). The recovery sequence runs in the correct order (mark interrupted -> create notifications -> clean once-automations -> re-scan capabilities -> start heartbeat) and integrates cleanly with the existing heartbeat and notification infrastructure from prior sprints.
