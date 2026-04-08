---
title: "MCP Tools Audit: dismiss_job + disable_automation"
date: 2026-04-07
auditor: Claude Opus 4.6 (adversarial review)
scope: Gap and risk audit — NOT a sprint review
verdict: PASS with 2 Important issues and 4 Suggestions
---

# MCP Tools Audit: `dismiss_job` + `disable_automation`

## Files Reviewed

- `packages/core/src/spaces/automation-types.ts` — JobStatus type
- `packages/dashboard/src/mcp/automation-server.ts` — both new tools + onStateChanged
- `packages/dashboard/src/app.ts` (~line 1547) — onStateChanged wiring
- `packages/dashboard/public/js/components.js` — dismissed status styling
- `packages/dashboard/src/automations/automation-manager.ts` — disable() method
- `packages/dashboard/src/automations/automation-job-service.ts` — updateJob/getJob
- `packages/dashboard/src/automations/automation-scheduler.ts` — scheduler logic
- `packages/dashboard/src/scheduler/jobs/handler-registry.ts` — debrief-reporter
- `packages/dashboard/src/conversations/db.ts` — getDebriefPendingJobs, listJobs, getAutomationHints
- `packages/dashboard/src/mcp/debrief-server.ts` — debrief MCP tools
- `packages/dashboard/src/mcp/debrief-automation-adapter.ts` — debrief adapter
- `packages/dashboard/src/conversations/post-response-hooks.ts` — channel trigger matching
- `packages/dashboard/src/automations/automation-extractor.ts` — hint generation
- `packages/dashboard/src/state/state-publisher.ts` — WebSocket job publishing
- `packages/dashboard/src/automations/heartbeat-service.ts` — stale job detection
- `packages/dashboard/src/automations/working-nina-prompt.ts` — worker prompt
- `packages/core/src/prompt.ts` �� brain system prompt assembly
- `packages/core/src/notifications/service.ts` — notification service
- `packages/core/src/notifications/types.ts` — notification types
- `packages/dashboard/src/ws/protocol.ts` — WebSocket protocol types

---

## Checklist Results

### 1. Can the brain dismiss a running job? -- BLOCKED (PASS)

Lines 567-576 of `automation-server.ts` guard against this:

```typescript
if (job.status === "running" || job.status === "pending") {
  return { content: [...], isError: true };
}
```

Both `running` and `pending` jobs are rejected with a clear error message.

### 2. Can the brain disable a system automation? -- BLOCKED (PASS)

`automation-manager.ts` line 153-156:

```typescript
if (existing?.manifest.system) {
  throw new Error(`Cannot disable system automation: ${id}`);
}
```

The MCP tool wraps this in a try/catch (lines 642-663) and returns the error cleanly. Debrief and summary automations are protected.

### 3. Non-existent jobId in dismiss_job? -- ERROR RETURNED (PASS)

Lines 554-564: `getJob()` returns null, the tool returns `isError: true` with "Job not found."

### 4. Non-existent automationId in disable_automation? -- ERROR RETURNED (PASS)

Lines 618-628: `findById()` returns null, the tool returns `isError: true` with "Automation not found."

### 5. Can dismissed jobs be un-dismissed? -- NO (PASS)

- `resume_job` explicitly checks `job.status !== "needs_review" && job.status !== "interrupted"` (line 330). A dismissed job would fail this guard.
- No `un_dismiss_job` or similar tool exists.
- The only way to change a dismissed job's status would be to edit the JSONL file on disk directly — which is by design (markdown is source of truth).

### 6. Can disabled automations be re-enabled? -- NO TOOL EXISTS (see Important #1 below)

There is no `enable_automation` MCP tool. The `disable_automation` tool description says "Can be re-enabled later" but no mechanism is exposed to the brain. The only way to re-enable is to edit the YAML frontmatter on disk. This is documented as an issue below.

### 7. Does the scheduler respect disabled status? -- YES (PASS)

`automation-scheduler.ts` line 79-81:

```typescript
const automations = this.config.automationManager.list({ status: "active" });
```

The scheduler only queries active automations. Disabled ones are invisible to cron evaluation. Both `getNextRuns()` and `checkDue()` use this filter.

### 8. Does the debrief pipeline exclude dismissed jobs? -- YES (PASS)

`db.ts` line 1073:

```sql
AND j.status IN ('completed', 'needs_review')
```

`getDebriefPendingJobs()` only returns `completed` and `needs_review` jobs. Dismissed jobs are excluded by the SQL filter.

### 9. Does check_job_status show dismissed jobs? -- NO (PASS)

`check_job_status` queries for `running`, `pending`, `interrupted`, `needs_review`, `completed`, and `failed` jobs explicitly (lines 447-506). It never queries for `dismissed` status. Dismissed jobs are invisible to the brain via this tool.

