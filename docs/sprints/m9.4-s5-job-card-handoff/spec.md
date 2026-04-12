---
sprint: M9.4-S5
title: Job Card Handoff Continuity
status: spec (v3 — addresses external review v2 2026-04-12)
created: 2026-04-12
revised: 2026-04-12 (v2, then v3)
origin: M9.5-S6 FOLLOW-UPS.md UX-1
related_sprints:
  - M9.4-S1 (notification delivery / heartbeat)
  - M9.4-S3 (job progress card)
reviews:
  - external-review.md (v1 → v2)
  - external-review-v2.md (v2 → v3)
---

# M9.4-S5: Job Card Handoff Continuity

## Problem

After an automation finishes, there is a ~30-second silent gap between the job card disappearing from the chat area and Nina's "drafting" three-dots appearing. Users interpret the silence as "the job was lost." The progress UI exists precisely to show continuous activity; a 30-second dead zone right after "completion" defeats the point.

Observed during the CNN automation smoke test on 2026-04-12 (M9.5-S6).

## Root cause analysis

The "silent gap" has two cumulative contributors, in order of magnitude:

### Contributor 1 (dominant): heartbeat-driven notification delivery (~0–30 s)

`AutomationProcessor.handleNotification()` writes the completion notification to `PersistentNotificationQueue` (disk) and returns. Nothing else happens until `HeartbeatService` next ticks. The tick interval is 30 s (`packages/dashboard/src/app.ts:1569`). On average this adds ~15 s of pure wait; worst case ~30 s.

The heartbeat loop was designed for crash recovery and bounded retries (`MAX_DELIVERY_ATTEMPTS = 10`), not for staring-at-it latency.

### Contributor 2: post-completion serial work (~1–4 s)

Between "executor query loop ends" and "notification enqueued":

- `resolveJobSummaryAsync` — Haiku call to craft the summary string passed to the alert (`automation-processor.ts:241`).
- Optional `queryModel(haiku)` chart generation if the deliverable has chartable data (`automation-executor.ts:469`).

After the heartbeat picks up the notification, there is also SDK session init for the alert turn and first-token latency (~1–3 s).

### Architectural constraint: conversation Nina is single-threaded

Conversation Nina is single-threaded per conversation. The SDK session enforces "one assistant turn at a time" within a conversation. This means **alert delivery is necessarily serial** when multiple jobs complete close together — `deliverPendingNotifications` (`heartbeat-service.ts:119`) processes the queue with a `for await` loop. Any "parallel handoff" design is impossible at this layer.

