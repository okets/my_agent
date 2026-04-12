---
reviewer: external (Opus, general-purpose agent)
date: 2026-04-12
scope: spec.md
verdict: directionally correct, four substantive gaps to address before implementation
---

# External Review: M9.4-S5 Job Card Handoff Continuity

## Critical

### C1. `todoProgress` is stripped on non-running status

`StatePublisher._getJobSnapshots()` (`packages/dashboard/src/state/state-publisher.ts:530`) only populates `todoProgress` when `j.status === 'running'`. The moment the job flips to `completed`/`failed`/`needs_review`, the next `state:jobs` broadcast carries `todoProgress: undefined`.

The existing `activeCards` filter (`stores.js`: `j.status === "running" && j.todoProgress && j.todoProgress.items?.length > 0`) and the progress-card `currentStepText()` / todo list rendering both depend on `todoProgress`. Today this works only because `handleJobCompleted` pushes the *last running snapshot* into `completedCards` carrying its frozen todos.

The spec's "stay in handing-off with task list visible" requires the completed snapshot to still carry the todos, OR the frontend must freeze the last-seen `todoProgress` into a per-jobId cache on entering `handing-off`.

**Fix:** Either remove the `status === 'running'` gate in `_getJobSnapshots()` (populate `todoProgress` always), or preserve the existing `completedCards.push(job)` behavior and make sure the renamed `enterHandingOff` keeps that line.

### C2. `initiate()` path cannot fade a card that doesn't exist in the target conversation

When `ci.alert()` returns false (no current conversation), heartbeat falls through to `ci.initiate()`, which creates a brand-new conversation (`conversation-initiator.ts:174`). `state:jobs` is a global broadcast, but the active conversation rendered in the UI is conversation-scoped.

If the user is on a different conversation (or just landed on a fresh install), the tagged `start` arrives for a conversation the card isn't rendered in. Spec's risk #2 ("the very first turn of the new conversation also fades the right card") assumes the user is viewing the new conversation at the moment `start` fires — they aren't; `initiate()` *creates* it.

**Fix:** Either confirm cards are globally visible across conversations (since `Alpine.store("jobs")` is global, this may already work — verify), OR accept that the `initiate()` path always triggers the 10 s safety net and remove `triggerJobId` from `initiate()` scope.

## Important

### I1. Stray `start` events from non-system paths

`sendMessage()` at `chat-service.ts:650` yields `{ type: "start", _effects: ... }` on every user message. `handleModelCommand` yields `start` four times (`chat-service.ts:368, 385, 395, 413`). `chat-handler.ts:601/619` and `hatching/scripted-engine.ts:121/148/178` also yield `start`. The spec only addresses `send-system-message.ts:52`.

Frontend fix F4 says "progress-card listens for `assistant-turn-start` event" — but if `ws-client.js` emits that event for every `start` frame, then any user message during the handoff window broadcasts an untagged `start`. Spec's behavior on untagged `start` is ambiguous.

**Fix:** State explicitly that `ws-client.js` emits `assistant-turn-start` *only when `triggerJobId` is present*. Untagged `start` frames are ignored by the card.

### I2. Serial alert loop breaks multi-card acceptance criterion

