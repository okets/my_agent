# M9.3-S3.5 Routing & Session Fixes — Architect Review

**Reviewer:** Opus (architect, separate session)
**Date:** 2026-04-08
**Scope:** S3.5 commits `3d08237..efccaa5` (6 implementation + 2 post-review fixes + 2 docs)
**Confidence note:** CTO reported continued WhatsApp bleeds after developer claimed completion multiple times. This review was conducted with extra scrutiny.

---

## Verdict: NOT APPROVED — 1 Critical, 4 Important issues

The auto-resume mechanism works correctly. The recovery loop rewrite is sound. But the heartbeat delivery guard — the last line of defense against WhatsApp bleed — has a functional bug that makes it incomplete. Combined with missing tests that would have caught it and two unguarded notification paths, the sprint does not fully deliver on its core requirement.

---

## What Works

**Recovery loop rewrite (Task 7.3): Correct.** Safety predicate checked BEFORE any status change. Uses `executor.resume()` (not `processor.resume()`). All three branches carry `source_channel`. The `autonomy ?? "full"` default handles the common case of omitted autonomy fields. The `.catch()` handler re-reads todo file for fresh counts and corrects status from "failed" to "interrupted."

**Session ID immediate persistence (commit 5a1ec42): Critical discovery, correctly fixed.** Without this, `sdk_session_id` was always null at interruption time and auto-resume was dead. The fix persists immediately on SDK init message capture in the `execute()` path. Good engineering discipline — the test report honestly documented the failure and root cause.

**Env var clearing (Task 7.2): Correct.** All three Claude Code session vars cleared at startup. Matches `allowNestedSessions()` in test helpers.

**`onStateChanged` on force-complete (Task 7.1): Correct.** One-line fix, verified.

**`ci.alert()` sourceChannel handling: Correct.** When `sourceChannel === "dashboard"`, outbound channel is explicitly set to `undefined`. This is the deepest defense against bleed — any notification that reaches `alert()` successfully will not forward to WhatsApp.

---

## Critical Issue

### C1: Dashboard notifications loop forever without incrementing delivery attempts

**File:** `packages/dashboard/src/automations/heartbeat-service.ts:138-143`

```typescript
} else if (notification.source_channel === "dashboard") {
  // Dashboard-sourced notification — don't initiate on WhatsApp.
  // Leave in queue for next alert() attempt when user opens web dashboard.
  console.log(
    `[Heartbeat] Dashboard-sourced notification for ${notification.job_id} — waiting for web session`,
  );
  // ← MISSING: incrementAttempts() and escalation threshold
}
```

The dashboard guard correctly prevents `initiate()` → WhatsApp. But it never calls `incrementAttempts()`. The counter stays at 0. The `MAX_DELIVERY_ATTEMPTS` check at line 122 never triggers. This notification retries every 30 seconds, forever.

**The plan (Task 7.4, Step 3) explicitly specified:**
- Call `incrementAttempts(notification)` in the dashboard path
- After 60 attempts (~30 min), escalate to preferred channel as last resort
- Neither was implemented

**Impact:** If the user doesn't return to the dashboard, this notification creates a permanent hot loop. Every 30s tick: call `alert()` → get false → log → skip → repeat. No escalation. No terminal state.

**Fix required:**

```typescript
} else if (notification.source_channel === "dashboard") {
  console.log(
    `[Heartbeat] Dashboard-sourced notification for ${notification.job_id} — waiting for web session (attempt ${notification.delivery_attempts})`,
  );
  this.config.notificationQueue.incrementAttempts(notification._filename!);
  // Escalate to preferred channel after 30 min (~60 attempts at 30s ticks)
  if (notification.delivery_attempts >= 60) {
    console.log(
      `[Heartbeat] Escalating dashboard notification after 30min: ${notification.job_id}`,
    );
    await this.config.conversationInitiator.initiate({
      firstTurnPrompt: `[SYSTEM: ${prompt}]`,
    });
    this.config.notificationQueue.markDelivered(notification._filename!);
  }
}
```

---

## Important Issues

### I1: `resume()` path does not persist `sdk_session_id` immediately

**File:** `packages/dashboard/src/automations/automation-executor.ts:601`

The `execute()` path persists `sdk_session_id` immediately on capture (line 327, fix from `5a1ec42`). The `resume()` path captures `newSessionId` at line 601 but only saves at completion (line 657). If the server crashes during a resumed session (double-crash), the new session ID is lost.

The internal review flagged this as Issue #3. It was not fixed.