This shapes the multi-card design (see [Multi-card handoff](#multi-card-handoff) below).

### Frontend interaction

The progress card's `handleJobCompleted` (`progress-card.js`) fires on the `state:jobs` broadcast that flips status to `completed`. It runs the existing 1.5 s "Done" → 0.5 s opacity fade → remove timeline. Net result: card vanishes around t≈2 s, then 0–28 s of nothing, then Nina starts.

## Goal

Close the perceptual gap so that one of the following always holds:
- Nina starts streaming within ~2 s of job completion (no perceptible silence), or
- The progress card stays visible in a "Done" state until Nina starts streaming.

Either alone would solve the UX problem; combining them makes the experience robust to residual latency and to jobs that never trigger an alert.

## Approach

Two complementary changes:

**A. Backend — event-triggered notification drain.** When `AutomationProcessor.handleNotification()` enqueues a notification, immediately invoke a new `HeartbeatService.drainNow()` method that runs the standard `deliverPendingNotifications()` loop (under a mutex). The 30 s tick remains as the crash-recovery / retry path, unchanged.

**B. Frontend — gate card fade on Nina's first token, with sibling-aware safety net.** The progress card transitions through three phases instead of two. On `status === completed/failed/needs_review` the card stays visible in a "Done" state. The fade-out only starts when the WebSocket signals that Nina has begun streaming the response triggered by *this specific* job. While waiting, any *other* card receiving its handoff resets this card's safety-net timer (because it proves the system is alive and progressing).

A reduces the gap from ~30 s to ~2–4 s. B masks the residual ~2–4 s by keeping the card visible across the handoff, and provides graceful fallback for jobs that never emit a follow-up turn (`notify: "none"` / `"debrief"`) plus correct sequencing for multi-card cases.

## Design

### Backend changes

#### B1. `HeartbeatService.drainNow()` with reentrancy guard

New public method on `HeartbeatService`. Runs the existing `deliverPendingNotifications()` loop, **but the loop itself is now guarded by a `draining` reentrancy flag** so concurrent callers (the new event-driven path and the existing 30 s tick) cannot double-deliver. (Note: in single-threaded JS this is a reentrancy guard, not a true mutex — the boolean flip is atomic. Calling it "the draining flag" in code, "mutex" elsewhere is informal shorthand.)

```ts
private draining = false;

async drainNow(): Promise<void> {
  if (this.draining) return;        // tick in progress; it'll handle this notification
  this.draining = true;
  try {
    await this.deliverPendingNotifications();
  } finally {
    this.draining = false;
  }
}

async tick(): Promise<void> {
  await this.checkStaleJobs();
  if (!this.draining) {
    this.draining = true;
    try { await this.deliverPendingNotifications(); }
    finally { this.draining = false; }
  }
  await this.checkCapabilityHealth();
}
```

This addresses external review **I4**: `markDelivered` happens *after* the await on `ci.alert()`, so without the mutex, two concurrent loops would each see the same notification as pending and double-deliver. With the mutex, only one loop runs at a time. The mutex is per-process — adequate since heartbeat is a singleton.

Errors swallowed (logged) so a transient failure does not affect job execution.

#### B2. `AutomationProcessor` invokes `drainNow()` post-enqueue

`AutomationProcessorConfig` gains an optional `heartbeat?: { drainNow(): Promise<void> }` reference, wired via a setter to dodge construction-order coupling:

```ts
class AutomationProcessor {
  setHeartbeat(hb: { drainNow(): Promise<void> }): void {
    this.config.heartbeat = hb;
  }
}
```

`app.ts` calls `processor.setHeartbeat(heartbeatService)` **before** `heartbeatService.start()`. This is the simplest fix for the construction-order issue (review **I6**); a job firing during the brief window before `setHeartbeat` is called will fall through to the next 30 s tick — degraded but not broken.

In `handleNotification()`, immediately after `notificationQueue.enqueue(...)`:

```ts
this.config.heartbeat?.drainNow().catch((err) => {
  console.warn(`[AutomationProcessor] drainNow failed for ${jobId}:`, err);
});
```

#### B3. Tag the alert turn with `triggerJobId`

Plumbing through the alert path so the WS `start` frame can carry the job id that triggered it:

1. **Protocol** (`packages/dashboard/src/ws/protocol.ts`):
   ```ts
   | { type: "start"; triggerJobId?: string }
   ```
   Backwards compatible (optional field).

2. **`SystemMessageOptions`** (`packages/dashboard/src/chat/types.ts`): add optional `triggerJobId?: string`.

3. **`sendSystemMessage`** (`packages/dashboard/src/chat/send-system-message.ts:52`): change yield from `{ type: "start" as const }` to `{ type: "start" as const, triggerJobId: options?.triggerJobId }`.

4. **`HeartbeatService.deliverPendingNotifications()`**: pass `triggerJobId: notification.job_id` through `ci.alert(prompt, options)`. `ConversationInitiator.alert()` accepts a new optional field on its options object and forwards it.

**Scope of `triggerJobId` propagation (review I1):** Only `sendSystemMessage` (system-injected turns) carries `triggerJobId`. The other sites that yield `{ type: "start" }` (`chat-service.ts:368, 385, 395, 413, 650, 770`, `chat-handler.ts:601/619`, `hatching/scripted-engine.ts:121/148/178`) are user-triggered or model-command-triggered turns and **must not** carry the field. The frontend (F4 below) ignores untagged `start` frames for the handoff event.

**`initiate()` path (review C2):** When `ci.alert()` returns false, heartbeat falls through to `ci.initiate()`. `initiate()` creates a brand-new conversation. **Per review C2, we descope `triggerJobId` from the `initiate()` path.** Reasons: the new conversation may not be visible to the user, and the card's progress state has no reliable mapping to a freshly-created conversation. The 10s safety net handles this case — card fades after 10s, the new conversation appears with Nina's reply. Acceptable for what is already a fresh-install / no-current-conversation edge case.

#### B4. `state:jobs` snapshot must preserve todoProgress on completion (review C1)

`StatePublisher._getJobSnapshots()` (`state-publisher.ts:530`) currently only populates `todoProgress` when `j.status === 'running'`. **Change:** populate `todoProgress` whenever `todos.json` exists in `job.run_dir`, regardless of status. This is required so the card can keep rendering its task list through the `handing-off` phase.

The frontend filter changes accordingly — see F1.

#### B5. Surface job notify policy in `state:jobs` snapshot (review M1)

Add `notify?: string` to `JobSnapshot` (sourced from `automation.manifest.notify`). Frontend uses this to skip handing-off entirely for jobs that will never emit an alert (`notify: "none"` / `"debrief"`) — those run the legacy 2 s fade with no regression.

#### B6. Detect busy-skip in `sendSystemMessage` (review I3)

`send-system-message.ts:45` returns early if the session is busy. Today this silently fails. **Change:**
- `sendSystemMessage` returns an explicit `{ type: "skipped"; reason: "session-busy" }` event (new in `ChatEvent` union, internal — not yielded over WS).
- `HeartbeatService.deliverPendingNotifications()` checks for this skip outcome. If skipped, **do not** call `markDelivered` and **do not** call `incrementAttempts` (today this path doesn't increment, which is the correct behavior — verify with test). Also do not decrement; the next tick will retry.
- The `handoff_pending` broadcast (B7) is what keeps the card alive across the busy-skip retry window.

#### B7. `handoff_pending` WS broadcast (review NF1 + NF4)

**New mandatory WS broadcast** emitted from `HeartbeatService.deliverPendingNotifications()`. Two-stage emission:

**Stage 1 — upfront batch (critical):** at the top of `deliverPendingNotifications`, after `listPending()` returns, immediately broadcast `handoff_pending` for *every* notification in the pending list — *before* entering the `for await` loop. This must happen before any `ci.alert()` blocks, so all queued cards learn at once that the system is processing them.

**Stage 2 — per-iteration (defense in depth):** at the top of each `for` loop iteration (just before `ci.alert()` for that notification), broadcast `handoff_pending` again for the current jobId. Refreshes the active card's clock right when its turn begins.

```ts
async deliverPendingNotifications() {
  const pending = this.notificationQueue.listPending();

  // Stage 1: upfront batch — fire all handoff_pending before any await
  for (const n of pending) {
    this.app.broadcast({ type: "handoff_pending", jobId: n.job_id });
  }

  // Stage 2: serial alert delivery, with per-iteration refresh
  for (const notification of pending) {
    if (notification.delivery_attempts >= MAX_DELIVERY_ATTEMPTS) { /* ... */ continue; }
    this.app.broadcast({ type: "handoff_pending", jobId: notification.job_id });  // refresh
    try { /* ci.alert(...) ... */ }
    catch { /* ... */ }
  }
}
```

**Protocol:** `{ type: "handoff_pending"; jobId: string }` (server → client). Fire-and-forget, no acknowledgment.

**Effect on the multi-card pipeline:**
- 3 cards complete near-simultaneously → all 3 enter handing-off at t=0.
- t≈0.3s: heartbeat runs Stage 1, broadcasts handoff_pending for A, B, C in immediate sequence (no await between them). All 3 cards' timers reset to fresh 10s.
- A's alert blocks for 15s of cold-start. B and C wait. Their timers expire at t≈10.3s if no further activity — but in practice the next refresh comes from A's `start` (when it eventually arrives), which the F4 frontend wiring also treats as a reset for siblings.
- When heartbeat moves to B, Stage 2 broadcasts `handoff_pending` for B, resetting B and C again. Pattern repeats.

**Covers:**
- NF4 (sibling pre-first-start hole): Stage 1 ensures all queued cards are refreshed before any blocking await.
- NF1 (busy-skip): if the alert is skipped at iteration N, the next tick retries — which calls `deliverPendingNotifications` again, which re-runs Stage 1 for everything still pending. Card N's clock keeps refreshing.

### Frontend changes (`packages/dashboard/public/js/progress-card.js`)

#### F1. Per-card phase state

Replace the existing `fading` map with:

```js
phase: {},          // { [jobId]: "running" | "handing-off" | "fading" | "done" }
safetyTimers: {},   // { [jobId]: timeoutHandle }
frozenSnapshot: {}, // { [jobId]: jobSnapshot } captured at moment of entering handing-off
```

`frozenSnapshot` is a defense-in-depth cache: even with B4 in place, freezing the snapshot at handoff time isolates the card from any future `state:jobs` mutation that could mess with rendering. (Review C1 mitigation, layered.)

#### F2. New phase transitions

| From | To | Trigger | Effect |
|------|----|---------|--------|
| `running` | `handing-off` | `state:jobs` flips this job to `completed` / `failed` / `needs_review` AND `notify` is not `none`/`debrief` | Freeze snapshot. Card stays at full opacity. Collapsed label flips to "Done" / "Failed" / "Needs review" with ✓ / ✕ / ⚠. Start `safetyTimer` (10 s) for this jobId. |
| `running` | `fading` (legacy path) | `state:jobs` flips this job to terminal AND `notify === "none"` or `notify === "debrief"` | Run the existing 1.5 s "Done" → 0.5 s fade → remove timeline. No handing-off phase. |
| `handing-off` | `fading` | WS event `{ type: "assistant-turn-start", triggerJobId: <this jobId> }` | Clear `safetyTimer`. Run the existing 1.5 s "Done at full opacity" → 0.5 s fade → remove. |
| `handing-off` | `fading` | `safetyTimer` expires | Same fade timeline. |
| `handing-off` | `handing-off` (refresh) | Any of: `assistant-turn-start` event for a *different* jobId; `handoff_pending` broadcast for *any* jobId (including this one) | Reset this card's `safetyTimer` to a fresh 10 s. (Sibling-aware, review I2 / NF4. The `handoff_pending` for this card's own jobId also resets — protects against alerts that take >10 s of cold-start before the first `start` token.) |
| any phase | `done` (removed) | User clicks ✕ | Existing dismiss path. Clear safetyTimer, frozenSnapshot for this job. |

#### F3. Removing the existing `$watch`-driven fade

The current `init()` watches `Alpine.store("jobs").items` and calls `handleJobCompleted` on transition. Keep the `$watch`, but split the handler:

- `enterHandingOff(job)` — flips phase to `handing-off`, freezes snapshot, **and pushes `job` to `Alpine.store("jobs").completedCards`** (preserves M9.4-S3's mechanism that keeps the card rendering after `state:jobs` no longer reports it as `running` — review M5).
- `enterFading(jobId)` — runs the existing fade timeline (was `handleJobCompleted` body), **but does NOT push to `completedCards`** (review NF7). The push has *moved* from the old `handleJobCompleted` body to `enterHandingOff`. Be explicit during refactor: delete the `completedCards.push(job)` line from the renamed `enterFading` body.

The `$watch` checks the `notify` field on the snapshot to choose the path. **Default handling (review NF5):** if `notify === undefined`, treat it as `"debrief"` to mirror the backend default (`automation-processor.ts:201`: `automation.manifest.notify ?? "debrief"`). This routes undefined-notify jobs through the legacy 2 s fade path, matching backend behavior.

#### F4. WS event wiring

`packages/dashboard/public/js/ws-client.js` receives two relevant server messages:

1. `{ type: "start", triggerJobId? }`:
   - If `triggerJobId` is present, dispatch `new CustomEvent("assistant-turn-start", { detail: { triggerJobId } })` on `window`.
   - If absent, do nothing extra (pass through to chat handler).
   - This explicitly addresses review **I1**: untagged `start` events (user messages, model commands, etc.) will not fire the handoff event.

2. `{ type: "handoff_pending", jobId }` (new in B7):
   - Always dispatch `new CustomEvent("handoff-pending", { detail: { jobId } })` on `window`.

`progress-card.js` listens via `window.addEventListener` in its `init()`. The handlers:

- **`assistant-turn-start`** with `detail.triggerJobId = X`:
  1. If X matches a card in `handing-off` → `enterFading(X)`.
  2. For every *other* card in `handing-off` → reset that card's `safetyTimer` to a fresh 10 s.

- **`handoff-pending`** with `detail.jobId = X`:
  1. For every card in `handing-off` (including X itself) → reset `safetyTimer` to a fresh 10 s.

This pair gives us: the moment the heartbeat begins draining a notification, all `handing-off` cards' clocks refresh — so even a slow first-token (15 s+ cold start) cannot strand a sibling card prematurely (review NF4). And when the actual `start` arrives, the matched card fades while siblings get one more refresh.

#### F5. Multi-card correctness (sibling-aware safety net)

Walking through the worst case: 3 cards complete near-simultaneously, and Nina's first alert turn has a 15 s cold-start before her first token.

- **t=0:** all three flip to `completed`. All three enter `handing-off` with 10 s safety timers (call them A, B, C with timers TA, TB, TC).
- **t≈0.3s:** heartbeat `drainNow()` runs `deliverPendingNotifications`. **Stage 1** of B7 fires `handoff_pending` for A, B, C synchronously (no awaits between them). TA, TB, TC all reset to fresh 10 s.
- **t≈0.4s:** Stage 2 broadcasts `handoff_pending` for A again (defense-in-depth) and enters `await ci.alert(...)`. TA refreshes one more time, TB/TC unchanged but already fresh from Stage 1.
- **t≈10.4s:** Cold-start still in progress. TB and TC would expire here in the absence of further activity — *unless* the cold-start completes first.
- **t=15s:** Nina's first `start` for A arrives. A → fading. F4 sibling-reset logic resets TB and TC to fresh 10 s.
- **t=15..(15+T_A_response)s:** Nina streams to A. Heartbeat for-loop is still awaiting A's `ci.alert()` to return, so no new Stage 2 broadcasts fire.
- **t=Y (A's stream done):** heartbeat exits A's iteration, enters B's. Stage 2 fires `handoff_pending` for B → TB and TC reset. Then `start` for B arrives → B → fading, TC resets again.
- **t=Z:** same for C.

**Residual risk window:** if Nina's response to a card takes >10 s to complete (cold-start or long answer), and no `start`/`handoff_pending` for the *next* card fires in time, TB/TC could expire after t≈25 s. In practice replies finish well under 10 s. **Mitigation if observed:** reset siblings' safety nets on each `text_delta` of any active stream, signalling "the system is alive even though it's still on the previous card." Out of scope for v3 unless smoke test reveals the issue.

**Failure mode:** total silence (no `start`, no `handoff_pending`, no `text_delta` for >10 s consecutive) trips safety nets and fades cards. No card is ever stranded due to the original bug.

#### F6. Visual states

| Phase | Collapsed view | Counter | Notes |
|-------|---------------|---------|-------|
| running | Current step text | `2/4` | Existing |
| handing-off (completed) | "Done" | ✓ | Full opacity, no timer animation |
| handing-off (failed) | "Failed" | ✕ | Use `text-pink-400` for the dot |
| handing-off (needs review) | "Needs review" | ⚠ | Use `text-orange-400` |
| fading | "Done" / "Failed" / "Needs review" | same | Existing 0.5 s opacity transition |

Existing color palette per dashboard design language (Tokyo Night). No new design tokens.

### Multi-card handoff

The conversation single-threaded constraint (Contributor 3 above) means alerts are serial. The handoff design accommodates this:

1. All completed cards stay visible in `handing-off`.
2. Cards fade only when their own tagged `start` arrives.
3. Sibling activity refreshes safety nets — a card waiting behind 2 others stays put as long as the system is observably progressing.
4. Total silence (10 s with no card receiving any handoff) trips the safety net and fades the head-of-queue card.

This is a more honest model than "10 s and you're gone." Cards that *are* being processed in order get to wait their turn visually. Only true delivery failures fade prematurely.

### Notification types covered

| Notification type | Fast-path drain | Card handoff |
|-------------------|-----------------|--------------|
| `job_completed` (notify=alert/full) | yes (B2) | yes (F2) — handoff_pending + tagged start |
| `job_completed` (notify=none/debrief) | n/a (skipped at handleNotification) | legacy 2 s fade (F2) — never enters handing-off |
| `job_failed` | yes (B2) | yes (F2) — handoff_pending + tagged start |
| `job_needs_review` | yes (B2) | yes (F2) — handoff_pending + tagged start |
| `job_interrupted` (heartbeat-detected stale) | n/a (already inside tick) | handoff_pending + safety net (no `start` tagged) |
| `initiate()` fallback (no current conversation) | yes (B2 fires drain regardless) | handoff_pending + safety net (review C2) |

## Instrumentation (precedes implementation)

Before any of the above ships, add timing logs to confirm the bottleneck matches this analysis. The user will run the CNN smoke test once and we will read the numbers.

Logs to add (all behind `[timing]` prefix):

| Location | Log line |
|----------|----------|
| `AutomationExecutor.run` end of for-await | `[timing] job:done id=X` (record t0 = now()) |
| `AutomationProcessor.handleNotification` entry | `[timing] handleNotification id=X +Nms` |
| Same, after `notificationQueue.enqueue` | `[timing] enqueued id=X +Nms` |
| `HeartbeatService.drainNow` entry | `[timing] drainNow start id=X +Nms` |
| `HeartbeatService.deliverPendingNotifications` for-loop top | `[timing] alert() invoked id=X +Nms` |
| `sendSystemMessage` first yield | `[timing] start emitted id=X +Nms` |
| `sendSystemMessage` first text_delta | `[timing] first delta id=X +Nms` |
| Frontend `progress-card.js` on receiving tagged `start` | `[timing] start received jobId=X +Nms (t0=Date.parse(job.completed))` (review Q1) |

Frontend t0 definition: `Date.parse(jobSnapshot.completed)` captured at the moment the card enters `handing-off`. The frontend log reports milliseconds elapsed since that t0.

If the measured timeline diverges from this analysis, revisit the design before implementation.

## Out of scope

- Reducing `resolveJobSummaryAsync` latency (separate Haiku-shaving sprint if needed).
- Reducing `queryModel` chart generation latency.
- Reducing the heartbeat tick interval — leave at 30 s for idle/retry.
- Stop endpoint race conditions flagged in M9.4-S3 post-sprint review (`stop does not actually cancel the running process`) — separate follow-up.
- Multi-conversation card handling beyond what already works in M9.4-S3.
- Bundling notifications into a single alert (future optimization, see external-review.md "Option B" discussion).

## Acceptance criteria

1. **Instrumentation lands first.** A single CNN smoke-test run produces the timing log above, recorded in the sprint's test report.
2. **Heartbeat retains its 30 s tick** as the retry / crash-recovery loop. Drain-on-event is purely additive.
3. **Drain-on-event:** for a `notify: "alert"` (or default) job that completes successfully, time from `[timing] enqueued` to `[timing] alert() invoked` (the for-loop top inside `deliverPendingNotifications`) is < **300 ms**. (Budget revised from 200 ms per review I5; covers `listPending()` disk read and `getLastWebMessageAge()` 50-turn DB query.)
4. **Card stays through handoff:** during the smoke test, the progress card visually remains on screen showing "Done" until Nina's first streamed character appears, then fades.
5. **Multi-card sibling-aware:** with two concurrent jobs completing within 2 s of each other, both cards stay in "Done" through Nina's reply to job #1, then card #1 fades on its `start`, card #2's safety net resets, card #2 stays until its own `start` arrives, then fades. Test must mock first-alert latency to >10 s so the sibling-reset logic actually fires (NF8). Verified via Playwright.
6. **Single-card legacy fade:** for a `notify: "none"` (or `notify: undefined` per NF5) job, the card runs the **legacy 2 s fade** with no handing-off phase. Verified via Playwright.
7. **Single-card safety net (alert path failure):** for a job whose alert never delivers and produces no `handoff_pending` after the initial one (simulated by stalling the heartbeat after first broadcast), the card flips to "Done", waits 10 s with no further activity, then fades. Verified via Playwright.
12. **`handoff_pending` keeps cards alive across cold-start:** for a job whose alert takes >10 s of cold-start before the first `start` token, the card stays in "Done" past the 10 s mark because of the `handoff_pending` broadcast. Test simulates by injecting a 15 s delay before `start`. Verified via Playwright.
8. **Drain mutex:** concurrent `drainNow()` and tick calls do not double-deliver any notification. Verified via unit test that fires both simultaneously against a mocked queue.
9. **No regression** in existing M9.4-S3 browser tests T1–T10, M9.4-S1 notification delivery integration tests, or `MAX_DELIVERY_ATTEMPTS` guard.
10. **Untagged `start` frames are ignored** by the handoff event. Verified via unit test on `ws-client.js`.
11. **Protocol field is optional and backwards compatible.** Existing WS clients that ignore `triggerJobId` continue to work.

## Test plan

| Test | Type | Location |
|------|------|----------|
| `triggerJobId` plumbed through `sendSystemMessage` | unit | `packages/dashboard/tests/unit/chat/send-system-message.test.ts` (extend) |
| `drainNow()` runs deliver loop, reentrancy flag prevents double-deliver | unit | `packages/dashboard/tests/unit/automations/heartbeat-service.test.ts` (extend) |
| `drainNow` emits `handoff_pending` before each `ci.alert()` (B7) | unit | same file |
| `handleNotification` calls `drainNow()` after enqueue | unit | new in `automation-processor.test.ts` |
| `state:jobs` snapshot includes `todoProgress` for non-running jobs (B4) | integration | `packages/dashboard/tests/integration/state-publishing-jobs.test.ts` (extend) |
| `state:jobs` snapshot includes `notify` field (B5) | integration | same file |
| `ws-client.js` only emits `assistant-turn-start` when `triggerJobId` present (I1) | unit | new |
| `ws-client.js` always emits `handoff-pending` on `handoff_pending` server frame | unit | same file |
| Card stays in `handing-off` until tagged `start` arrives | browser | `packages/dashboard/tests/browser/progress-card-handoff.test.ts` (new) |
| Safety-net fires at 10 s if no `start` and no `handoff_pending` (alert-failure path) | browser | same file |
| Sibling card resets safety net (NF8: must mock alert latency to delay second card's `start` past first card's initial 10 s window so reset logic actually fires) | browser | same file |
| `handoff_pending` for own jobId resets own safety net (covers NF4 cold-start case) | browser | same file |
| `notify: "none"` job runs legacy 2 s fade (no handing-off) | browser | same file |
| `notify: undefined` job treated as debrief → legacy 2 s fade (NF5) | browser | same file |
| Existing M9.4-S3 browser tests | browser | unchanged, must still pass |

## Files touched (estimate)

**Backend:**
- `packages/dashboard/src/ws/protocol.ts` — add `triggerJobId?: string` to `start`; add `notify?: string` to `JobSnapshot`; add new `{ type: "handoff_pending"; jobId: string }` server message (B7)
- `packages/dashboard/src/chat/types.ts` — extend `SystemMessageOptions`
- `packages/dashboard/src/chat/send-system-message.ts` — pass `triggerJobId` into yield; emit explicit skipped event on busy
- `packages/dashboard/src/chat/chat-service.ts` — forward option through `sendSystemMessage` wrapper (only the system-message path; user/model paths unchanged)
- `packages/dashboard/src/agent/conversation-initiator.ts` — accept `triggerJobId` in `alert()` options, forward; **do not** add to `initiate()` (descoped per C2)
- `packages/dashboard/src/automations/heartbeat-service.ts` — add `drainNow()` with reentrancy guard; pass `triggerJobId` in alert calls; **mandatory** `handoff_pending` broadcast at top of each `for`-loop iteration in `deliverPendingNotifications` (B7)
- `packages/dashboard/src/automations/automation-processor.ts` — accept `heartbeat` setter in config, call `drainNow()` after enqueue
- `packages/dashboard/src/state/state-publisher.ts` — populate `todoProgress` regardless of status (B4); include `notify` (B5)
- `packages/dashboard/src/app.ts` — wire `heartbeat` into processor via setter **before** `heartbeatService.start()`
- Plus `[timing]` log lines (delete or downgrade to debug after sprint).

**Frontend:**
- `packages/dashboard/public/js/progress-card.js` — three-phase state, frozen snapshot, sibling-aware safety net, listen for `assistant-turn-start` AND `handoff-pending` events
- `packages/dashboard/public/js/ws-client.js` — emit `assistant-turn-start` DOM event only when `start` carries `triggerJobId`; emit `handoff-pending` DOM event for every `handoff_pending` server frame
- `packages/dashboard/public/js/stores.js` — no filter changes (NF2 resolved): cards survive past `status === "running"` via `enterHandingOff` pushing into `completedCards`, the existing M9.4-S3 mechanism

**Memory note:** after any UI change, restart `nina-dashboard.service` (per CLAUDE.md memory).

## Risks / open questions

- **WS frame ordering** (review NF6): in normal flow `state:jobs(completed)` is broadcast before `start` (executor returns → state:jobs → handleNotification → drainNow → ci.alert → start yield). Out-of-order delivery is theoretically possible but extremely rare in practice (same process, single TCP-ordered WS stream). If `start` arrives first, the listener no-ops because no card is in `handing-off` yet — the card later runs the full safety-net window despite a real reply existing. Acceptable; not worth fallback machinery for an edge case that hasn't been observed.
- **Mobile/desktop dual `progressCard()` instances** (review Q2): both run independent `setTimeout` chains and may double-process the DOM event. The phase transitions are idempotent at the data layer (`enterFading` no-ops if already in `fading`), and `safetyTimers` is per-instance — minor noise but not a correctness issue. Document and move on.
- **`confirmStop()` flow** (review M4): when the user clicks Stop, the card dismisses optimistically. The new phase state map should clear its entries on dismiss. F2 covers this; verify during implementation.
- **`chat-service.ts:770`** post-tool-use continuation `start` (review M3): trivial future risk if `triggerJobId` propagation ever extends beyond system messages. Out of scope here.
- **Acceptance #3 budget validation.** 300 ms includes disk I/O and a DB query. If measurement shows it routinely exceeds, either optimize the DB query (cache last web age per conversation) or further relax the budget.
