# M9-S3.1: Heartbeat & Error Recovery -- External Review

> **Reviewer:** Claude Opus 4.6 (external)
> **Date:** 2026-04-02
> **Branch:** `sprint/m9-s3-whatsapp-skillgen`
> **Verdict:** Approve with one Important fix required

---

## Summary

The implementation is faithful to the plan across all 18 tasks. Code quality is high: TypeScript compiles cleanly (`tsc --noEmit` passes with zero errors), all detection functions are pure and testable, safety properties are correctly implemented, and the collision guard architecture works as designed. One Important bug (double-alerting on failed `notify: "immediate"` jobs) needs to be fixed before merge.

---

## 1. Spec Compliance -- Task-by-Task

| Task | Status | Notes |
|------|--------|-------|
| 1. `StreamMetadata` + `WatchdogDiagnosis` types | Done | In `response-watchdog.ts` lines 29-41 |
| 2. `detectGarbledResponse()` | Done | Both signals implemented. Regex tested against plan's example text: correctly triggers at exactly 3 matches |
| 3. `detectMissingDeliverable()` | Done | All four conditions implemented. Extra action verbs added (`implement`, `add`, `install`, `fix`, `write`) beyond spec -- a beneficial deviation |
| 4. `detectToolHeavySilence()` | Done | Both threshold pairs implemented per spec |
| 5. `runWatchdog()` | Done | Priority order correct: garbled > tool-heavy > deliverable |
| 6. `isStreaming()` on `SessionManager` | Done | Checks `this.activeQuery !== null` |
| 7. Stream counters in `sendMessage()` | Done | `toolUseCount`, `textLengthAfterLastTool`, `fullAssistantContent` all tracked |
| 8. Pass `streamMetadata` to hooks | Done | Includes `toolUseCount`, `cost`, `textLengthAfterLastTool` |
| 9. `injectRecovery` + `StreamMetadata` in deps | Done | Both added to `PostResponseHooksDeps` |
| 10. `responseWatchdog()` with cooldown | Done | 5-minute cooldown, logs even when rate-limited |
| 11. Watchdog in `Promise.all` | Done | Added alongside `detectMissedTasks` and `augmentWithVisual` |
| 12. Wire `injectRecovery` in `app.ts` | Done | Full wiring: get session, `isStreaming()` guard, inject turn, append transcript, broadcast WS, send via channel |
| 13. Empty deliverable detection | Done | Threshold <20 chars, downgrades to failed |
| 14. Failed job alerting | Done | `ci.alert()` with `ci.initiate()` fallback |
| 15. Stale job detection | Done | 30-min threshold, TypeScript filtering, marks failed + alerts |
| 16. Notification retry | Done | Uses job context field, max 3 attempts, retried in `checkStaleJobs()` |
| 17. `isStreaming()` on `SessionFactory` + guard in `alert()` | Done | Interface extended, implemented in `app.ts`, guard in `ConversationInitiator.alert()` |
| 18. Shared `recentAutomationAlerts` map | Done | Created in `app.ts`, write side via `onAlertDelivered`, read side in `PostResponseHooks` |

**Deviations from plan:**
- `session-registry.ts` gained a `get()` method not listed in the plan. This is a necessary supporting change for task 17 (`isStreaming` implementation in `app.ts` needs to look up sessions without creating them). Justified.
- `automation-job-service.ts` gained `updateJobContext()` not explicitly listed as a task but required by task 16 (notification retry storage). Justified.
- `detectMissingDeliverable()` adds extra action verbs (`implement`, `add`, `install`, `fix`, `write`) beyond the plan's regex. Beneficial -- catches more real user requests.

---

## 2. Code Quality

### TypeScript
- `npx tsc --noEmit`: **zero errors**
- Types are clean and well-defined

### Error Handling
- All async paths properly caught:
  - `checkStaleJobs()` has `.catch()` at call site in `start()`
  - `responseWatchdog()` wraps everything in try/catch with `logError`
  - `markNotificationPending()` failures are non-fatal (no throw)
  - `notifyFailure()` throws on failure, properly caught by callers

