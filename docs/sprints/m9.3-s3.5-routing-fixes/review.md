# M9.3-S3.5: Routing & Session Fixes -- External Review

**Reviewer:** Claude Opus 4.6 (External)
**Date:** 2026-04-08
**Branch:** `sprint/m9.3-s3.5-routing-fixes`
**Commits reviewed:** 6 implementation commits (3d08237..392ee61)

---

## Verdict: PASS with 1 bug fix required

The sprint delivers all three objectives (worker crash fix, auto-resume, notification routing) with clean architecture and solid test coverage. One bug must be fixed before merge.

---

## What Was Done Well

- **Recovery loop rewrite is clean.** The plan demanded REWRITE not APPEND, and the implementation follows through -- safety predicate checked FIRST, then branch. No premature status changes. The `continue` at line 1544 ensures mutual exclusivity between the two paths.
- **Failure fallback is correct.** The `.catch()` handler re-reads the todo file (fresh counts, not stale snapshot), corrects status from "failed" to "interrupted", and enqueues a notification. The comment explains the status correction rationale clearly.
- **Session ID persistence fix (5a1ec42) is the kind of discovery that validates live testing.** The test report honestly documents that the initial interruption test failed (`session=false` at 10s), the root cause was identified (session ID only persisted at completion), and the fix was applied and verified. Good engineering discipline.
- **Env var clearing is comprehensive.** All three Claude Code session vars are now cleared with clear documentation of why.
- **The `onStateChanged?.()` addition to `resume_job` force-complete is a small but necessary fix.** Without it, the dashboard UI wouldn't update after a force-complete via MCP tool.

---

## Issues

### Critical (must fix before merge)

**1. Missing `source_channel` on the interrupt path for non-auto-resumable jobs**

File: `packages/dashboard/src/app.ts`, line 1565

The plan (Task 7.3, line 1555 in the plan code block) specifies `source_channel` on ALL enqueue paths in the recovery loop. The auto-resume success path (line 1509) and failure path (line 1540) both correctly include it. But the non-auto-resumable interrupt path at line 1554-1566 has only a comment:

```typescript
// source_channel added in T7.4
```

...but the actual property is missing. This means non-resumable dashboard-sourced jobs interrupted by restart will bleed to WhatsApp -- exactly the bug the sprint was supposed to fix.

The fix is one line. Replace the comment with:

```typescript
source_channel: (job.context as Record<string, unknown>)?.sourceChannel as string | undefined,
```

The test report claims "sourceChannel carried through all 5 enqueue paths" but this path was missed. The live validation only tested the auto-resume path (which does carry it), so the gap wasn't caught.

---

### Important (should fix)

**2. Test predicate is a standalone copy, not imported from production code**

File: `packages/dashboard/tests/unit/automations/auto-resume.test.ts`

The test defines its own `shouldAutoResume()` function that mirrors the inline predicate in `app.ts`. This means the predicate logic is duplicated: if the production code drifts (e.g., adding a fifth criterion), the tests won't catch the regression.

The plan specified this exact structure, so this is not a deviation -- it's a design concern. Consider extracting the predicate to a shared utility (e.g., `packages/dashboard/src/automations/auto-resume.ts`) so both production code and tests use the same function. This is a follow-up, not a blocker.

**3. Session ID not immediately persisted in the `resume()` path**

File: `packages/dashboard/src/automations/automation-executor.ts`, line 601

The `execute()` path now persists `sdk_session_id` immediately on capture (line 326-327, the fix from 5a1ec42). But the `resume()` path at line 601 captures `newSessionId` without immediately persisting it -- it only saves it at completion (line 657). If the server crashes during a resumed session, the new session ID would be lost.

This is a low-probability scenario (double-crash during auto-resume), but for consistency with the fix rationale ("persist immediately so auto-resume works if the server crashes mid-execution"), the resume path should do the same.

**4. Dashboard-sourced retry logic from plan T7.4 Step 3 was not implemented**

File: `packages/dashboard/src/automations/heartbeat-service.ts`, lines 138-143