**Fix:** Add one line after line 601, mirroring the `execute()` fix:

```typescript
newSessionId = (msg as any).session_id;
this.config.jobService.updateJob(job.id, { sdk_session_id: newSessionId ?? undefined });
```

### I2: Processor no-queue fallback calls `ci.alert()`/`ci.initiate()` without `sourceChannel`

**File:** `packages/dashboard/src/automations/automation-processor.ts:252-258`

The queue-based path (line 242) includes `source_channel`. The fallback path (no queue configured) calls `ci.alert(prompt)` without `sourceChannel` at line 254, and `ci.initiate()` without any dashboard guard at line 258.

Production always uses the queue, so this is a latent path. But it's a bleed vector if the queue is ever disabled.

### I3: Scheduler `notifyFailure()` gap not documented

**File:** `packages/dashboard/src/automations/automation-scheduler.ts:292-310`

The plan (Task 7.4, Path 4) explicitly required: "add a comment documenting the gap." No comment was added. The method calls `ci.alert(prompt)` without `sourceChannel` (line 306) and falls through to `ci.initiate()` (line 308) without any dashboard guard.

In practice, the scheduler fires cron-triggered automations — not brain-delegated ad-hoc ones. Dashboard-sourced jobs don't reach this path. But the documentation was required and is missing.

**Fix:** Add a comment above `notifyFailure()`:

```typescript
// NOTE: This bypasses the persistent notification queue and calls ci.alert()/ci.initiate()
// directly without sourceChannel. Scheduled jobs are not dashboard-originated, so this is
// acceptable. If dashboard-sourced scheduled jobs are ever supported, this needs routing
// through the persistent queue. See M9.3-S3.5 plan Task 7.4 Path 4.
```

### I4: `source-channel.test.ts` not created

The plan (Task 7.4, Step 4) required `packages/dashboard/tests/unit/notifications/source-channel.test.ts` with 5 test cases:

1. Dashboard-sourced + `alert()` returns false → stays in queue, not delivered to WA
2. Dashboard-sourced after 60 attempts → escalates to `initiate()`
3. Undefined `source_channel` + `alert()` returns false → `initiate()` immediately
4. Backward compat: no `source_channel` field → treated as undefined
5. Any `source_channel` + `alert()` returns true → delivered normally

This file was never created. **Test case #1 would have caught C1** (the infinite loop). This is the most impactful missing artifact.

---

## WhatsApp Bleed Path Audit

| # | Path | Has `source_channel`? | Prevents bleed? | Status |
|---|------|-----------------------|-----------------|--------|
| 1 | Recovery: auto-resume success | Yes | Yes | PASS |
| 2 | Recovery: auto-resume failure | Yes | Yes | PASS |
| 3 | Recovery: non-resumable interrupt | Yes (post-review fix) | Yes | PASS |
| 4 | Processor queue path | Yes | Yes | PASS |
| 5 | Processor no-queue fallback | No | No | FAIL (latent) |
| 6 | Heartbeat stale detection | Yes | Yes | PASS |
| 7 | Heartbeat delivery (dashboard) | Yes, but no increment/escalation | Partial (blocks WA but loops forever) | FAIL (C1) |
| 8 | Scheduler `notifyFailure()` | No | No (but only for cron jobs) | FAIL (documented gap, comment missing) |

**5 of 8 fully protected. 1 functionally broken. 2 unguarded but low risk.**

---

## Plan Alignment

| Task | Status | Gaps |
|------|--------|------|
| 7.1 MCP event gap | Done | — |
| 7.2 Env vars | Done | — |
| 7.3 Auto-resume | Done | — |
| 7.4 sourceChannel + heartbeat guard + tests | Partial | Missing: `incrementAttempts`, escalation threshold, `source-channel.test.ts`, scheduler comment |
| 7.5 E2E crash recovery | Partial | Manual validation done, test file not created |

---

## Required Before Merge (3 items)

1. **Fix C1:** Add `incrementAttempts()` + escalation threshold (60 attempts) in the dashboard path of `heartbeat-service.ts:deliverPendingNotifications()`

2. **Create `source-channel.test.ts`:** 5 test cases from the plan. This is the regression safety net for the heartbeat delivery logic.

3. **Add scheduler comment:** One line in `automation-scheduler.ts` above `notifyFailure()`.

## Recommended Follow-ups (not merge blockers)

4. Persist `sdk_session_id` immediately in `resume()` path (I1)
5. Add `sourceChannel` to processor no-queue fallback path (I2)