### Console Usage
- `console.warn` for expected-but-notable conditions (stale jobs, empty deliverables) -- appropriate
- `console.error` for exhausted retries -- appropriate
- `console.log` for recovery actions and rate-limiting -- appropriate for operational visibility
- No stray `console.log` in hot paths

### Code Organization
- `response-watchdog.ts` is purely functional with no side effects -- excellent testability
- Constants extracted to named variables at module top -- easy to tune
- Clear separation: detection in `response-watchdog.ts`, orchestration in `post-response-hooks.ts`, wiring in `app.ts`

---

## 3. Safety Properties

### [PASS] Recovery responses bypass PostResponseHooks
The `injectRecovery` callback in `app.ts` (line ~710) calls `sm.injectSystemTurn()` directly, NOT `sendMessage()`. The `sendMessage()` path in `chat-service.ts` is the only place that calls `postResponseHooks.run()`. Therefore, recovery responses never re-enter the watchdog.

### [PASS] 5-minute cooldown per conversation
`PostResponseHooks.watchdogCooldowns` is a `Map<string, number>` keyed by `conversationId`. Checked with `WATCHDOG_COOLDOWN_MS = 5 * 60 * 1000`. Logging occurs even when rate-limited.

### [PASS] `isStreaming()` guard on `injectRecovery`
Checked at `app.ts` line ~717: `if (sm.isStreaming()) { ... return null; }`.

### [PASS] `isStreaming()` guard on `ci.alert()`
Checked at `conversation-initiator.ts` line ~103: `if (this.sessionFactory.isStreaming(active.id)) { ... return false; }`.

### [PASS] `SessionFactory` interface has `isStreaming()` method
Added at `conversation-initiator.ts` line ~30: `isStreaming(conversationId: string): boolean;`.

### [PASS] `recentAutomationAlerts` map shared between both systems
Created in `app.ts` line ~401. Passed to `PostResponseHooksDeps` at line ~709. Written by `onAlertDelivered` callback at line ~1226. Same `Map` instance.

### [PASS] Stale job detection filters in TypeScript (not SQL)
`checkStaleJobs()` calls `listJobs({ status: "running" })` then filters with `age > STALE_THRESHOLD_MS` in a for-loop.

### [PASS] Notification retry uses job context field (no schema changes)
`markNotificationPending()` uses `updateJobContext()` which writes to the existing `context` field. No new DB columns.

---

## 4. Issues

### Important (should fix)

**Double-alerting on failed `notify: "immediate"` jobs.**

In `handleNotification()`, the `notify === "immediate"` block (line 177) runs for ALL results including failures (it checks `result.success` internally to build the summary but still sends the alert). Then the `!result.success` block (line 218) ALSO runs unconditionally. When a job with `notify: "immediate"` fails, the user gets TWO alerts:
1. From the "immediate" block: "A working agent just finished... Results: Error: ..."
2. From the "failure" block: "A working agent running... failed: ..."

**Fix:** Add `&& result.success` to the `notify === "immediate"` condition, or add `&& notify !== "immediate"` to the failure block. The simplest fix:

```typescript
// Line 177: change from
if (notify === "immediate" && ci) {
// to
if (notify === "immediate" && result.success && ci) {
```

This way, successful immediate jobs get the detailed notification, and failed jobs (regardless of notify setting) get the failure-specific notification.

### Suggestions (nice to have)

**1. `updateJobContext` docstring says "merges" but replaces.**

The method at `automation-job-service.ts` line 143 says "merges into existing context" but does `job.context = context` (full replacement). All callers spread `...ctx` so behavior is correct, but the docstring is misleading. Consider changing to "replaces job context" or actually merging: `job.context = { ...(job.context ?? {}), ...context }`.

**2. `notifyFailure` silently returns when no CI exists.**