### 10. Race conditions: dismiss while executor is updating? -- LOW RISK (PASS with note)

The JSONL write in `updateJob()` is documented as safe because "AutomationProcessor enforces one-job-per-automation concurrency" via a semaphore (comment on line 87). However, `dismiss_job` bypasses the processor's semaphore — it calls `jobService.updateJob()` directly. In theory, if the brain dismisses a job at the exact moment the executor is writing to the same JSONL file, both would read-modify-write and one update could be lost.

**Practical risk:** Very low. The dismiss guard blocks `running` and `pending` jobs, so a dismiss can only happen on `needs_review`, `interrupted`, `failed`, or `completed` jobs — none of which are being actively written by the executor. The only scenario would be: (a) executor marks a job as `needs_review` and (b) brain instantly dismisses it in the same JSONL write window. This is a microsecond-level race that would require near-simultaneous disk I/O.

**Verdict:** Acceptable for production. No fix needed now.

### 11. JSONL sync: what if JSONL record is missing? -- ERROR THROWN (PASS)

`updateJob()` in `automation-job-service.ts` lines 76-78:

```typescript
const dbJob = this.db.getJob(jobId);
if (!dbJob) { throw new Error(`Job not found: ${jobId}`); }
```

And lines 106-109:

```typescript
if (!result) {
  throw new Error(`Job ${jobId} not found in JSONL for automation ${automationId}`);
}
```

Both DB-level and JSONL-level missing records throw clear errors. The MCP tool does not catch this though — if `updateJob()` throws, it will propagate as an uncaught rejection. See Important #2 below.

### 12. Type safety: `"dismissed" as Job["status"]` cast -- SAFE (PASS)

Line 596:

```typescript
status: "dismissed" as Job["status"],
```

This is redundant but safe. `JobStatus` in `automation-types.ts` line 64 already includes `"dismissed"`:

```typescript
export type JobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'needs_review' | 'interrupted' | 'dismissed'
```

The string `"dismissed"` is already assignable to `Job["status"]` without a cast. The cast is defensive and harmless, but could hide a future type error if `"dismissed"` were ever removed from the union. Minor style nit only.

### 13. Missing enable_automation -- see Important #1

### 14. Missing tests -- see Important #2

---

## Additional Checks

### Dismissed jobs leaking into brain prompt?

