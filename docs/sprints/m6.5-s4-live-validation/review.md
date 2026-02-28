# Sprint Review — M6.5-S4: Live Validation

> **Reviewer:** Opus (Tech Lead)
> **Date:** 2026-02-28
> **Build:** c2405ce
> **Mode:** Normal sprint

---

## Test Results

| # | Test | Result | Notes |
|---|------|--------|-------|
| 5.12 | Expired session fallback | **PASS** | Resume with `fake_expired_session` failed, logged warning, cleared stale ID, fell back to fresh session, completed successfully. New `sdk_session_id` persisted. |
| 5.7 | Self-referential scheduled task | **PASS** | Brain introspected its own task system, listed all 3 tasks (including itself as "running"), produced structured deliverable. `sdk_session_id` persisted. |
| 5.11 | Two recurring tasks | | |
| 5.6 | Scheduled task + WhatsApp delivery | | |
| 2.6-live | Pre-S2 conversation fallback | | |
| 8.6 | WhatsApp inbound message | | |
| 7.1 | Sustained conversation (20+ msgs) | | |
| 7.2 | Compaction indicators in logs | | |
| 7.3 | Post-compaction memory retention | | |

---

## Test 5.12: Expired Session Fallback — PASS

**Setup:** Created scheduled task "Fun space fact", let it execute and acquire a real `sdk_session_id`. Tampered DB: set `sdk_session_id = 'fake_expired_session'`, reset status to `pending`, `scheduled_for` to now.

**Evidence:**
```
[TaskScheduler] Found 1 due scheduled task(s)
[TaskExecutor] Resuming SDK session fake_expired_session for task "Fun space fact"
[TaskExecutor] SDK session resume failed (fake_expired_session) for task "Fun space fact", falling back to fresh session: Claude Code process exited with code 1
[TaskExecutor] Stored SDK session 0ae8a58e-364c-4691-ab20-f40707b896d3 for task "Fun space fact"
[TaskExecutor] Task completed: "Fun space fact"
```

**DB state after:** `status = 'completed'`, `sdk_session_id = '0ae8a58e-...'` (new valid session).

**Fallback mechanism:** `task-executor.ts:354-376` — try resume → catch → clear stale ID → fresh query. No retry loop; immediate fallback. Stale ID cleared on failure to prevent infinite retries.

---

## Test 5.7: Self-Referential Scheduled Task — PASS

**Setup:** Sent "In 2 minutes, check if I have any tasks due today and summarize them for me" via new dashboard conversation.

**Timeline:**
- 08:04:21 UTC — Task created: "Check tasks due today and summarize"
- 08:04:22 UTC — Calendar event created for scheduled execution
- 08:06:39 UTC — Scheduler picked up task, brain executed
- 08:07:02 UTC — Task completed, deliverable delivered to conversation

**Self-referential result:** Brain successfully queried the task system and produced:
```
## Daily Task Summary - February 28, 2026
### Completed Tasks
- 07:14 UTC - Send fun space fact (completed at 07:15)
- 07:15 UTC - Fun space fact (completed at 07:15)
### Currently Running
- 08:06 UTC - Check tasks due today and summarize (this task)
```

**DB state after:** `status = 'completed'`, `sdk_session_id = 'ea86c1f4-...'`

**Note:** Alpine.js notification error discovered and fixed during this test (see Bug Fix below).

---

## Bug Fix: Alpine.js Notification Panel Crash

**Discovered during:** Test 5.7 (same error seen in S3, root-caused and fixed in S4).

**Symptom:** `Alpine Expression Error: Cannot set properties of null (setting '_x_dataStack')` on expression `notif.importance === 'info'` whenever a task completed and a notification was broadcast.

**Root cause:** The desktop notification panel (`index.html:3269`) uses `x-show` with `x-transition` to toggle visibility. When the panel is hidden and a notification arrives, Alpine's `x-for` loop tries to clone and initialize template children inside the transitioned-off container. The transition system leaves internal state that conflicts with element creation, resulting in a null DOM node during `addScopeToNode()`.

**Fix:** Guard the `x-for` loop to only iterate when the panel is visible:
```diff
- x-for="notif in getPendingNotifications()"
+ x-for="notif in (showNotificationPanel ? getPendingNotifications() : [])"
```

**File:** `packages/dashboard/public/index.html:3295`

**Verification:** Triggered a task notification post-fix. Console shows 0 errors (previously showed `TypeError` on every task completion notification). Notification badge count updates correctly. Panel renders notifications when opened.

---
