# M9-S3.1: Heartbeat & Error Recovery

> **Milestone:** M9 — Capability System
> **Parent sprint:** M9-S3 (WhatsApp Voice + Skill Generation)
> **Status:** Planned
> **Created:** 2026-04-02

---

## Problem

Two classes of agent silently fail with no user notification:

### Conversation Nina (brain)

On 2026-04-02, the brain silently failed during an HTTPS setup task. It spent 8 minutes doing 14 tool calls, produced a garbled response — internal monologue fragments concatenated without the actual plan — and went silent. The user was left with no deliverable, no follow-up, and no indication anything went wrong.

```
"Here's the plan:Good picture. Now let me design the plan.Solid plan. Let me write it
up and read the key files to confirm one detail.Good — confirmed everything. Writing
the plan now."
```

Turn metadata: 3,660 output tokens, $0.64 cost, zero usable content delivered.

### Working Ninas (automations)

Working agents fail differently but just as silently:

1. **Empty deliverable** — brain returns no `<deliverable>` tags, summary is empty, job marked "completed" with nothing useful produced
2. **Silent failure** — job errors caught and logged to console, but user never notified (especially scheduled/watch-triggered jobs)
3. **Notification delivery failure** — job finishes but `alert()` can't reach the user (no active conversation, channel down), result sits in the database unseen
4. **Stale jobs** — SDK session never completes, job stuck in `running` forever with no timeout

Current state: `AutomationProcessor.fire()` catches errors with `.catch(err => console.error(...))`. `AutomationScheduler.checkDue()` does the same. User is never told.

## Goal

Add error detection and recovery for both conversation and working agent sessions. The user should never be left wondering "did Nina do it or not?"

---

## Design

### Part 1: Conversation Watchdog

#### Architecture

```
User message → chat-service.ts streams response → counts tool events
                                                 ↓
                              post-response-hooks.ts (fire-and-forget)
                                                 ↓
                              response-watchdog.ts (pure detection)
                                                 ↓ diagnosis found?
                              injectRecovery(conversationId, prompt)
                                                 ↓
                              SessionManager.injectSystemTurn()
                                                 ↓
                              Brain responds → transcript + WebSocket + channel
```

Three **pure detection functions** in a new file, orchestrated from the existing `PostResponseHooks` class.

**Recovery path:** Direct injection into the specific conversation's session via a targeted `injectRecovery(conversationId, prompt)` callback. This does NOT use `ConversationInitiator.alert()` (which searches for the "active" conversation and could target the wrong one). The callback uses the exact `conversationId` from the hook context.

#### Safety Properties

| Property | Mechanism |
|----------|-----------|
| No infinite loops | Recovery responses bypass `PostResponseHooks` — injected via `SessionManager`, not `sendMessage()` |
| No double-recovery | 5-minute per-conversation cooldown (`Map<string, number>` in `PostResponseHooks`) |
| No race with user input | `SessionManager.isStreaming()` guard — recovery skipped if brain is already processing |
| No wrong-conversation injection | `conversationId` passed explicitly from hook, not resolved via "active conversation" lookup |
| Graceful degradation | All detection is best-effort; `injectRecovery` failures caught by existing `.catch(() => {})` |

#### Detection Heuristics

All heuristics are regex/string-based. No LLM calls.

**1. Garbled Response Detection**

| Signal | Heuristic | Threshold |
|--------|-----------|-----------|
| Concatenated monologue | `/(?<![A-Z\/])[.!?:][A-Z]/g` — sentence boundaries with no whitespace | 3+ matches |
| Promise without delivery | Promise phrase + <100 chars remaining or <3 newlines after | Any match |

Pre-filter: strip lines starting with `#` (markdown headings) and lines matching `/^\s*\d+[.)]/` (numbered lists) before running the regex — these naturally have `:[A-Z]` and `.[A-Z]` patterns. The negative lookbehind also excludes `://` in URLs and single-letter abbreviations (`U.S.A`).

Promise phrases: `here's the plan`, `here is the plan`, `let me write`, `writing it now`, `let me create`, `let me design`.

