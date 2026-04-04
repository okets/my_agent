## Job Monitoring Gap Fix

### Problem

When Conversation Nina spawned a tracked job (automation), she had no real-time feedback about job progress. The job completion notification came via `ConversationInitiator.alert()`, but `alert()` returned `false` when the session was streaming — causing it to fall through to `initiate()` which created a new conversation. Nina never learned the job completed, gave up, and fell back to building inline.

Additionally, `setRunningTasksChecker` existed in `SessionManager` but was never wired — the system prompt never told Nina about running jobs.

### Root Cause

Three gaps in the job-to-brain feedback loop:

1. **No awareness in system prompt:** `setRunningTasksChecker` (session-manager.ts:40) was defined but never called. The `activeWorkingAgents` section in the system prompt was always empty.

2. **Lost notifications during streaming:** `alert()` returned `false` when `isStreaming()` was true. `handleNotification()` fell through to `initiate()`, creating a new conversation instead of delivering to the active one.

3. **No active polling capability:** Nina had no MCP tool to check job status. She could only wait passively.

### Fix

Three-part solution:

**Part 1: Wire `setRunningTasksChecker` (awareness)**

| File | Change |
|------|--------|
| `app.ts` | Connected `setRunningTasksChecker` to `automationJobService.listJobs()`. Queries running/pending jobs, resolves automation names, populates `activeWorkingAgents` in the system prompt. Nina now sees "Job X is running" on every turn. |

**Part 2: Queue notifications for next-turn delivery**

| File | Change |
|------|--------|
| `session-manager.ts` | Added `pendingNotifications` queue, `queueNotification()` method, and drain logic at the top of `streamMessage()` — prepends queued notifications as `[SYSTEM: ...]` blocks to the next user message. |
| `conversation-initiator.ts` | When `isStreaming()` is true, `alert()` now calls `sessionFactory.queueNotification()` and returns `true` (instead of returning `false`). Notification delivered on next turn. |
| `app.ts` | Added `queueNotification` to the sessionFactory wiring — resolves SessionManager via registry and calls `sm.queueNotification()`. |

**Part 3: `check_job_status` MCP tool (active polling)**

| File | Change |
|------|--------|
| `automation-server.ts` | New `check_job_status` tool with optional filters (automationId, includeCompleted, limit). Returns active, awaiting-review, and recent completed/failed jobs. Nina can actively check: "Let me see how that job is going." |

### Result

Nina now has three layers of job awareness:
1. **Passive (system prompt):** Every turn shows running jobs
2. **Reactive (queued notifications):** Job completions delivered on next turn, never lost
3. **Active (MCP tool):** Nina can poll job status on demand