The plan specifies that when `alert()` returns false for a dashboard-sourced notification, the delivery should stay in queue and retry on next tick (NOT escalate to `initiate()` immediately). Only after 60 attempts (~30 min) should it escalate. The implementation passes `sourceChannel` to `alert()` (good) but the fallback path at lines 139-143 still calls `initiate()` immediately regardless of source channel -- no dashboard-specific retry logic.

This means dashboard-sourced notifications that can't be delivered via `alert()` will still fall through to `initiate()` on the preferred channel (potentially WhatsApp). The `sourceChannel` is passed to `alert()` but its value is not used to gate the `initiate()` fallback.

This is partially mitigated: for auto-resumed jobs the notification only fires on success (which usually means the dashboard session is active and `alert()` succeeds), so the practical impact is limited to the auto-resume failure path. Still, this was an explicit plan requirement.

**5. Missing `source-channel.test.ts` from plan T7.4 Step 4**

The plan specified creating `packages/dashboard/tests/unit/notifications/source-channel.test.ts` with 5 test cases covering dashboard retry, escalation threshold, undefined fallback, backward compat, and normal delivery. This test file was not created.

**6. Scheduler `notifyFailure()` gap not documented**

The plan (T7.4, Path 4) specified adding a comment to `automation-scheduler.ts:notifyFailure()` documenting that it bypasses the persistent queue and doesn't carry `source_channel`. No comment was added.

---

### Suggestions (nice to have)

**7. Diagnostic logging scope could be tighter**

File: `packages/dashboard/src/app.ts`, lines 1477-1480

The diagnostic log fires for all `running` jobs, even those that will NOT be auto-resumed (the condition is `canAutoResume || job.status === "running"`). This means non-auto-resumable running jobs get a diagnostic log line before falling through to the interrupt path. Not harmful, but slightly noisy -- consider logging only when `canAutoResume` is true, since the interrupt path already has its own log context via the enqueued notification.

**8. `sdk_session_id ?? null` is redundant on line 1494**

File: `packages/dashboard/src/app.ts`, line 1494

The safety predicate already guarantees `!!job.sdk_session_id` is true before entering the auto-resume branch, so `job.sdk_session_id ?? null` will never be `null`. This is defensive but misleading -- it suggests the value could be null.

---

## Plan Alignment Summary

| Task | Plan | Implementation | Aligned? |
|------|------|----------------|----------|
| 7.1 | Add `onStateChanged?.()` after force-complete | Done | Yes |
| 7.2 | Clear all 3 env vars | Done | Yes |
| 7.3 | Rewrite recovery loop with safety predicate | Done (1 missing `source_channel`) | Partial |
| 7.4 | Add `source_channel` to all enqueue paths | 4 of 5 paths done, dashboard retry logic not implemented, tests not written | Partial |
| 7.5 | E2E crash recovery test | Live validation done (not the scripted test file the plan mentioned) | Acceptable |

---

## Checklist Answers

1. **Safety predicate covers all criteria?** Yes -- `once`, `autonomy` (with correct undefined-to-full default), `sdk_session_id`, and `status === "running"`. The test file covers 8 cases including the undefined-autonomy edge case.

2. **Recovery loop rewrite correct?** Yes -- checks FIRST, then branches. No premature status change. One missing `source_channel` on the interrupt path.

3. **executor.resume() preserves todos?** Yes -- it uses `resume: sessionId` to continue the SDK session. The todo file is not overwritten. The plan's warning about `processor.resume()` destroying progress was heeded correctly.

4. **Failure fallback correct?** Yes -- status corrected from "failed" to "interrupted" with fresh todo counts and notification enqueued.

5. **All 5 enqueue paths carrying source_channel?** No -- 4 of 5. The non-auto-resumable interrupt path at `app.ts:1554` is missing it.

6. **Session ID persistence safe?** In the `execute()` path, yes -- immediately persisted. In the `resume()` path, not immediately persisted (only at completion). Low risk but inconsistent.

7. **Missing predicate test cases?** The 8 cases cover the four criteria exhaustively. One additional case worth adding: `sdkSessionId: ""` (empty string) -- currently the predicate would return false via `!!""`, which is correct, but worth testing explicitly since empty strings can arrive from database reads.

---

## Required Action

Fix the missing `source_channel` on the interrupt path (Issue 1), then this is ready to merge. Issues 2-6 are tracked as follow-up items, not merge blockers.