**2. Missing Deliverable Detection**

| Signal | Heuristic |
|--------|-----------|
| User requested actionable work | `/(?:set up\|configure\|help .* with\|create\|build) .{5,}/i` |
| Excluded: questions | Ends with `?` or starts with `did\|can\|could\|would\|have\|has\|is\|are\|was` |
| No structured content | No numbered list (3+ items), no code block, no markdown headings |
| Short response | < 500 chars |

All four conditions must be true to trigger.

**3. Tool-Heavy Silence Detection**

| Signal | Heuristic |
|--------|-----------|
| Heavy tool use, minimal follow-up | `toolUseCount >= 8` AND `textLengthAfterLastTool < 100` |
| Moderate tool use, near-empty response | `toolUseCount >= 5` AND `assistantContent.length < 50` |

#### Recovery Action

When detected, the watchdog injects a system turn tailored to the failure type:

- **Garbled:** "Your last response appeared incomplete — it contained concatenated fragments. Please provide the complete response."
- **Tool-heavy silence:** "You used N tools but your final response was very brief. Please provide a substantive answer."
- **Missing deliverable:** "You were asked to [request] but your response didn't include the deliverable. Please provide it now."

---

### Collision Prevention

Both watchdogs inject system turns into the brain via `SessionManager.streamMessage()`. Without guards, they can race or double-alert.

#### Collision 1: Session race

`ci.alert()` (working agent failure) and `injectRecovery()` (conversation watchdog) both call `sm.streamMessage()`. If both fire on the same conversation simultaneously, two SDK queries run on the same session — interleaved events, corrupted transcript.

**Guard:** Add `isStreaming(conversationId)` to the `SessionFactory` interface (which `ConversationInitiator` already uses). Implement it in `app.ts` by checking the session registry. Then add the check in `alert()` after resolving the active conversation — if busy, return `false` (falls through to `initiate()` which creates a new conversation with its own session).

```typescript
// SessionFactory interface — add:
isStreaming(conversationId: string): boolean;

// Implementation in app.ts sessionFactory:
isStreaming(conversationId) {
  const sm = app.sessionRegistry.get(conversationId);
  return sm?.isStreaming() ?? false;
},

// In ConversationInitiator.alert(), after resolving active conversation:
if (this.sessionFactory.isStreaming(active.id)) {
  console.warn("[ConversationInitiator] Session busy, falling back to initiate()");
  return false;  // caller falls through to initiate()
}
```

#### Collision 2: Double alert for same root cause