**No.** `loadAutomationHints()` in `packages/core/src/prompt.ts` line 362 filters: `if (data.status !== 'active') continue`. This is about automations, not jobs. For jobs, the brain only sees them via `check_job_status`, which does not query dismissed status (see #9). Dismissed jobs are invisible to the brain.

### Dismissed jobs leaking into channel hint generation?

**No.** `getAutomationHints()` in `db.ts` line 1232 filters: `WHERE status = 'active'`. This is about automation status, not job status. Channel trigger matching operates on automations, not jobs. Disabled automations are excluded from hints.

### Is onStateChanged callback robust?

**Partially.** Line 598:

```typescript
deps.onStateChanged?.();
```

The callback in `app.ts` (lines 1552-1555) calls `publishJobs()` and `publishAutomations()`. These are debounced (100ms) and non-throwing by design — the state publisher catches errors internally. If the callback itself threw (e.g., statePublisher was null), it would propagate as an uncaught error in the MCP tool handler. But in practice, `app.statePublisher?.publishJobs()` uses optional chaining, so a null publisher would be a no-op. **Verdict: Safe.**

### pruneExpiredRunDirs and dismissed jobs?

`automation-job-service.ts` line 299-300:

```typescript
if (job?.status === "needs_review" || job?.status === "interrupted") continue;
```

Dismissed jobs are NOT protected from pruning. Run directories for dismissed jobs will be pruned after the retention period (7 days). This seems intentional — dismissed means "I don't care about this anymore."

### StatePublisher job snapshots?

`_getJobSnapshots()` in `state-publisher.ts` line 521 calls `listJobs({ limit: 50 })` without a status filter. This returns ALL jobs including dismissed ones. The UI will render them with the grey badge from `components.js`. This is correct — dismissed jobs should appear in history with their dismissed status visible.

---

## Issues

### Important #1: `disable_automation` promises re-enable but no tool exists

**File:** `packages/dashboard/src/mcp/automation-server.ts` line 613
**Issue:** The tool description says "Can be re-enabled later" but there is no `enable_automation` MCP tool. If the user says "turn that back on", the brain has no way to comply. The only path is editing the markdown file directly, which the brain's MCP tools don't expose for automations.

**Risk:** User confusion when re-enable fails silently (brain has no tool to call, may hallucinate success or explain it cannot).

**Recommendation:** Either:
- (a) Add an `enable_automation` MCP tool (symmetric API, 15 lines of code), or
- (b) Remove the "Can be re-enabled later" promise from the description to set correct expectations

### Important #2: `dismiss_job` does not catch `updateJob()` exceptions for orphaned JSONL

**File:** `packages/dashboard/src/mcp/automation-server.ts` lines 594-598
**Issue:** If `updateJob()` throws (e.g., JSONL file missing for orphaned DB entry), the exception is not caught. The tool handler has no try/catch around the `updateJob` + `onStateChanged` block, unlike other tools in the same file (e.g., `disable_automation` wraps its call in try/catch).

The `getJob()` call on line 554 succeeds (reads from DB), but `updateJob()` on line 594 reads+writes JSONL on disk. If the JSONL file is missing or corrupted, `updateJob()` throws `"Job not found in JSONL for automation..."`.

**Risk:** Unhandled rejection from MCP tool — may crash or log a confusing error. The brain sees an opaque failure instead of a useful error message.

**Recommendation:** Wrap lines 594-601 in a try/catch, similar to `disable_automation`:

```typescript
try {
  deps.jobService.updateJob(args.jobId, { status: "dismissed" as Job["status"], summary });
  deps.onStateChanged?.();
} catch (err) {
  return {
    content: [{ type: "text" as const, text: `Failed to dismiss: ${err instanceof Error ? err.message : "Unknown error"}` }],
    isError: true,
  };
}
```

---

## Suggestions

### Suggestion #1: Remove redundant type cast

**File:** `packages/dashboard/src/mcp/automation-server.ts` line 596

```typescript
status: "dismissed" as Job["status"],
```

The cast is unnecessary since `"dismissed"` is already in the `JobStatus` union. Just use `status: "dismissed"`. The cast could hide a type error if the union changes in the future.

### Suggestion #2: Add `dismissed` to App event subscriptions in StatePublisher

**File:** `packages/dashboard/src/state/state-publisher.ts` lines 146-148

The publisher subscribes to `job:created`, `job:completed`, `job:failed`, `job:needs_review` events but has no `job:dismissed` event. Currently this is fine because `dismiss_job` calls `onStateChanged()` directly instead of emitting an app event. But if the codebase moves toward event-driven updates (which the subscriber pattern suggests), adding `job:dismissed` to `JobEventName` in `automation-processor.ts` and subscribing in the publisher would be more consistent.

### Suggestion #3: Add unit tests for both new tools

**No tests exist** for `dismiss_job` or `disable_automation`. Key test cases:

For `dismiss_job`:
- Dismiss a `failed` job -- should succeed
- Dismiss a `needs_review` job -- should succeed
- Dismiss a `running` job -- should fail with error
- Dismiss a `pending` job -- should fail with error
- Dismiss an already-dismissed job -- should succeed (idempotent)
- Dismiss a non-existent job -- should fail with error
- Verify `onStateChanged` is called on success

For `disable_automation`:
- Disable an active automation -- should succeed
- Disable an already-disabled automation -- should succeed (idempotent)
- Disable a system automation -- should fail with error
- Disable a non-existent automation -- should fail with error
- Verify `onStateChanged` is called on success

### Suggestion #4: Consider whether `completed` jobs should be dismissable

Currently, `dismiss_job` allows dismissing `completed` jobs. The guard only blocks `running` and `pending`. It is unclear whether dismissing a completed job serves a real use case — the job already succeeded. If the intent is only to clean up stuck/failed/abandoned jobs, the guard could also block `completed`:

```typescript
if (job.status === "running" || job.status === "pending" || job.status === "completed") {
```

However, this may be intentional — a user might want to dismiss a completed job that produced unwanted results. Leaving as a suggestion for the team to decide.

---

## Summary

| Check | Verdict |
|-------|---------|
| Running job dismiss guard | PASS |
| System automation disable guard | PASS |
| Non-existent ID handling | PASS |
| Un-dismiss prevention | PASS |
| Enable_automation gap | IMPORTANT |
| Scheduler respects disabled | PASS |
| Debrief excludes dismissed | PASS |
| check_job_status hides dismissed | PASS |
| Race conditions | LOW RISK (acceptable) |
| JSONL orphan handling | IMPORTANT (missing try/catch) |
| Type safety | PASS (cast is safe but redundant) |
| Brain prompt leakage | PASS (no leakage) |
| Channel hint leakage | PASS (no leakage) |
| onStateChanged robustness | PASS |
| UI styling | PASS |
| Test coverage | SUGGESTION (no tests) |

**Overall:** The implementation is solid. Guards are in place for all safety-critical paths. The two Important issues are low-severity but should be addressed: one is a missing try/catch that could surface as an opaque error, the other is a broken promise in a tool description. Neither is a data corruption or security risk.