The spec claims independence of multi-card handoff (acceptance #5). But `deliverPendingNotifications` (`heartbeat-service.ts:119`) is a `for` loop with `await` — alerts fire one at a time. The second alert's `start` cannot arrive until the first alert's whole stream (including TTS, `done`, etc.) completes.

For two cards completing within 2 s of each other, card #2 will wait for card #1's full response (5–30 s typical) before its `start` ever hits the frontend. The 10 s safety net will fire for card #2 every time, defeating the design's point.

**Fix:** Choose one of:
- Parallelize `deliverPendingNotifications` (risky — same conversation/session).
- Make the safety-net dynamic: if another alert is in flight on the queue, extend the timeout.
- Document this honestly in the spec as a known limitation (single-card handoff works perfectly; concurrent cards fall back to safety net).

### I3. `isStreaming()` early-return silently breaks the fade

`send-system-message.ts:45` returns early without yielding `start` if the session is busy. The notification stays enqueued (will retry next tick), but in the interim the card sits in `handing-off`. Safety net fires → card fades → 20 s later the real alert arrives tagged → no card to fade. The alert appears on a "silent" chat.

Also: verify the early-return path increments `delivery_attempts` so the `MAX_DELIVERY_ATTEMPTS` guard still trips.

**Fix:** Detect the busy-skip outcome at the heartbeat layer and either retry immediately or signal the frontend to extend the safety-net for that jobId.

### I4. `drainNow()` vs tick race is NOT idempotent

The spec asserts: "Idempotent: the persistent queue marks delivered by `_filename`, so concurrent calls cannot double-deliver." This is wrong.

Dedup happens at `markDelivered`, which runs *after* the expensive `await ci.alert()`. If `drainNow()` fires at t=0 and the 30 s tick fires at t=5 while the first alert is mid-await, both will call `listPending()`, both will see the notification still pending, both will invoke `ci.alert()`. Two alerts delivered, transcript turn duplicated.

**Fix:** Add an in-flight `Set<string>` on `HeartbeatService` keyed by `_filename`, checked at the top of the for-loop. Or a single mutex around `deliverPendingNotifications`.

### I5. Acceptance #3's 200 ms budget is unrealistic

`deliverPendingNotifications` does:
1. `listPending()` — disk read of queue directory (`heartbeat-service.ts:118`).
2. `formatNotification()` (cheap).
3. `ci.alert()` → `getLastWebMessageAge()` → 50-turn DB query (`conversation-initiator.ts:287`), then `sendSystemMessage` → `sessionRegistry.getOrCreate()` and `injectSystemTurn` (SDK post).

**Fix:** Either define the metric as "time from `[timing] enqueued` to the first line *inside* `deliverPendingNotifications`'s for-loop" (excluding SDK first-token), or raise the budget to ~1 s.

### I6. Setter pattern `processor.setHeartbeat(hb)` has no precedent

`AutomationProcessor` takes config in the constructor (`automation-processor.ts:52-57`). A setter means mutating `this.config` post-construction.

More concerning: heartbeat is constructed and started at `app.ts:1569`. If an `executeAndDeliver` fires before `setHeartbeat` runs (e.g., a scheduled automation firing during startup), `drainNow?.()` no-ops and the user waits the full 30 s.

**Fix:** Pin the setter call before `heartbeat.start()` in `app.ts`, OR refactor construction order so the heartbeat is instantiated before the processor and passed via constructor.

## Question

### Q1. Frontend `t0` for `[timing] start received jobId=X +Nms`

The instrumentation table includes this frontend log but doesn't define `t0`. `JobSnapshot.completed` is a string (ISO date) at `ws/protocol.ts:312`, so the frontend can compute `Date.now() - Date.parse(job.completed)` at the moment it sees status flip. Spec should state explicitly: `t0 = Date.parse(job.completed) captured when the card enters handing-off`.

### Q2. Mobile/desktop dual-component fade timers

Both `progressCard()` instances will run the same `setTimeout(1500) + setTimeout(2000)` fade timers on the same `fading` object and the same `completedCards` mutation. Idempotency of "remove if present" saves the result, but stacked `setTimeout` handles aren't cleared cross-component. Acceptable but worth documenting.

## Minor / Missed scope

### M1. `notify: "debrief"` regression

Today, debrief jobs fade after 2 s (current `handleJobCompleted` runs unconditionally). Under the spec, they fade after 10 s (safety net). That is a *regression* — visible dead card pinned to the compose box for 8 extra seconds.

**Fix:** Read `automation.manifest.notify` into the `state:jobs` snapshot. If `notify === "none"` or `notify === "debrief"`, the frontend skips `handing-off` entirely and runs the legacy 2 s fade.

### M2. `job_interrupted` cards always pay the full 10 s safety net

Spec mentions this. Just noting it: stale/interrupted jobs don't get fast-path drain, and no `start` is tagged for them, so 10 s is the floor.

### M3. `chat-service.ts:770` (post-tool-use continuation `start`)

The second `start` of a split assistant turn. Untagged and benign today. Flag for future if `triggerJobId` propagation ever extends to user-triggered turns.

### M4. `confirmStop()` flow

Verify the new phase state map doesn't leak entries for jobs the user dismissed via Stop. Spec F2 covers this — confirm during implementation.

### M5. `activeCards` filter still requires `status === "running"`

The spec introduces `handing-off` but doesn't explicitly say how the card survives the `state:jobs` broadcast where the job is no longer `running`. Today's `handleJobCompleted` pushes to `completedCards` for exactly this reason. Spec must state: entering `handing-off` pushes the job into `completedCards` (or a new `handingOffCards` list) so it keeps rendering.

## Verdict

Design is directionally correct. The two-pronged approach (fast drain + UI bridge) is sound. But four substantive holes need to be addressed before implementation:

1. **C1** (todoProgress stripping) — would silently break the visible state.
2. **C2** (initiate path) — design assumption is wrong; either fix or descope.
3. **I2** (serial alert loop) — makes acceptance criterion #5 unachievable as written.
4. **I4** (drainNow idempotency claim) — false; needs explicit mutex/in-flight guard.

Other items are smaller but should be addressed in a v2 of the spec.