User asks brain something → brain delegates to working agent via channel trigger → working agent fails. Two things could happen:
- Working agent watchdog fires (failed job alert)
- Conversation watchdog fires (brain's response about the delegation was garbled/short)

These are about **different things** (job failure vs. conversation quality) but the user gets two messages about the same underlying problem.

**Guard:** Use a shared `Map<string, number>` (conversationId → timestamp) injected into both systems via deps. `AutomationProcessor.handleNotification()` writes to it after a successful `ci.alert()`. `PostResponseHooks.responseWatchdog()` reads it — if an automation alert fired within 60 seconds for this conversation, skip the conversation watchdog.

```typescript
// Shared map, created in app.ts:
const recentAutomationAlerts = new Map<string, number>();

// Wired into AutomationProcessor (new optional callback):
onAlertDelivered?: (conversationId: string) => void;
// Called after ci.alert() succeeds in handleNotification():
this.config.onAlertDelivered?.(activeConversationId);

// Wired into PostResponseHooksDeps:
recentAutomationAlerts?: Map<string, number>;

// In PostResponseHooks.responseWatchdog():
const lastAlert = this.deps.recentAutomationAlerts?.get(conversationId) ?? 0;
if (Date.now() - lastAlert < 60_000) {
  this.deps.log("[ResponseWatchdog] Skipping — automation alert just fired for this conversation");
  return;
}
```

In `app.ts`, wire both sides to the same map instance.

#### Collision 3: Stale job + notification retry double-alerting

`checkStaleJobs()` marks a job failed and alerts. If the alert fails, `notificationPending` gets set. On the next cycle, retry fires for the same job.

**Guard:** `checkStaleJobs()` sets `notificationPending` only if its own alert attempt fails. If it succeeds, no pending flag. The retry system only acts on pending flags, so no double-alert.

---

### Part 2: Working Agent Watchdog

#### Architecture

```
AutomationProcessor.executeAndDeliver()
  ↓ job completes
AutomationExecutor.run() returns ExecutionResult
  ↓
Post-execution checks (in AutomationProcessor):
  1. Empty deliverable? → alert user
  2. Job failed? → always alert user (not just log)
  ↓
AutomationScheduler (background, every 60s):
  3. Stale jobs? (running > timeout) → mark failed + alert user
  ↓
handleNotification():
  4. Notification delivery failed? → retry once via alternate path
```

#### 1. Empty Deliverable Detection

In `AutomationProcessor.executeAndDeliver()`, after the executor returns:

```typescript
// After result = await this.config.executor.run(...)
if (result.success && (!result.work || result.work.trim().length < 20)) {
  // Job "completed" but produced nothing useful
  console.warn(`[AutomationProcessor] Empty deliverable for "${automation.manifest.name}" (job ${job.id})`);
  // Downgrade to failed
  this.config.jobService.updateJob(job.id, {
    status: "failed",
    summary: "Completed with empty deliverable — no useful output produced",
  });
  result.success = false;
  result.error = "empty_deliverable";
}
```

This catches the case where the SDK session completes without errors but the brain produced nothing useful. The job is downgraded from "completed" to "failed" so it flows into the failure notification path.

#### 2. Failed Job Alerting

Currently, `handleNotification()` only sends notifications for `notify: "immediate"` or `needs_review` jobs. Failed jobs are logged to console and ignored.

Add a new block to `handleNotification()`:

```typescript
// Always alert on failure — regardless of notify setting
if (!result.success && ci) {
  const errorSummary = result.error === "empty_deliverable"
    ? `completed but produced no useful output`
    : `failed: ${result.error ?? "unknown error"}`;
  const prompt = `A working agent running "${automation.manifest.name}" ${errorSummary}.\n\n` +
    `Job ID: ${jobId}\n\n` +
    `You are the conversation layer — let the user know briefly. ` +
    `If the error seems transient, suggest they can re-trigger it. ` +
    `Don't be dramatic — just inform.`;
  const alerted = await ci.alert(prompt);
  if (!alerted) {
    await ci.initiate({ firstTurnPrompt: `[SYSTEM: ${prompt}]` });
  }
}
```

#### 3. Stale Job Detection

Add a `checkStaleJobs()` method to `AutomationScheduler`, called alongside `checkDue()`:

- Call `jobService.listJobs({ status: "running" })` (returns all running jobs — always a tiny set)
- Filter in TypeScript: `job.created < (now - 30 minutes)` — no new DB query method needed
- Mark as `failed` with summary `"Timed out — stuck in running state for >30 minutes"`
- Alert user via `ConversationInitiator`

The 30-minute timeout is generous — most automations complete in under 5 minutes. This catches SDK sessions that hang indefinitely.

#### 4. Notification Delivery Retry

In `handleNotification()`, if `ci.alert()` returns `false` (no active conversation) AND `ci.initiate()` throws:

- Log at error level with job ID and automation name
- Store retry state in the job's existing `context` field: `{ notificationPending: true, notificationAttempts: 1 }` — avoids adding new fields to the `Job` type or DB schema
- In `checkStaleJobs()` (already runs every 60s), also scan for jobs with `notificationPending` in context. Retry `ci.alert()` / `ci.initiate()`. Increment `notificationAttempts`. After 3 attempts, clear `notificationPending` and log at error level.

This is the lightest-touch retry: no schema changes, no separate queue, uses the existing job context field and scheduler loop.

---

## Tasks

### Conversation Watchdog — Detection Engine

| # | Task | Files | Depends |
|---|------|-------|---------|
| 1 | Create `StreamMetadata` and `WatchdogDiagnosis` types | `packages/dashboard/src/conversations/response-watchdog.ts` | — |
| 2 | Implement `detectGarbledResponse()` — concatenated monologue regex + promise-without-delivery | same | 1 |
| 3 | Implement `detectMissingDeliverable()` — deliverable request detection + structured content check + question exclusion | same | 1 |
| 4 | Implement `detectToolHeavySilence()` — threshold checks on tool count vs. content length | same | 1 |
| 5 | Implement `runWatchdog()` — calls all three detectors in priority order (garbled > tool-heavy > deliverable) | same | 2, 3, 4 |

### Conversation Watchdog — Stream Instrumentation

| # | Task | Files | Depends |
|---|------|-------|---------|
| 6 | Add `isStreaming()` method to `SessionManager` — exposes `activeQuery !== null` | `packages/dashboard/src/agent/session-manager.ts` | — |
| 7 | Add stream counters in `sendMessage()` — `toolUseCount`, `textLengthAfterLastTool`, `fullAssistantContent` (tracks across splits) | `packages/dashboard/src/chat/chat-service.ts` | — |
| 8 | Pass `streamMetadata` to `postResponseHooks.run()` | `packages/dashboard/src/chat/chat-service.ts` | 7 |

### Conversation Watchdog — Hook Integration

| # | Task | Files | Depends |
|---|------|-------|---------|
| 9 | Add `injectRecovery?` callback and `StreamMetadata` to `PostResponseHooksDeps` | `packages/dashboard/src/conversations/post-response-hooks.ts` | 1 |
| 10 | Add `responseWatchdog()` private method with 5-minute cooldown + logging (log even when rate-limited) | same | 5, 9 |
| 11 | Add watchdog to `Promise.all` in `run()` | same | 10 |

### Conversation Watchdog — Recovery Wiring

| # | Task | Files | Depends |
|---|------|-------|---------|
| 12 | Wire `injectRecovery` callback in `PostResponseHooks` deps — get session, guard `isStreaming()`, inject system turn, append transcript, broadcast WebSocket, send via outbound channel | `packages/dashboard/src/app.ts` | 6, 9 |

### Working Agent Watchdog

| # | Task | Files | Depends |
|---|------|-------|---------|
| 13 | Empty deliverable detection — after `executor.run()`, if `result.success` but `work` is empty/tiny (<20 chars), downgrade to `failed` with `error: "empty_deliverable"` | `packages/dashboard/src/automations/automation-processor.ts` | — |
| 14 | Failed job alerting — in `handleNotification()`, always alert user on `!result.success` regardless of `notify` setting. Use `ci.alert()` with fallback to `ci.initiate()` | same | 13 |
| 15 | Stale job detection — add `checkStaleJobs()` to `AutomationScheduler`. List running jobs, filter by age in TypeScript (>30 min), mark failed, alert user. Set `notificationPending` in job context only if alert fails | `packages/dashboard/src/automations/automation-scheduler.ts` | 14 |
| 16 | Notification retry — on `alert()`/`initiate()` failure, store `{ notificationPending, notificationAttempts }` in job's `context` field. In `checkStaleJobs()`, retry pending notifications (max 3 attempts) | `packages/dashboard/src/automations/automation-processor.ts`, `packages/dashboard/src/automations/automation-scheduler.ts` | 15 |

### Collision Guards

| # | Task | Files | Depends |
|---|------|-------|---------|
| 17 | Add `isStreaming(conversationId)` to `SessionFactory` interface + implement in `app.ts` via session registry. Add guard in `ConversationInitiator.alert()` — if session busy, return `false` | `packages/dashboard/src/agent/conversation-initiator.ts`, `packages/dashboard/src/app.ts` | 6 |
| 18 | Create shared `recentAutomationAlerts` map in `app.ts`. Wire write side into `AutomationProcessor` via `onAlertDelivered` callback. Wire read side into `PostResponseHooksDeps`. Conversation watchdog skips if automation alert fired <60s ago | `packages/dashboard/src/automations/automation-processor.ts`, `packages/dashboard/src/conversations/post-response-hooks.ts`, `packages/dashboard/src/app.ts` | 10, 14 |

---

## Implementation Order

```
Step 1 (parallel):  Tasks 1, 6, 7, 13   — types, isStreaming(), counters, empty deliverable
Step 2 (parallel):  Tasks 2, 3, 4, 14   — three detectors, failed job alerting
Step 3 (parallel):  Tasks 5, 15, 17     — runWatchdog(), stale jobs, alert() streaming guard
Step 4:             Tasks 8, 9          — pass metadata + extend deps interface
Step 5:             Tasks 10, 11, 16    — hook orchestration + cooldown, notification retry
Step 6:             Tasks 12, 18        — wire recovery callback + collision suppression
```

Each step is safe independently. No broken intermediate states — unconnected code simply doesn't fire until the final wiring in step 6. Working agent tasks (13-16) are fully independent of conversation watchdog tasks (1-12). Collision guards (17-18) depend on both being wired.

## Error Recovery Matrix

### Conversation Watchdog

| Failure | What Happens | Result |
|---------|-------------|--------|
| Detection false positive | Unnecessary nudge sent to brain | Brain responds normally; user sees an extra message |
| `injectRecovery` throws | Caught by `.catch(() => {})` | Logged by `logError`, no user impact |
| Session busy (user sent new message) | `isStreaming()` returns true | Recovery skipped, logged |
| Recovery response is itself garbled | Bypasses `PostResponseHooks` | No recursive trigger; cooldown prevents retry for 5 min |
| Service restarts during cooldown | In-memory map clears | At most one extra recovery attempt — acceptable |
| WebSocket disconnected | `broadcastToConversation` no-op | Recovery saved to transcript, visible on reconnect |

### Working Agent Watchdog

| Failure | What Happens | Result |
|---------|-------------|--------|
| Empty deliverable false positive | Job marked failed when it shouldn't be | User notified, can re-trigger. Threshold (20 chars) is conservative |
| `ci.alert()` + `ci.initiate()` both fail | Notification stored as pending | Retried on next scheduler cycle, max 3 attempts |
| Stale job false positive (long-running task) | Job killed after 30 min | 30 min is generous; long tasks should use `autonomy: "cautious"` with checkpoints |
| Retry loop exhaustion (3 failed attempts) | Notification dropped | Logged at error level; job visible in dashboard jobs list |
| `checkStaleJobs()` throws | Caught by scheduler's existing try/catch | Logged, scheduler continues polling |

## Verification

### Conversation Watchdog
- [ ] Unit test: garbled text from the actual bug triggers `detectGarbledResponse()`
- [ ] Unit test: normal multi-sentence response with proper spacing does NOT trigger
- [ ] Unit test: response with URLs does NOT trigger garbled detection
- [ ] Unit test: question-form user message does NOT trigger deliverable detection
- [ ] Unit test: 14 tool uses + 20 chars response triggers `detectToolHeavySilence()`
- [ ] Unit test: 2 tool uses + 20 chars response does NOT trigger

### Working Agent Watchdog
- [ ] Empty deliverable: automation returns `success: true` with empty `work` → job downgraded to `failed`
- [ ] Failed job: any failed automation triggers user notification via `alert()`/`initiate()`
- [ ] Stale job: job stuck in `running` for >30 min → marked failed + user notified
- [ ] Notification retry: failed alert retried on next scheduler cycle

### Collision Guards
- [ ] `ci.alert()` while session is streaming → returns `false`, falls through to `initiate()` (new conversation)
- [ ] Working agent fails + conversation watchdog detects garble on same conversation → only automation alert fires (60s suppression)
- [ ] Stale job marked failed → alert succeeds → no `notificationPending` set → no retry double-alert

### Integration
- [ ] `npm run format` passes
- [ ] Dashboard restart succeeds
- [ ] Normal conversation flow unaffected
- [ ] Normal automation execution unaffected
