# S2 External Code Review — Deps Wiring at App Boot

**Sprint:** M9.6-S2 — `sprint/m9.6-s2-deps-boot-wiring`
**Reviewer:** Claude Sonnet 4.6 (external review session)
**Date:** 2026-04-15
**Spec ref:** `docs/sprints/m9.6-capability-resilience/plan.md` §4

---

## Verdict

**APPROVED**

All plan requirements are satisfied. TypeScript compiles clean. All 6 acceptance tests pass. One real bug is noted (FU2: `idleTimerManager.shutdown()` not called during `App.shutdown()`) but it is already filed in FOLLOW-UPS.md and is not a blocking defect for this sprint's goal. No deviations were required.

---

## Plan ↔ Code Audit

| Plan requirement | Location | Status | Notes |
|---|---|---|---|
| §4.1 — `IdleTimerManager` constructor takes `getViewerCount` callback, not `ConnectionRegistry` | `idle-timer.ts:20-28` | DONE | Signature correct; default `() => 0` |
| §4.1 — `setViewerCountFn(fn)` setter added | `idle-timer.ts:35-37` | DONE | Public method, correct signature |
| §4.1 — `AttachmentService` constructed in boot path | `app.ts:1850` | DONE | |
| §4.1 — `IdleTimerManager` constructed in boot path | `app.ts:1851-1853` | DONE | Conditional on `app.abbreviationQueue` (correct for unhatched agents) |
| §4.1 — `app.chat.setDeps()` called after `new AppChatService(app)` | `app.ts:1854-1862` | DONE | Called at line 1854 immediately after `app.chat` at 1841 |
| §4.2 — Module-level `idleTimerManager` and `attachmentService` singletons removed | `chat-handler.ts:9-17` | DONE | Imports removed, let-declarations gone |
| §4.2 — First-connect init block removed (was lines 38–69) | `chat-handler.ts` | DONE | Block gone; replaced with `setViewerCountFn` call + `onRenamed` guard |
| §4.2 — `app.chat.setDeps()` call removed from WS handler | `chat-handler.ts` | DONE | Removed entirely |
| §4.2 — WS handler calls `setViewerCountFn` on connect | `chat-handler.ts:35-37` | DONE | Called unconditionally per every connect (D3 logged) |
| §4.3 — `message-handler.ts` NOT modified (no own CFR emit added) | `message-handler.ts` | DONE | File not in diff |
| Acceptance test: `boot-deps-wired.test.ts` (4 tests) | `tests/cfr/boot-deps-wired.test.ts` | DONE | All 4 pass |
| Acceptance test: `whatsapp-before-browser.test.ts` (2 tests) | `tests/e2e/whatsapp-before-browser.test.ts` | DONE | Both pass |
| Existing `conversations.test.ts` updated for new constructor | `tests/conversations.test.ts` | DONE | 5 call sites updated to lambdas |
| `npx tsc --noEmit` passes | both packages | DONE | Clean, zero errors |
| DECISIONS.md updated | `s2-DECISIONS.md` | DONE | 4 decisions logged with rationale |
| DEVIATIONS.md filed (no deviations) | `s2-DEVIATIONS.md` | DONE | Correctly states no proposals filed |
| FOLLOW-UPS.md | `s2-FOLLOW-UPS.md` | DONE | 3 items filed |

---

## Findings

### Bug: `idleTimerManager.shutdown()` not called in `App.shutdown()`

**Severity:** Minor / Non-blocking for S2.

`IdleTimerManager` owns a `Map<string, NodeJS.Timeout>`. Its `shutdown()` method (`idle-timer.ts:97-102`) clears all pending timers. After S2, `app.idleTimerManager` is an App-owned field, but `App.shutdown()` (lines 1881–1921) does not call `app.idleTimerManager?.shutdown()`.

**Impact:** On clean `App.shutdown()` (tests, headless scripts), all pending idle timers leak until process exit. If the abbreviation queue drains (`this.abbreviationQueue.drain()` at line 1889) before the timers fire, the timers will call `this.queue.enqueue()` on a drained queue — behavior depends on `AbbreviationQueue.enqueue()` implementation post-drain. In the worst case, this logs an error or throws. In practice, Node process exit cleans up anyway, but it's sloppy.

The implementer already identified this as FU2 in FOLLOW-UPS.md. Fix is a one-liner in `App.shutdown()`. This should be resolved before S4 (when the recovery orchestrator is expected to interact with App lifecycle).

### Observation: ordering of `setDeps` fields relative to their construction

`postResponseHooks` is initialized at line 731, `conversationSearchService` at line 1072, `abbreviationQueue` at line 612 — all within `App.create()`, all before the boot wiring block at line 1851. Ordering is correct. No null-injection risk.

### Observation: `setViewerCountFn` called on every WS connect, not just first

The plan says "on first connect via a setter method." The implementer calls it on every connect (D3). This is harmless because:
1. The function reference is always the same bound method from the same `connectionRegistry`.
2. There is no state toggle that would differ per-call.
3. Avoiding a guard keeps the code simpler.

D3 is well-reasoned and acceptable.

### Observation: `onRenamed` guard preserved correctly

Pre-S2, the `onRenamed` callback was inside the `idleTimerManager` init block (first-connect only, because the whole block had an `if (!idleTimerManager)` guard). Post-S2, the `onRenamed` block has its own explicit `!fastify.abbreviationQueue.onRenamed` guard (`chat-handler.ts:40`). First-connect semantics are preserved. This is correct.

### Observation: `console.*` vs structured pino logger

Boot wiring uses `console.log`/`console.error` as the log callbacks passed to `setDeps`, while the old WS-handler path used `fastify.log.info`/`fastify.log.error`. This is a pre-existing gap (channel-origin messages always bypassed the WS log path) not introduced by S2. Filed as FU1 and appropriate for a later sprint.

---

## Nitpicks (no action required)

1. **`IdleTimerManager` field comment** (`idle-timer.ts:13-15`) mentions "WS handler upgrades to the real ConnectionRegistry.getViewerCount on first connect." After D3, it's upgraded on *every* connect, not just first. Minor doc drift.

2. **`app.attachmentService` field placement** — the two new fields (`idleTimerManager`, `attachmentService`) are placed between `postResponseHooks` and `statePublisher` (lines 353-358). They could be grouped with conversation-tier services for cohesion. Not worth moving.

3. **Test: `makeTestApp` duplicated across two test files** — `boot-deps-wired.test.ts` and `whatsapp-before-browser.test.ts` both define identical `makeTestApp` helpers. A shared test fixture module would reduce copy-paste. Out of scope for S2, but worth a future cleanup.

---

## Sprint artifacts assessment

| Artifact | Quality | Notes |
|---|---|---|
| DECISIONS.md | Good | 4 decisions, all with clear rationale and blast-radius assessment |
| DEVIATIONS.md | Good | Correctly states no proposals filed; lists satisfied requirements |
| FOLLOW-UPS.md | Good | 3 items, all genuinely out-of-scope, no suppressed bugs |