In `automation-scheduler.ts` line 262, if `this.config.conversationInitiator` is null, `notifyFailure()` returns without throwing. This means `checkStaleJobs()` thinks the notification succeeded and does NOT set `notificationPending`. The job is marked failed but the user is never told. Consider throwing when CI is unavailable so the retry path is used:

```typescript
if (!ci) throw new Error("No ConversationInitiator available");
```

**3. `onAlertDelivered` resolves active conversation independently.**

In `app.ts` line ~1224, the `onAlertDelivered` callback looks up the active conversation using `getActiveConversation(15)`. This is the same lookup that `ci.alert()` uses, but it happens AFTER the alert completes. In theory, a new conversation could become active between the alert and the callback, causing the wrong conversation ID to be recorded in `recentAutomationAlerts`. In practice this is very unlikely (milliseconds apart), but a cleaner design would have `ci.alert()` return the conversation ID it used.

---

## 5. Edge Cases

### Empty strings to `runWatchdog()`
Tested: `detectGarbledResponse` returns null for content <30 chars. `detectToolHeavySilence` returns null when `toolUseCount` is 0. `detectMissingDeliverable` returns null when `userContent` is empty. All safe.

### `streamMetadata` is undefined
Handled in `responseWatchdog()` at `post-response-hooks.ts` line ~124: falls back to `{ toolUseCount: 0, cost: undefined, textLengthAfterLastTool: assistantContent.length }`. Safe.

### Garbled regex on plan's test text
Tested: produces exactly 3 matches (`:G`, `.S`, `.G`) -- hits the threshold of 3 exactly. Works correctly. URL text with `://` produces zero matches due to the negative lookbehind.

### `onAlertDelivered` before `recentAutomationAlerts` initialized
Not possible. The map is created synchronously in `App.create()` at line ~401, before any automation processor or scheduler is constructed. All callbacks reference it via closure.

---

## 6. Files Modified

| File | In Plan? | Notes |
|------|----------|-------|
| `docs/ROADMAP.md` | No | Roadmap entry for S3.1 -- expected bookkeeping |
| `docs/sprints/m9-s3.1-heartbeat-error-recovery/plan.md` | N/A | The plan itself (new file) |
| `packages/dashboard/src/conversations/response-watchdog.ts` | Yes | New file, tasks 1-5 |
| `packages/dashboard/src/conversations/post-response-hooks.ts` | Yes | Tasks 9-11 |
| `packages/dashboard/src/agent/session-manager.ts` | Yes | Task 6 |
| `packages/dashboard/src/agent/session-registry.ts` | No | Supporting change for task 17 -- justified |
| `packages/dashboard/src/agent/conversation-initiator.ts` | Yes | Task 17 |
| `packages/dashboard/src/app.ts` | Yes | Tasks 12, 17, 18 |
| `packages/dashboard/src/chat/chat-service.ts` | Yes | Tasks 7, 8 |
| `packages/dashboard/src/automations/automation-processor.ts` | Yes | Tasks 13, 14, 16 |
| `packages/dashboard/src/automations/automation-scheduler.ts` | Yes | Tasks 15, 16 |
| `packages/dashboard/src/automations/automation-job-service.ts` | No | Supporting change for task 16 -- justified |

No unexpected files modified. All unplanned files are justified supporting changes.

---

## 7. What Was Done Well

- The pure-functional design of `response-watchdog.ts` is excellent -- easy to test, easy to tune, no hidden state.
- Collision guards are thoughtfully designed. The shared `recentAutomationAlerts` map with 60-second suppression is an elegant solution to a real problem.
- The `isStreaming()` guard appears in both the `injectRecovery` callback AND `ConversationInitiator.alert()`, closing both race condition vectors.
- Constants are extracted and well-named, making future tuning straightforward.
- The notification retry system reuses existing infrastructure (job context field, scheduler loop) without schema changes -- minimal surface area.
- Error handling is thorough and non-fatal throughout -- the system degrades gracefully on any individual failure.

---

## Verdict

**Approve with one required fix:** the double-alerting bug on failed `notify: "immediate"` jobs (see Important issue above). After that fix, this is ready to merge.
