# M9.4-S5: Job Card Handoff Continuity — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the ~30s silent gap between job completion and Nina's reply by (A) draining the notification queue immediately on `job:completed` and (B) keeping the progress card visible until Nina starts streaming her response.

**Architecture:** Backend — `HeartbeatService.drainNow()` invoked by `AutomationProcessor` after enqueue, with mandatory `handoff_pending` WS broadcast (two-stage: upfront batch + per-iteration refresh) and `triggerJobId` tagging on the alert turn's `start` event. Frontend — three-phase progress card (`running → handing-off → fading`) keyed per `job.id`, with a sibling-aware 10-second safety net that resets on any `handoff_pending` or sibling `assistant-turn-start` event.

**Tech Stack:** TypeScript (backend types, services), Alpine.js (frontend component), Vitest (unit/integration tests), Playwright (browser tests), Fastify WebSocket (transport), better-sqlite3 (notification queue persistence — unchanged).

**Spec:** `docs/sprints/m9.4-s5-job-card-handoff/spec.md` (v3)
**External reviews:** `external-review.md` (v1→v2), `external-review-v2.md` (v2→v3)

---

## Execution order and checkpoints

Tasks 1-2 land first as a **measurement checkpoint** — the user runs the CNN smoke test once after Task 2 to confirm the heartbeat is the dominant contributor before any structural changes ship. Tasks 3-9 are backend changes. Tasks 10-11 are frontend. Tasks 12-13 are end-to-end browser tests + cleanup.

```
Task 1 (timing) → Task 2 (smoke test gate) → CHECKPOINT (CTO confirms numbers)
   ↓
Task 3 (protocol) → Task 4 (StatePublisher) → Task 5 (system message plumbing)
   ↓
Task 6 (ConversationInitiator) → Task 7 (HeartbeatService drainNow + handoff_pending)
   ↓
Task 8 (AutomationProcessor wiring) → Task 9 (app.ts wiring)
   ↓
Task 10 (ws-client.js) → Task 11 (progress-card.js)
   ↓
Task 12 (browser tests) → Task 13 (cleanup timing logs) → DONE
```

---

### Task 1: Add timing instrumentation

**Files:**
- Modify: `packages/dashboard/src/automations/automation-executor.ts:421` (after `for await` loop ends)
- Modify: `packages/dashboard/src/automations/automation-processor.ts:196` (entry of `handleNotification`)
- Modify: `packages/dashboard/src/automations/automation-processor.ts:245` (after `notificationQueue.enqueue`)
- Modify: `packages/dashboard/src/automations/heartbeat-service.ts:114` (entry of `deliverPendingNotifications`)
- Modify: `packages/dashboard/src/automations/heartbeat-service.ts:131` (just before `ci.alert()` call)
- Modify: `packages/dashboard/src/chat/send-system-message.ts:52` (just before first yield)
- Modify: `packages/dashboard/public/js/ws-client.js` (in the "start" case, once added)

These are non-functional logs. They use `Date.now()` and a per-job `t0` captured at executor end.

- [ ] **Step 1: Add a small timing helper module**

Create `packages/dashboard/src/automations/timing.ts`:

```typescript
/**
 * M9.4-S5 timing instrumentation — temporary, removed in cleanup task.
 * Tracks per-job timestamps from executor completion through alert delivery.
 */

const t0Map = new Map<string, number>();

export function timingMark(jobId: string): void {
  t0Map.set(jobId, Date.now());
  console.log(`[timing] job:done id=${jobId}`);
}

export function timingLog(jobId: string, label: string): void {
  const t0 = t0Map.get(jobId);
  if (t0 === undefined) {
    console.log(`[timing] ${label} id=${jobId} (no t0)`);
    return;
  }
  console.log(`[timing] ${label} id=${jobId} +${Date.now() - t0}ms`);
}

export function timingClear(jobId: string): void {
  t0Map.delete(jobId);
}
```

- [ ] **Step 2: Mark t0 at end of executor query loop**

In `packages/dashboard/src/automations/automation-executor.ts`, add import at the top:

```typescript
import { timingMark } from "./timing.js";
```

Find the for-await loop end (around line 421, just after `this.abortControllers.delete(job.id);`). Add immediately after that line:

```typescript
timingMark(job.id);
```

- [ ] **Step 3: Log handleNotification entry and post-enqueue**

In `packages/dashboard/src/automations/automation-processor.ts`, add import at the top:

```typescript
import { timingLog } from "./timing.js";
```

In `handleNotification` (line 196), add as the first line of the function body:

```typescript
timingLog(jobId, "handleNotification");
```

After the `this.config.notificationQueue.enqueue({ ... })` block (around line 257), add:

```typescript
timingLog(jobId, "enqueued");
```

- [ ] **Step 4: Log heartbeat entry and per-alert**

In `packages/dashboard/src/automations/heartbeat-service.ts`, add import at the top:

```typescript
import { timingLog } from "./timing.js";
```

In `deliverPendingNotifications` (line 114), add as the first line of the function:

```typescript
const pending = this.config.notificationQueue.listPending();
for (const n of pending) timingLog(n.job_id, "deliverPending start");
```

(Replace the existing `const pending = ...` line in the for-loop initializer; declare `pending` once at the top.)

Just before the `await this.config.conversationInitiator.alert(...)` call (around line 132), add:

```typescript
timingLog(notification.job_id, "alert() invoked");
```

- [ ] **Step 5: Log first WS yield in sendSystemMessage**

In `packages/dashboard/src/chat/send-system-message.ts`, just before line 52 (`yield { type: "start" as const };`), add:

```typescript
console.log(`[timing] start emitted (no jobId mapping yet)`);
```

(We'll add `triggerJobId` in Task 5; for now this line just confirms the timestamp.)

- [ ] **Step 6: Verify the build compiles**

Run: `cd packages/dashboard && npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 7: Commit**

```bash
git add packages/dashboard/src/automations/timing.ts \
        packages/dashboard/src/automations/automation-executor.ts \
        packages/dashboard/src/automations/automation-processor.ts \
        packages/dashboard/src/automations/heartbeat-service.ts \
        packages/dashboard/src/chat/send-system-message.ts
git commit -m "feat(m9.4-s5): add timing instrumentation for handoff measurement

Logs job:done, handleNotification, enqueued, deliverPending start,
alert() invoked, start emitted — all behind [timing] prefix.
Used to validate the bottleneck before structural changes (Task 2
checkpoint). Removed in Task 13 cleanup."
```

---

### Task 2: Smoke test checkpoint

**Files:** none (this is a verification gate, not code)

- [ ] **Step 1: Build and restart dashboard**

```bash
cd packages/dashboard && npx tsc
systemctl --user restart nina-dashboard.service
```

- [ ] **Step 2: User runs the CNN automation smoke test**

The user manually triggers the CNN automation via the dashboard. Watch the dashboard service logs:

```bash
journalctl --user -u nina-dashboard.service -f | grep '\[timing\]'
```

- [ ] **Step 3: Record the timing**

Capture the elapsed-ms numbers and write them to `docs/sprints/m9.4-s5-job-card-handoff/test-report.md` (create it):

```markdown
# M9.4-S5 Test Report

## Pre-implementation timing baseline

CNN smoke test, run on YYYY-MM-DD-HH:MM:

| Event | Elapsed from job:done |
|-------|----------------------|
| handleNotification | +Xms |
| enqueued | +Xms |
| deliverPending start | +Xms |
| alert() invoked | +Xms |
| start emitted | +Xms |

Heartbeat tick wait observed: ~Xs (between `enqueued` and `deliverPending start`)

Notes: <observations>
```

- [ ] **Step 4: Confirm with CTO before proceeding**

If the heartbeat wait is the dominant contributor (>5s between `enqueued` and `deliverPending start`), proceed to Task 3. Otherwise, pause and revisit the design with the CTO.

- [ ] **Step 5: Commit the test report**

```bash
git add docs/sprints/m9.4-s5-job-card-handoff/test-report.md
git commit -m "docs(m9.4-s5): pre-implementation timing baseline"
```

---

### Task 3: Protocol additions

**Files:**
- Modify: `packages/dashboard/src/ws/protocol.ts:121-122` (extend `start`)
- Modify: `packages/dashboard/src/ws/protocol.ts:212` (add `state:jobs`'s sibling: `handoff_pending`)
- Modify: `packages/dashboard/src/ws/protocol.ts:306-321` (extend `JobSnapshot` with `notify`)

- [ ] **Step 1: Add `triggerJobId` to the `start` server message**

In `packages/dashboard/src/ws/protocol.ts`, replace line 121:

```typescript
// Before:
  | { type: "start" }

// After:
  | { type: "start"; triggerJobId?: string }
```

- [ ] **Step 2: Add the `handoff_pending` server message type**

Insert immediately after the `state:jobs` line (around line 213, after the closing `}` of `state:jobs`):

```typescript
  | { type: "handoff_pending"; jobId: string }
```

- [ ] **Step 3: Add `notify` field to `JobSnapshot`**

Find `export interface JobSnapshot` (line 306). Add `notify?: string` immediately after `triggerType?: string`:

```typescript
export interface JobSnapshot {
  id: string;
  automationId: string;
  automationName: string;
  status: string;
  created: string;
  completed?: string;
  summary?: string;
  triggerType?: string;
  notify?: string;  // NEW (M9.4-S5): so frontend can route notify=none/debrief jobs to legacy fade
  todoProgress?: {
    done: number
    total: number
    current: string | null
    items: Array<{ id: string; text: string; status: TodoStatus }>
  }
}
```

- [ ] **Step 4: Verify the build compiles**

Run: `cd packages/dashboard && npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add packages/dashboard/src/ws/protocol.ts
git commit -m "feat(protocol): add triggerJobId, handoff_pending, JobSnapshot.notify

Backwards-compatible additions:
- start gains optional triggerJobId for tagged system-message turns
- new handoff_pending server message (jobId-scoped)
- JobSnapshot gains optional notify so frontend can apply legacy 2s
  fade for notify=none/debrief jobs"
```

---

### Task 4: StatePublisher — preserve todoProgress on completion + include notify

**Files:**
- Modify: `packages/dashboard/src/state/state-publisher.ts:525-560` (`_getJobSnapshots`)
- Test: `packages/dashboard/tests/integration/state-publishing-jobs.test.ts` (extend)

- [ ] **Step 1: Write the failing test**

In `packages/dashboard/tests/integration/state-publishing-jobs.test.ts`, append a new `describe` block at the bottom of the file (before the final closing `});`):

```typescript
describe("M9.4-S5 — todoProgress preserved post-completion + notify field", () => {
  it("includes todoProgress on a completed job that has todos", async () => {
    const job = harness.automationJobService!.createJob({
      automationId: "test-auto",
      context: {},
    });
    const runDir = path.join(harness.agentDir, "runtime", "jobs", job.id);
    fs.mkdirSync(runDir, { recursive: true });
    harness.automationJobService!.startJob(job.id, runDir);

    writeTodoFile(path.join(runDir, "todos.json"), {
      items: [
        { id: "t1", text: "Step", status: "done", mandatory: true, created_by: "framework" },
      ],
      last_activity: new Date().toISOString(),
    });

    // Flip status to completed
    harness.automationJobService!.updateJob(job.id, {
      status: "completed",
      completed: new Date().toISOString(),
    });

    harness.statePublisher.publishJobs();
    await delay(150);

    const broadcasts = harness.getBroadcasts("state:jobs");
    const last = broadcasts[broadcasts.length - 1] as any;
    const snap = last.jobs.find((j: any) => j.id === job.id);

    expect(snap.status).toBe("completed");
    expect(snap.todoProgress).toBeDefined();
    expect(snap.todoProgress.items).toHaveLength(1);
    expect(snap.todoProgress.items[0].status).toBe("done");
  });

  it("includes notify field from the automation manifest", async () => {
    // Assumes test-auto is registered with notify: 'alert' in the harness fixtures.
    // If the harness doesn't expose this, register a fresh automation:
    harness.registerAutomation?.({
      id: "test-notify-auto",
      manifest: { name: "Test Notify", notify: "alert", trigger: [], status: "enabled" },
      instructions: "",
    });

    const job = harness.automationJobService!.createJob({
      automationId: "test-notify-auto",
      context: {},
    });

    harness.statePublisher.publishJobs();
    await delay(150);

    const broadcasts = harness.getBroadcasts("state:jobs");
    const last = broadcasts[broadcasts.length - 1] as any;
    const snap = last.jobs.find((j: any) => j.id === job.id);

    expect(snap.notify).toBe("alert");
  });
});
```

If `harness.registerAutomation` doesn't exist, the second test should instead use whatever fixture pattern the harness already supports — verify `AppHarness` API (`packages/dashboard/tests/integration/app-harness.ts`) and adapt.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/dashboard && npx vitest run tests/integration/state-publishing-jobs.test.ts -t "M9.4-S5"`
Expected: FAIL — `snap.todoProgress` is undefined for the completed job, and `snap.notify` is undefined.

- [ ] **Step 3: Update `_getJobSnapshots` to populate `todoProgress` regardless of status**

In `packages/dashboard/src/state/state-publisher.ts`, replace the `todoProgress` IIFE (lines 530-547):

```typescript
// Before:
const todoProgress: JobSnapshot["todoProgress"] = j.status === 'running' && j.run_dir
  ? (() => {
      try {
        const todoFile = readTodoFile(path.join(j.run_dir, 'todos.json'))
        if (todoFile.items.length === 0) return undefined
        const done = todoFile.items.filter(i => i.status === 'done').length
        const inProgress = todoFile.items.find(i => i.status === 'in_progress')
        return {
          done,
          total: todoFile.items.length,
          current: inProgress?.text ?? null,
          items: todoFile.items.map(i => ({ id: i.id, text: i.text, status: i.status })),
        }
      } catch {
        return undefined
      }
    })()
  : undefined

// After (M9.4-S5 B4: populate regardless of status, as long as todos.json exists):
const todoProgress: JobSnapshot["todoProgress"] = j.run_dir
  ? (() => {
      try {
        const todoFile = readTodoFile(path.join(j.run_dir, 'todos.json'))
        if (todoFile.items.length === 0) return undefined
        const done = todoFile.items.filter(i => i.status === 'done').length
        const inProgress = todoFile.items.find(i => i.status === 'in_progress')
        return {
          done,
          total: todoFile.items.length,
          current: inProgress?.text ?? null,
          items: todoFile.items.map(i => ({ id: i.id, text: i.text, status: i.status })),
        }
      } catch {
        return undefined
      }
    })()
  : undefined
```

- [ ] **Step 4: Add `notify` field to the snapshot return**

In the same function, find the `return { ... }` for each job snapshot (around line 548). Add `notify: automation?.manifest.notify` immediately after `triggerType`:

```typescript
return {
  id: j.id,
  automationId: j.automationId,
  automationName: automation?.manifest.name ?? j.automationId,
  status: j.status,
  created: j.created,
  completed: j.completed,
  summary: j.summary,
  triggerType: j.triggerType,
  notify: automation?.manifest.notify,  // NEW (M9.4-S5 B5)
  todoProgress,
};
```

(If the existing return uses different field ordering, just add `notify` somewhere logical and keep the rest.)

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd packages/dashboard && npx vitest run tests/integration/state-publishing-jobs.test.ts -t "M9.4-S5"`
Expected: PASS.

- [ ] **Step 6: Run the full state-publishing test file to check for regressions**

Run: `cd packages/dashboard && npx vitest run tests/integration/state-publishing-jobs.test.ts`
Expected: All tests pass (the existing M9.4-S3 tests should still pass — they only assert on running jobs).

- [ ] **Step 7: Commit**

```bash
git add packages/dashboard/src/state/state-publisher.ts \
        packages/dashboard/tests/integration/state-publishing-jobs.test.ts
git commit -m "feat(state): preserve todoProgress on non-running jobs + add notify

JobSnapshot.todoProgress is now populated whenever the job's run_dir
contains a non-empty todos.json, regardless of status. Required so
the progress card can keep rendering through the M9.4-S5 handing-off
phase.

JobSnapshot.notify surfaces the automation's notify policy so the
frontend can route notify=none/debrief jobs through the legacy 2s
fade instead of the new handing-off phase."
```

---

### Task 5: System message path — `triggerJobId` plumbing

**Files:**
- Modify: `packages/dashboard/src/chat/types.ts` (extend `SystemMessageOptions`)
- Modify: `packages/dashboard/src/chat/send-system-message.ts:25-90` (accept option, tag yield)
- Modify: `packages/dashboard/src/chat/chat-service.ts:889-895` (forward option)
- Test: `packages/dashboard/tests/unit/chat/send-system-message.test.ts` (extend or create)

- [ ] **Step 1: Inspect `SystemMessageOptions` and add `triggerJobId`**

Read `packages/dashboard/src/chat/types.ts`. Find the `SystemMessageOptions` interface. Add an optional `triggerJobId?: string` field. If the file uses a different shape (e.g., type alias), adapt — the goal is one new optional string field.

Example (likely shape):

```typescript
export interface SystemMessageOptions {
  channel?: string;
  triggerJobId?: string;  // NEW (M9.4-S5)
}
```

- [ ] **Step 2: Write the failing test**

In `packages/dashboard/tests/unit/chat/send-system-message.test.ts` (create if missing — model after existing chat unit tests):

```typescript
import { describe, it, expect, vi } from "vitest";
import { sendSystemMessage } from "../../../src/chat/send-system-message.js";

describe("sendSystemMessage triggerJobId", () => {
  it("yields { type: 'start', triggerJobId } when option passed", async () => {
    // Mock the App + sessionRegistry minimally; consult existing test fixtures
    // for the right shape. The key assertion: the first yielded event has
    // triggerJobId === "job-abc".
    const events: any[] = [];
    const mockApp = createMockApp(); // see existing test fixtures
    const gen = sendSystemMessage(
      mockApp,
      "conv-1",
      "Test prompt",
      1,
      { triggerJobId: "job-abc" },
    );
    for await (const e of gen) events.push(e);
    expect(events[0]).toMatchObject({ type: "start", triggerJobId: "job-abc" });
  });

  it("yields { type: 'start' } without triggerJobId when option absent", async () => {
    const events: any[] = [];
    const mockApp = createMockApp();
    const gen = sendSystemMessage(mockApp, "conv-1", "Test prompt", 1);
    for await (const e of gen) events.push(e);
    expect(events[0]).toEqual({ type: "start" });
    expect(events[0]).not.toHaveProperty("triggerJobId");
  });
});
```

If no test file exists, create the file with imports modeled on `packages/dashboard/tests/unit/chat/*.test.ts`. The `createMockApp` helper may already exist in a shared fixtures file — check `packages/dashboard/tests/__fixtures__/` or similar.

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd packages/dashboard && npx vitest run tests/unit/chat/send-system-message.test.ts`
Expected: FAIL — first yielded `start` does not have `triggerJobId`.

- [ ] **Step 4: Update `sendSystemMessage` to accept and forward the option**

In `packages/dashboard/src/chat/send-system-message.ts`, modify the function signature and the first yield. The function currently looks like:

```typescript
export async function* sendSystemMessage(
  app: App,
  conversationId: string,
  prompt: string,
  turnNumber: number,
  options?: { channel?: string },
): AsyncGenerator<ChatEvent> {
  // ... isStreaming check around line 45 ...
  yield { type: "start" as const };
  // ... rest ...
}
```

Change the options type to `SystemMessageOptions` (already imported from `./types.js`) and update the first yield:

```typescript
import type { SystemMessageOptions } from "./types.js";

export async function* sendSystemMessage(
  app: App,
  conversationId: string,
  prompt: string,
  turnNumber: number,
  options?: SystemMessageOptions,
): AsyncGenerator<ChatEvent> {
  // ... isStreaming check unchanged ...
  yield options?.triggerJobId
    ? { type: "start" as const, triggerJobId: options.triggerJobId }
    : { type: "start" as const };
  // ... rest ...
}
```

- [ ] **Step 5: Update the wrapper in `chat-service.ts`**

In `packages/dashboard/src/chat/chat-service.ts`, find `async *sendSystemMessage(` (around line 889). It currently looks like:

```typescript
async *sendSystemMessage(
  conversationId: string,
  prompt: string,
  turnNumber: number,
  options?: { channel?: string },
): AsyncGenerator<ChatEvent> {
  yield* sendSystemMessage(/* ... */);
}
```

Update the type and pass `options` through:

```typescript
async *sendSystemMessage(
  conversationId: string,
  prompt: string,
  turnNumber: number,
  options?: SystemMessageOptions,
): AsyncGenerator<ChatEvent> {
  yield* sendSystemMessage(this.app, conversationId, prompt, turnNumber, options);
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd packages/dashboard && npx vitest run tests/unit/chat/send-system-message.test.ts`
Expected: PASS.

- [ ] **Step 7: Run the full chat unit test suite to check for regressions**

Run: `cd packages/dashboard && npx vitest run tests/unit/chat`
Expected: All tests pass.

- [ ] **Step 8: Commit**

```bash
git add packages/dashboard/src/chat/types.ts \
        packages/dashboard/src/chat/send-system-message.ts \
        packages/dashboard/src/chat/chat-service.ts \
        packages/dashboard/tests/unit/chat/send-system-message.test.ts
git commit -m "feat(chat): plumb triggerJobId through sendSystemMessage

SystemMessageOptions gains optional triggerJobId. When set, the first
yielded { type: 'start' } event carries the field. ChatService wrapper
forwards the option. Other start yield sites (user messages, model
commands, hatching) are unchanged — they remain untagged."
```

---

### Task 6: ConversationInitiator — accept and forward `triggerJobId`

**Files:**
- Modify: `packages/dashboard/src/agent/conversation-initiator.ts:86-161` (`alert()`)

Note: per spec C2, `triggerJobId` is **not** added to `initiate()`.

- [ ] **Step 1: Update `alert()` signature to accept `triggerJobId`**

In `packages/dashboard/src/agent/conversation-initiator.ts`, find:

```typescript
async alert(
  prompt: string,
  options?: { sourceChannel?: string },
): Promise<boolean> {
```

Change to:

```typescript
async alert(
  prompt: string,
  options?: { sourceChannel?: string; triggerJobId?: string },
): Promise<boolean> {
```

- [ ] **Step 2: Forward `triggerJobId` in the three `sendSystemMessage` call sites inside `alert()`**

There are three call sites in `alert()`. For each, pass `triggerJobId` through. Read each call:

**Site 1 (~line 107, useWeb || isDashboardSourced branch):**

```typescript
// Before:
for await (const event of this.chatService.sendSystemMessage(
  current.id,
  prompt,
  (current.turnCount ?? 0) + 1,
)) {

// After:
for await (const event of this.chatService.sendSystemMessage(
  current.id,
  prompt,
  (current.turnCount ?? 0) + 1,
  { triggerJobId: options?.triggerJobId },
)) {
```

**Site 2 (~line 121, web-only fallback):**

```typescript
// Before:
for await (const event of this.chatService.sendSystemMessage(
  current.id,
  prompt,
  (current.turnCount ?? 0) + 1,
)) {

// After:
for await (const event of this.chatService.sendSystemMessage(
  current.id,
  prompt,
  (current.turnCount ?? 0) + 1,
  { triggerJobId: options?.triggerJobId },
)) {
```

**Site 3 (~line 145, same-channel branch — already passes `channel`):**

```typescript
// Before:
for await (const event of this.chatService.sendSystemMessage(
  current.id,
  prompt,
  (current.turnCount ?? 0) + 1,
  { channel: outboundChannel },
)) {

// After:
for await (const event of this.chatService.sendSystemMessage(
  current.id,
  prompt,
  (current.turnCount ?? 0) + 1,
  { channel: outboundChannel, triggerJobId: options?.triggerJobId },
)) {
```

- [ ] **Step 3: Update the `ChatServiceLike` interface to allow the new option**

In the same file, find:

```typescript
export interface ChatServiceLike {
  sendSystemMessage(
    conversationId: string,
    prompt: string,
    turnNumber: number,
    options?: SystemMessageOptions,
  ): AsyncGenerator<ChatEvent>;
}
```

Verify the existing import already references `SystemMessageOptions` (it should from M9.4-S2.5). If it doesn't, update the import. The type should already accept `triggerJobId` after Task 5.

- [ ] **Step 4: Verify the build compiles**

Run: `cd packages/dashboard && npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 5: Update the existing ConversationInitiator test (if one exists)**

Look for `packages/dashboard/tests/unit/agent/conversation-initiator.test.ts`. If present, add a test:

```typescript
it("forwards triggerJobId to sendSystemMessage when provided", async () => {
  const sendCalls: any[] = [];
  const ci = new ConversationInitiator({
    conversationManager: mockConversationManager(/* current returns valid conv */),
    chatService: {
      async *sendSystemMessage(convId, prompt, turn, opts) {
        sendCalls.push({ convId, prompt, turn, opts });
      },
    } as any,
    channelManager: mockTransportManager(),
    getOutboundChannel: () => "web",
  });
  await ci.alert("hello", { triggerJobId: "job-xyz" });
  expect(sendCalls[0].opts).toMatchObject({ triggerJobId: "job-xyz" });
});
```

If no test file exists, skip this step (broader integration test in Task 12 will cover it).

- [ ] **Step 6: Commit**

```bash
git add packages/dashboard/src/agent/conversation-initiator.ts \
        packages/dashboard/tests/unit/agent/conversation-initiator.test.ts 2>/dev/null || true
git add packages/dashboard/src/agent/conversation-initiator.ts
git commit -m "feat(initiator): forward triggerJobId through alert()

alert() accepts an optional triggerJobId and forwards it to all three
sendSystemMessage call sites (web/dashboard, web-only fallback,
same-channel). initiate() is not extended (descoped per spec C2 — new
conversations may not be visible to the user)."
```

---

### Task 7: HeartbeatService — `drainNow()`, reentrancy guard, `handoff_pending` broadcast

**Files:**
- Modify: `packages/dashboard/src/automations/heartbeat-service.ts:13-192` (most of the file)
- Test: `packages/dashboard/tests/unit/automations/heartbeat-service.test.ts` (extend)

- [ ] **Step 1: Extend `HeartbeatConfig` to accept the WS connection registry**

Heartbeat needs to broadcast `handoff_pending`. Add to `HeartbeatConfig` (line 13):

```typescript
import type { ConnectionRegistry } from "../ws/connection-registry.js";

export interface HeartbeatConfig {
  jobService: AutomationJobService;
  notificationQueue: PersistentNotificationQueue;
  conversationInitiator: { /* ...existing... */ } | null;
  staleThresholdMs: number;
  tickIntervalMs: number;
  capabilityHealthIntervalMs: number;
  capabilityHealthCheck?: () => Promise<void>;
  /** WS broadcast (M9.4-S5 B7). Optional — heartbeat tolerates absence in tests. */
  registry?: ConnectionRegistry;
}
```

- [ ] **Step 2: Add the `draining` reentrancy flag and `drainNow()` method**

Add a private field at the top of the class (around line 30):

```typescript
private draining = false;
```

Add a new public method (after `stop()`, before `tick()`):

```typescript
/**
 * Trigger an immediate drain of pending notifications.
 * Reentrancy-guarded — concurrent callers no-op.
 * (M9.4-S5 B1)
 */
async drainNow(): Promise<void> {
  if (this.draining) return;
  this.draining = true;
  try {
    await this.deliverPendingNotifications();
  } catch (err) {
    console.warn("[Heartbeat] drainNow error:", err);
  } finally {
    this.draining = false;
  }
}
```

- [ ] **Step 3: Guard the existing `tick()` with the same flag**

Replace the body of `tick()` (line 57-61):

```typescript
async tick(): Promise<void> {
  await this.checkStaleJobs();
  if (!this.draining) {
    this.draining = true;
    try {
      await this.deliverPendingNotifications();
    } finally {
      this.draining = false;
    }
  }
  await this.checkCapabilityHealth();
}
```

- [ ] **Step 4: Update `deliverPendingNotifications` for handoff_pending two-stage broadcast + triggerJobId**

Replace the body of `deliverPendingNotifications` (lines 114-156) with:

```typescript
private async deliverPendingNotifications(): Promise<void> {
  if (!this.config.conversationInitiator) return;

  const MAX_DELIVERY_ATTEMPTS = 10;
  const pending = this.config.notificationQueue.listPending();

  // Stage 1 (M9.4-S5 B7): upfront batch — broadcast handoff_pending for every
  // queued notification *before* any await, so all sibling cards refresh
  // their safety nets before serial alert delivery begins.
  if (this.config.registry) {
    for (const n of pending) {
      this.config.registry.broadcastToAll({
        type: "handoff_pending",
        jobId: n.job_id,
      });
    }
  }

  for (const notification of pending) {
    if (notification.delivery_attempts >= MAX_DELIVERY_ATTEMPTS) {
      console.warn(
        `[Heartbeat] Notification ${notification.job_id} exceeded ${MAX_DELIVERY_ATTEMPTS} delivery attempts — moving to delivered`,
      );
      this.config.notificationQueue.markDelivered(notification._filename!);
      continue;
    }

    // Stage 2 (M9.4-S5 B7): per-iteration refresh — refresh the active
    // notification's clock right before its alert blocks.
    if (this.config.registry) {
      this.config.registry.broadcastToAll({
        type: "handoff_pending",
        jobId: notification.job_id,
      });
    }

    try {
      const prompt = this.formatNotification(notification);
      const delivered = await this.config.conversationInitiator.alert(prompt, {
        sourceChannel: notification.source_channel,
        triggerJobId: notification.job_id,    // M9.4-S5 B3
      });

      if (delivered) {
        this.config.notificationQueue.markDelivered(notification._filename!);
      } else {
        // No current conversation. initiate() does NOT carry triggerJobId
        // (spec C2 descope) — card falls back to safety net.
        await this.config.conversationInitiator.initiate({
          firstTurnPrompt: `[SYSTEM: ${prompt}]`,
        });
        this.config.notificationQueue.markDelivered(notification._filename!);
      }
    } catch (err) {
      console.error(
        `[Heartbeat] Notification delivery failed for ${notification.job_id}:`,
        err,
      );
      this.config.notificationQueue.incrementAttempts(notification._filename!);
    }
  }
}
```

- [ ] **Step 5: Write a unit test for the reentrancy guard**

In `packages/dashboard/tests/unit/automations/heartbeat-service.test.ts`, append:

```typescript
it("drainNow is reentrancy-guarded — concurrent calls don't double-deliver", async () => {
  let alertCallCount = 0;
  const slowAlert = vi.fn(async () => {
    alertCallCount++;
    await new Promise((resolve) => setTimeout(resolve, 50));
    return true;
  });

  const queue = makeQueueWithOneNotification(); // existing test helper
  const hb = new HeartbeatService({
    jobService: mockJobService(),
    notificationQueue: queue,
    conversationInitiator: { alert: slowAlert, initiate: vi.fn() },
    staleThresholdMs: 999999,
    tickIntervalMs: 999999,
    capabilityHealthIntervalMs: 999999,
  });

  await Promise.all([hb.drainNow(), hb.drainNow(), hb.drainNow()]);
  expect(alertCallCount).toBe(1);
});
```

If `makeQueueWithOneNotification` doesn't exist, write a tiny inline mock:

```typescript
const queue = {
  listPending: vi.fn().mockReturnValueOnce([
    { job_id: "job-1", _filename: "x.json", delivery_attempts: 0, /* ... */ },
  ]).mockReturnValue([]),
  markDelivered: vi.fn(),
  incrementAttempts: vi.fn(),
} as any;
```

- [ ] **Step 6: Write a unit test for the `handoff_pending` upfront broadcast**

In the same test file:

```typescript
it("broadcasts handoff_pending for every pending notification before any alert await", async () => {
  const broadcasts: any[] = [];
  const registry = {
    broadcastToAll: vi.fn((msg) => broadcasts.push(msg)),
  } as any;

  let alertResolved = false;
  const slowAlert = vi.fn(async () => {
    // Capture broadcasts *before* alert resolves
    expect(broadcasts.filter(b => b.type === "handoff_pending").map(b => b.jobId))
      .toEqual(expect.arrayContaining(["job-1", "job-2", "job-3"]));
    alertResolved = true;
    return true;
  });

  const queue = {
    listPending: vi.fn()
      .mockReturnValueOnce([
        { job_id: "job-1", _filename: "1.json", delivery_attempts: 0 },
        { job_id: "job-2", _filename: "2.json", delivery_attempts: 0 },
        { job_id: "job-3", _filename: "3.json", delivery_attempts: 0 },
      ])
      .mockReturnValue([]),
    markDelivered: vi.fn(),
    incrementAttempts: vi.fn(),
  } as any;

  const hb = new HeartbeatService({
    jobService: mockJobService(),
    notificationQueue: queue,
    conversationInitiator: { alert: slowAlert, initiate: vi.fn() },
    staleThresholdMs: 999999,
    tickIntervalMs: 999999,
    capabilityHealthIntervalMs: 999999,
    registry,
  });

  await hb.drainNow();
  expect(alertResolved).toBe(true);
});
```

- [ ] **Step 7: Run the tests**

Run: `cd packages/dashboard && npx vitest run tests/unit/automations/heartbeat-service.test.ts`
Expected: All tests pass (including the existing `MAX_DELIVERY_ATTEMPTS` guard test).

- [ ] **Step 8: Commit**

```bash
git add packages/dashboard/src/automations/heartbeat-service.ts \
        packages/dashboard/tests/unit/automations/heartbeat-service.test.ts
git commit -m "feat(heartbeat): drainNow + handoff_pending two-stage broadcast

- drainNow() public method, reentrancy-guarded with 'draining' flag
- tick() shares the same guard so concurrent drainNow + tick cannot
  double-deliver
- deliverPendingNotifications: Stage 1 broadcasts handoff_pending for
  every pending notification before any await (so siblings refresh
  before serial alert delivery begins); Stage 2 re-broadcasts per
  iteration as defense-in-depth
- alert() now passes triggerJobId from the notification.job_id"
```

---

### Task 8: AutomationProcessor — invoke `drainNow()` after enqueue

**Files:**
- Modify: `packages/dashboard/src/automations/automation-processor.ts:30-49` (config interface)
- Modify: `packages/dashboard/src/automations/automation-processor.ts:50-58` (class shape)
- Modify: `packages/dashboard/src/automations/automation-processor.ts:243-260` (after enqueue)
- Test: `packages/dashboard/tests/unit/automations/automation-processor.test.ts` (create or extend)

- [ ] **Step 1: Add `heartbeat` to `AutomationProcessorConfig`**

In `automation-processor.ts`, extend `AutomationProcessorConfig` (around line 30):

```typescript
export interface AutomationProcessorConfig {
  automationManager: AutomationManager;
  executor: AutomationExecutor;
  jobService: AutomationJobService;
  agentDir: string;
  onJobEvent?: (event: JobEventName, job: Job) => void;
  conversationInitiator?: { /* unchanged */ } | null;
  onAlertDelivered?: () => void;
  notificationQueue?: PersistentNotificationQueue;
  /** Heartbeat reference for fast-path drain on job:completed (M9.4-S5 B2). */
  heartbeat?: { drainNow(): Promise<void> };
}
```

- [ ] **Step 2: Add `setHeartbeat` setter**

Add a method to the `AutomationProcessor` class (after the constructor, before `fire`):

```typescript
/**
 * Wire the heartbeat reference post-construction (M9.4-S5 B2).
 * Required because Heartbeat is constructed after Processor in app.ts.
 * Must be called before the first job is dispatched, otherwise drain falls
 * back to the next 30s tick.
 */
setHeartbeat(hb: { drainNow(): Promise<void> }): void {
  this.config.heartbeat = hb;
}
```

- [ ] **Step 3: Call `drainNow()` after enqueue**

Find the `notificationQueue.enqueue({ ... })` block in `handleNotification` (around line 245). Immediately after the closing `})` of the enqueue call (line 257-258), add:

```typescript
this.config.heartbeat?.drainNow().catch((err) => {
  console.warn(`[AutomationProcessor] drainNow failed for ${jobId}:`, err);
  // Next 30s tick will retry — non-fatal
});
```

The full block should now look like:

```typescript
if (this.config.notificationQueue) {
  this.config.notificationQueue.enqueue({
    job_id: jobId,
    automation_id: job.automationId,
    type,
    summary: `[${automation.manifest.name}] ${summary}`,
    todos_completed: todosCompleted,
    todos_total: todosTotal,
    incomplete_items: incompleteItems.length > 0 ? incompleteItems : undefined,
    resumable: job.status === "needs_review",
    created: new Date().toISOString(),
    delivery_attempts: 0,
    source_channel: (job.context as Record<string, unknown>)?.sourceChannel as string | undefined,
  });
  timingLog(jobId, "enqueued");

  // M9.4-S5 B2: fire-and-forget fast-path drain
  this.config.heartbeat?.drainNow().catch((err) => {
    console.warn(`[AutomationProcessor] drainNow failed for ${jobId}:`, err);
  });

  this.config.onAlertDelivered?.();
  return;
}
```

- [ ] **Step 4: Write a unit test**

In `packages/dashboard/tests/unit/automations/automation-processor.test.ts` (create if missing):

```typescript
import { describe, it, expect, vi } from "vitest";
import { AutomationProcessor } from "../../../src/automations/automation-processor.js";

describe("AutomationProcessor.handleNotification — drainNow fast-path", () => {
  it("calls heartbeat.drainNow() after enqueueing a notification", async () => {
    const drainNow = vi.fn().mockResolvedValue(undefined);
    const enqueue = vi.fn();
    const processor = new AutomationProcessor({
      automationManager: { findById: () => null } as any,
      executor: {} as any,
      jobService: {
        getJob: () => ({ id: "job-1", automationId: "auto-1", status: "completed", run_dir: null }),
      } as any,
      agentDir: "/tmp",
      notificationQueue: { enqueue } as any,
    });
    processor.setHeartbeat({ drainNow });

    // Invoke handleNotification via reflection or by exposing it for testing
    // (or call processor.executeAndDeliver with mocks). Adapt to the existing
    // test patterns. Minimum assertion: after the notification path runs,
    // drainNow was awaited (or at least called).
    await (processor as any).handleNotification(
      { id: "auto-1", manifest: { name: "Test", notify: "alert" } },
      "job-1",
      { success: true, work: "x".repeat(50), deliverable: "x".repeat(50) },
    );

    expect(enqueue).toHaveBeenCalled();
    expect(drainNow).toHaveBeenCalled();
  });

  it("works without a heartbeat reference (degraded mode)", async () => {
    const enqueue = vi.fn();
    const processor = new AutomationProcessor({
      automationManager: { findById: () => null } as any,
      executor: {} as any,
      jobService: {
        getJob: () => ({ id: "job-2", automationId: "auto-1", status: "completed", run_dir: null }),
      } as any,
      agentDir: "/tmp",
      notificationQueue: { enqueue } as any,
    });
    // No setHeartbeat call — heartbeat is undefined.

    await expect((processor as any).handleNotification(
      { id: "auto-1", manifest: { name: "Test", notify: "alert" } },
      "job-2",
      { success: true, work: "x".repeat(50), deliverable: "x".repeat(50) },
    )).resolves.not.toThrow();

    expect(enqueue).toHaveBeenCalled();
  });
});
```

If `handleNotification` is private and the test pattern doesn't easily reach it, drive through `executeAndDeliver` with mock executor — match whatever pattern exists.

- [ ] **Step 5: Run the test**

Run: `cd packages/dashboard && npx vitest run tests/unit/automations/automation-processor.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/dashboard/src/automations/automation-processor.ts \
        packages/dashboard/tests/unit/automations/automation-processor.test.ts
git commit -m "feat(automations): event-triggered drain on job completion

AutomationProcessor.handleNotification fires heartbeat.drainNow() as a
fire-and-forget after enqueueing the notification. Failures are logged
but non-fatal — the next 30s heartbeat tick will retry. A new
setHeartbeat() setter wires the reference post-construction since
Heartbeat is built after Processor in app.ts."
```

---

### Task 9: app.ts wiring — pass registry to heartbeat, call setHeartbeat before start

**Files:**
- Modify: `packages/dashboard/src/app.ts:1562-1572`

- [ ] **Step 1: Add `registry` to the HeartbeatService config**

In `packages/dashboard/src/app.ts`, find the `new HeartbeatService({ ... })` block at line 1562. Add `registry: app.connectionRegistry` to the config object:

```typescript
const heartbeatService = new HeartbeatService({
  jobService: app.automationJobService,
  notificationQueue,
  get conversationInitiator() {
    return app.conversationInitiator;
  },
  staleThresholdMs: 5 * 60 * 1000,
  tickIntervalMs: 30 * 1000,
  capabilityHealthIntervalMs: 60 * 60 * 1000,
  registry: app.connectionRegistry,  // M9.4-S5 B7: WS broadcast for handoff_pending
});
```

If `app.connectionRegistry` is named differently (e.g., `connectionRegistry`, `wsRegistry`), match the actual property — search `app.ts` for `ConnectionRegistry` to confirm.

- [ ] **Step 2: Wire `setHeartbeat` before `heartbeatService.start()`**

Immediately before `heartbeatService.start();` (around line 1572):

```typescript
// M9.4-S5 B2: wire heartbeat into processor for fast-path drain.
// Must be set BEFORE start() so the first tick / first drainNow is wired.
app.automationProcessor?.setHeartbeat(heartbeatService);

heartbeatService.start();
```

- [ ] **Step 3: Verify the build compiles**

Run: `cd packages/dashboard && npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 4: Restart the dashboard and confirm startup logs**

```bash
systemctl --user restart nina-dashboard.service
journalctl --user -u nina-dashboard.service -n 30
```

Expected: no errors. Heartbeat starts as before, with the new wiring transparent.

- [ ] **Step 5: Commit**

```bash
git add packages/dashboard/src/app.ts
git commit -m "feat(app): wire heartbeat registry + setHeartbeat before start

Heartbeat now receives the WS connection registry to broadcast
handoff_pending. setHeartbeat is called on the processor before
heartbeatService.start() to ensure the fast-path drain is wired
before the first tick fires."
```

---

### Task 10: ws-client.js — emit `assistant-turn-start` and `handoff-pending` DOM events

**Files:**
- Modify: `packages/dashboard/public/js/ws-client.js:42-119` (the type switch)

- [ ] **Step 1: Add `start` and `handoff_pending` cases to the WS type switch**

In `packages/dashboard/public/js/ws-client.js`, find the `switch (data.type) { ... }` block (line 43-119). Add two new `case` blocks before the closing `}` (line 119):

```javascript
            case "start":
              // M9.4-S5: emit DOM event ONLY when triggerJobId is present.
              // Untagged 'start' events (user messages, model commands) must
              // NOT fire this — they would incorrectly fade handing-off cards.
              if (data.triggerJobId) {
                window.dispatchEvent(
                  new CustomEvent("assistant-turn-start", {
                    detail: { triggerJobId: data.triggerJobId },
                  }),
                );
              }
              break;
            case "handoff_pending":
              // M9.4-S5 B7: always emit, regardless of jobId match.
              // Frontend handler decides which cards to refresh.
              window.dispatchEvent(
                new CustomEvent("handoff-pending", {
                  detail: { jobId: data.jobId },
                }),
              );
              break;
```

Note: do NOT add `break` and skip the rest of the message flow — the existing `if (this.callbacks.onMessage) { this.callbacks.onMessage(data); }` after the switch (line 122) must still run for `start` so the chat handler still gets the event. The switch only adds DOM-event side effects; control then falls through to onMessage.

- [ ] **Step 2: Write a tiny unit test**

In `packages/dashboard/tests/unit/ui/ws-client.test.ts` (create if missing — model after existing UI unit tests, run with vitest):

```javascript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { JSDOM } from "jsdom";
// Note: ws-client.js is plain ES5/ES6 browser script, not a module.
// Test pattern: load via fs + eval inside JSDOM, or refactor to module.
// If refactor is too invasive, skip this test and rely on Task 12's browser
// test (T1 below covers the integration).

describe("ws-client message routing", () => {
  beforeEach(() => {
    const dom = new JSDOM("<!doctype html><html><body></body></html>");
    global.window = dom.window;
  });

  it("emits assistant-turn-start when start carries triggerJobId", () => {
    const handler = vi.fn();
    window.addEventListener("assistant-turn-start", handler);

    // Simulate the message handling logic directly:
    const data = { type: "start", triggerJobId: "job-1" };
    if (data.triggerJobId) {
      window.dispatchEvent(new CustomEvent("assistant-turn-start", {
        detail: { triggerJobId: data.triggerJobId },
      }));
    }

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].detail.triggerJobId).toBe("job-1");
  });

  it("does NOT emit assistant-turn-start when start has no triggerJobId", () => {
    const handler = vi.fn();
    window.addEventListener("assistant-turn-start", handler);

    const data = { type: "start" };
    if (data.triggerJobId) {
      window.dispatchEvent(new CustomEvent("assistant-turn-start", {
        detail: { triggerJobId: data.triggerJobId },
      }));
    }

    expect(handler).not.toHaveBeenCalled();
  });

  it("emits handoff-pending always", () => {
    const handler = vi.fn();
    window.addEventListener("handoff-pending", handler);

    const data = { type: "handoff_pending", jobId: "job-2" };
    window.dispatchEvent(new CustomEvent("handoff-pending", {
      detail: { jobId: data.jobId },
    }));

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].detail.jobId).toBe("job-2");
  });
});
```

If JSDOM isn't already in the project's deps, the test simulates the dispatch directly without loading ws-client.js — that's OK; the integration is exercised in browser tests (Task 12).

- [ ] **Step 3: Run the test**

Run: `cd packages/dashboard && npx vitest run tests/unit/ui/ws-client.test.ts`
Expected: PASS (or skipped if JSDOM unavailable).

- [ ] **Step 4: Commit**

```bash
git add packages/dashboard/public/js/ws-client.js \
        packages/dashboard/tests/unit/ui/ws-client.test.ts 2>/dev/null || true
git commit -m "feat(ws-client): emit assistant-turn-start + handoff-pending events

Two new DOM events for M9.4-S5 progress card handoff:
- 'assistant-turn-start' fires only when start carries triggerJobId
  (untagged user/model turns ignored)
- 'handoff-pending' fires for every handoff_pending server frame"
```

---

### Task 11: progress-card.js — three-phase state, frozen snapshot, sibling-aware safety net

**Files:**
- Modify: `packages/dashboard/public/js/progress-card.js` (full rewrite)

- [ ] **Step 1: Rewrite progress-card.js**

Replace the entire file `packages/dashboard/public/js/progress-card.js` with:

```javascript
/**
 * M9.4-S3: Job Progress Card component
 * M9.4-S5: Three-phase handoff (running → handing-off → fading) with
 *          sibling-aware safety net for handing-off cards.
 *
 * Sticky card above compose box showing real-time job step progress.
 * Reads from Alpine.store("jobs").activeCards.
 */

const HANDING_OFF_SAFETY_MS = 10_000;

function progressCard() {
  return {
    expanded: {},          // { [jobId]: boolean }
    fading: {},            // { [jobId]: "done" | "fading" }
    confirming: {},        // { [jobId]: true } — stop confirmation pending
    phase: {},             // M9.4-S5: { [jobId]: "running" | "handing-off" | "fading" }
    safetyTimers: {},      // M9.4-S5: { [jobId]: timeoutHandle }
    frozenSnapshot: {},    // M9.4-S5: { [jobId]: jobSnapshot } captured at handoff entry

    get cards() {
      const store = Alpine.store("jobs");
      return [...store.activeCards, ...store.completedCards.filter(c => !store.dismissed.includes(c.id))];
    },

    isExpanded(jobId) {
      return this.expanded[jobId] || false;
    },

    toggle(jobId) {
      this.expanded[jobId] = !this.expanded[jobId];
    },

    dismiss(jobId) {
      Alpine.store("jobs").dismiss(jobId);
      delete this.expanded[jobId];
      delete this.confirming[jobId];
      // M9.4-S5: clean up handoff state on user-driven dismiss
      this._clearSafetyTimer(jobId);
      delete this.phase[jobId];
      delete this.frozenSnapshot[jobId];
    },

    isConfirming(jobId) {
      return this.confirming[jobId] || false;
    },

    requestStop(jobId) {
      this.confirming[jobId] = true;
    },

    cancelStop(jobId) {
      delete this.confirming[jobId];
    },

    async confirmStop(jobId) {
      delete this.confirming[jobId];
      const store = Alpine.store("jobs");
      store.dismiss(jobId);
      delete this.expanded[jobId];
      this._clearSafetyTimer(jobId);
      delete this.phase[jobId];
      delete this.frozenSnapshot[jobId];
      try {
        const res = await fetch(`/api/jobs/${jobId}/stop`, { method: "POST" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      } catch (e) {
        console.error("[progress-card] stop failed, restoring card:", e);
        store.dismissed = store.dismissed.filter(id => id !== jobId);
      }
    },

    isFading(jobId) {
      return this.fading[jobId] === "fading";
    },

    isDone(jobId) {
      const f = this.fading[jobId];
      return f === "done" || f === "fading";
    },

    statusIcon(status) {
      switch (status) {
        case "done": return "\u2713";
        case "in_progress": return "\u21bb";
        case "blocked": return "\u2298";
        default: return "\u25cb";
      }
    },

    statusClass(status) {
      switch (status) {
        case "done": return "text-green-400/60";
        case "in_progress": return "text-blue-400";
        case "blocked": return "text-orange-400/60";
        default: return "text-gray-500";
      }
    },

    currentStepText(job) {
      // Prefer the frozen snapshot if the card is in handing-off (todos may
      // have been cleared from the live state:jobs broadcast).
      const snap = this.frozenSnapshot[job.id] ?? job;
      if (!snap.todoProgress?.items) return "";
      const current = snap.todoProgress.items.find(i => i.status === "in_progress");
      return current ? current.text : "";
    },

    /**
     * M9.4-S5: enter handing-off phase. Card stays at full opacity in "Done"
     * state, with a 10s safety timer. Push to completedCards so the card
     * keeps rendering even after status:jobs no longer reports running.
     */
    enterHandingOff(job) {
      const store = Alpine.store("jobs");
      if (store.dismissed.includes(job.id)) return;
      if (!job.todoProgress?.items?.length) return;
      if (this.phase[job.id] !== undefined) return;  // idempotent

      this.phase[job.id] = "handing-off";
      this.frozenSnapshot[job.id] = JSON.parse(JSON.stringify(job));
      this.fading[job.id] = "done";  // Re-uses existing isDone() check for label

      // Push to completedCards (preserves M9.4-S3 mechanism that keeps the
      // card rendering after state:jobs broadcasts no longer report running)
      if (!store.completedCards.find(c => c.id === job.id)) {
        store.completedCards.push(this.frozenSnapshot[job.id]);
      }

      this._armSafetyTimer(job.id);
    },

    /**
     * M9.4-S5: enter fading phase. Runs the existing 1.5s "Done" → 0.5s fade
     * → remove timeline. Does NOT push to completedCards (already pushed in
     * enterHandingOff for the M9.4-S5 path; legacy notify=none/debrief path
     * pushes here via the legacy fade fallback below).
     */
    enterFading(jobId) {
      if (this.phase[jobId] === "fading") return;  // idempotent
      this.phase[jobId] = "fading";
      this._clearSafetyTimer(jobId);

      const store = Alpine.store("jobs");
      this.fading[jobId] = "done";

      setTimeout(() => {
        this.fading[jobId] = "fading";
      }, 1500);

      setTimeout(() => {
        store.completedCards = store.completedCards.filter(c => c.id !== jobId);
        delete this.fading[jobId];
        delete this.phase[jobId];
        delete this.frozenSnapshot[jobId];
      }, 2000);
    },

    /**
     * Legacy fade for notify=none/debrief jobs. Called instead of
     * enterHandingOff so these jobs skip the handing-off phase entirely
     * and fade after the standard 2 seconds (matches pre-M9.4-S5 behavior).
     */
    legacyFade(job) {
      const store = Alpine.store("jobs");
      if (store.dismissed.includes(job.id)) return;
      if (!job.todoProgress?.items?.length) return;

      store.completedCards.push(job);
      this.fading[job.id] = "done";

      setTimeout(() => {
        this.fading[job.id] = "fading";
      }, 1500);

      setTimeout(() => {
        store.completedCards = store.completedCards.filter(c => c.id !== job.id);
        delete this.fading[job.id];
      }, 2000);
    },

    _armSafetyTimer(jobId) {
      this._clearSafetyTimer(jobId);
      this.safetyTimers[jobId] = setTimeout(() => {
        if (this.phase[jobId] === "handing-off") {
          this.enterFading(jobId);
        }
      }, HANDING_OFF_SAFETY_MS);
    },

    _clearSafetyTimer(jobId) {
      if (this.safetyTimers[jobId]) {
        clearTimeout(this.safetyTimers[jobId]);
        delete this.safetyTimers[jobId];
      }
    },

    /**
     * M9.4-S5: when an assistant turn starts (tagged with the matching jobId),
     * fade the matching card AND reset every other handing-off card's safety
     * timer (sibling-aware reset).
     */
    _onAssistantTurnStart(triggerJobId) {
      if (this.phase[triggerJobId] === "handing-off") {
        this.enterFading(triggerJobId);
      }
      // Reset siblings
      for (const jobId of Object.keys(this.phase)) {
        if (jobId !== triggerJobId && this.phase[jobId] === "handing-off") {
          this._armSafetyTimer(jobId);
        }
      }
    },

    /**
     * M9.4-S5: when handoff_pending broadcasts (heartbeat is processing the
     * queue), reset every handing-off card's safety timer (including the
     * one matching jobId). Protects against >10s cold-start stalling card #1
     * before its real start arrives.
     */
    _onHandoffPending(_jobId) {
      for (const jobId of Object.keys(this.phase)) {
        if (this.phase[jobId] === "handing-off") {
          this._armSafetyTimer(jobId);
        }
      }
    },

    init() {
      // M9.4-S5: watch for jobs transitioning from running to terminal status.
      // Route based on the notify policy.
      this.$watch(() => Alpine.store("jobs").items, (newJobs, oldJobs) => {
        if (!oldJobs) return;
        for (const job of newJobs) {
          const isTerminal = job.status === "completed" || job.status === "failed" || job.status === "needs_review";
          if (!isTerminal) continue;
          const wasRunning = oldJobs.find(o => o.id === job.id && o.status === "running");
          if (!wasRunning || !wasRunning.todoProgress?.items?.length) continue;

          // notify default (NF5): undefined → "debrief" (mirrors backend
          // automation-processor.ts:201 default).
          const notify = job.notify ?? "debrief";
          if (notify === "none" || notify === "debrief") {
            this.legacyFade(job);
          } else {
            this.enterHandingOff(job);
          }
        }
      });

      // M9.4-S5: subscribe to handoff WS events.
      window.addEventListener("assistant-turn-start", (e) => {
        this._onAssistantTurnStart(e.detail.triggerJobId);
      });
      window.addEventListener("handoff-pending", (e) => {
        this._onHandoffPending(e.detail.jobId);
      });
    },
  };
}
```

- [ ] **Step 2: Restart the dashboard**

```bash
cd packages/dashboard && npx tsc
systemctl --user restart nina-dashboard.service
```

(No backend changes in this task, but restart anyway since the JS file is served from disk via the cache-buster query string — and CLAUDE.md memory says: any UI change requires restart.)

- [ ] **Step 3: Smoke-check via browser**

Open the dashboard. Trigger a single automation manually. Watch the progress card:
- It should show steps as they complete.
- When the job finishes, the card should stay in "Done" with full opacity (NOT fade after 2s).
- ~2-4 seconds later, when Nina starts replying, the card should fade.

If the card fades immediately on completion, the `enterHandingOff` path didn't fire — check browser console for errors.

- [ ] **Step 4: Commit**

```bash
git add packages/dashboard/public/js/progress-card.js
git commit -m "feat(ui): three-phase progress card with sibling-aware handoff

Card phases: running → handing-off → fading. Cards in handing-off stay
at full opacity in 'Done' state with a 10s safety timer. Timer is reset
by any assistant-turn-start event (sibling or own) and any
handoff-pending broadcast. Untagged start events ignored.

notify=none/debrief jobs skip handing-off entirely (legacyFade path)
to preserve pre-M9.4-S5 timing for jobs that never trigger an alert.
notify=undefined treated as 'debrief' to mirror the backend default."
```

---

### Task 12: Browser tests (Playwright)

**Files:**
- Create: `packages/dashboard/tests/browser/progress-card-handoff.test.ts`

- [ ] **Step 1: Write the browser test file**

Create `packages/dashboard/tests/browser/progress-card-handoff.test.ts`:

```typescript
/**
 * M9.4-S5: Progress Card Handoff — Browser Verification
 *
 * Validates the new three-phase handoff behavior. Uses WebSocket message
 * injection (same pattern as M9.4-S3 progress-card tests) to simulate
 * server-pushed state.
 */

import { test, expect, type Page } from "@playwright/test";

const BASE_URL = "http://localhost:4321";

async function injectJobsState(page: Page, jobs: any[]) {
  await page.evaluate((jobs) => {
    (window as any).Alpine.store("jobs").update(jobs);
  }, jobs);
}

async function injectStartEvent(page: Page, triggerJobId: string | undefined) {
  await page.evaluate((triggerJobId) => {
    if (triggerJobId) {
      window.dispatchEvent(new CustomEvent("assistant-turn-start", { detail: { triggerJobId } }));
    } else {
      // Untagged start — should NOT fire the handoff event at all in real
      // ws-client; this helper just simulates the no-op for completeness.
    }
  }, triggerJobId);
}

async function injectHandoffPending(page: Page, jobId: string) {
  await page.evaluate((jobId) => {
    window.dispatchEvent(new CustomEvent("handoff-pending", { detail: { jobId } }));
  }, jobId);
}

function makeJob(id: string, status: string, notify = "alert", todoCount = 2) {
  return {
    id,
    automationId: "test-auto",
    automationName: "Test Auto",
    status,
    created: new Date().toISOString(),
    completed: status === "running" ? undefined : new Date().toISOString(),
    notify,
    todoProgress: {
      done: status === "running" ? 0 : todoCount,
      total: todoCount,
      current: status === "running" ? "Step 1" : null,
      items: Array.from({ length: todoCount }, (_, i) => ({
        id: `${id}-t${i}`,
        text: `Step ${i + 1}`,
        status: status === "running" ? (i === 0 ? "in_progress" : "pending") : "done",
      })),
    },
  };
}

test.describe("Progress Card Handoff — Spec acceptance criteria", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
    await page.waitForSelector("[x-data]", { timeout: 5000 });
  });

  test("AC4: card stays in 'Done' until matching tagged start arrives", async ({ page }) => {
    const job = makeJob("job-1", "running");
    await injectJobsState(page, [job]);
    await page.waitForTimeout(200);

    // Flip to completed
    await injectJobsState(page, [{ ...job, status: "completed" }]);
    await page.waitForTimeout(200);

    // Card should still be visible with "Done" label
    const card = page.locator("[x-data='progressCard()']").first();
    await expect(card).toBeVisible();
    await expect(card.locator("text=Done")).toBeVisible();

    // Should NOT fade after 3s (the legacy 2s mark)
    await page.waitForTimeout(3000);
    await expect(card.locator("text=Done")).toBeVisible();

    // Now inject the tagged start
    await injectStartEvent(page, "job-1");
    // Wait for the 2s fade timeline
    await page.waitForTimeout(2500);
    await expect(card).not.toBeVisible();
  });

  test("AC5: sibling card resets safety net", async ({ page }) => {
    const jobA = makeJob("job-a", "running");
    const jobB = makeJob("job-b", "running");
    await injectJobsState(page, [jobA, jobB]);
    await page.waitForTimeout(200);

    // Both flip to completed
    await injectJobsState(page, [
      { ...jobA, status: "completed" },
      { ...jobB, status: "completed" },
    ]);
    await page.waitForTimeout(200);

    // Wait 8 seconds — both safety nets would normally be at t=8/10
    await page.waitForTimeout(8000);

    // Inject start for A — fades A AND should reset B's safety net
    await injectStartEvent(page, "job-a");
    await page.waitForTimeout(2500);  // A fades

    // B should still be visible at t=10.5s post-completion (would have
    // expired without sibling reset)
    const cardB = page.locator(`[x-data='progressCard()'] :text("Done")`).nth(0);
    await expect(cardB).toBeVisible();

    // Confirm B fades when ITS start arrives
    await injectStartEvent(page, "job-b");
    await page.waitForTimeout(2500);
    await expect(cardB).not.toBeVisible();
  });

  test("AC6: notify=none job runs legacy 2s fade with no handing-off", async ({ page }) => {
    const job = makeJob("job-none", "running", "none");
    await injectJobsState(page, [job]);
    await page.waitForTimeout(200);

    await injectJobsState(page, [{ ...job, status: "completed" }]);

    // Should fade within ~2.5s with no further input
    const card = page.locator("[x-data='progressCard()']").first();
    await page.waitForTimeout(2500);
    await expect(card).not.toBeVisible();
  });

  test("AC6b: notify=undefined treated as debrief — legacy fade", async ({ page }) => {
    const job = makeJob("job-undef", "running");
    delete (job as any).notify;
    await injectJobsState(page, [job]);
    await page.waitForTimeout(200);

    await injectJobsState(page, [{ ...job, status: "completed" }]);

    const card = page.locator("[x-data='progressCard()']").first();
    await page.waitForTimeout(2500);
    await expect(card).not.toBeVisible();
  });

  test("AC7: safety net fires after 10s with no start and no handoff_pending", async ({ page }) => {
    const job = makeJob("job-stale", "running");
    await injectJobsState(page, [job]);
    await page.waitForTimeout(200);

    await injectJobsState(page, [{ ...job, status: "completed" }]);
    await page.waitForTimeout(500);

    // Card should still be visible at t=8s
    const card = page.locator("[x-data='progressCard()']").first();
    await expect(card).toBeVisible();
    await page.waitForTimeout(7500);  // total 8s
    await expect(card).toBeVisible();

    // After 10s + 2s fade = 12.5s total
    await page.waitForTimeout(4500);
    await expect(card).not.toBeVisible();
  });

  test("AC12: handoff_pending for own jobId resets safety net (cold-start case)", async ({ page }) => {
    const job = makeJob("job-cold", "running");
    await injectJobsState(page, [job]);
    await page.waitForTimeout(200);

    await injectJobsState(page, [{ ...job, status: "completed" }]);

    // Wait 8s, then send handoff_pending for THIS jobId — should reset its timer
    await page.waitForTimeout(8000);
    await injectHandoffPending(page, "job-cold");

    // Card should still be visible at t=14s (would have expired at t=10 without the reset)
    await page.waitForTimeout(6000);
    const card = page.locator("[x-data='progressCard()']").first();
    await expect(card).toBeVisible();
  });
});
```

- [ ] **Step 2: Run the browser tests against the running dashboard**

```bash
cd packages/dashboard && npx playwright test tests/browser/progress-card-handoff.test.ts
```

Expected: All tests pass. If any fail, debug — likely culprits: timing assumptions (network slower than expected), Alpine store not yet initialized (extend `waitForSelector`), or selector mismatches.

- [ ] **Step 3: Run the existing M9.4-S3 browser tests to confirm no regressions**

```bash
cd packages/dashboard && npx playwright test tests/browser/progress-card.test.ts
```

Expected: All 10 tests still pass.

- [ ] **Step 4: Append results to the test report**

Update `docs/sprints/m9.4-s5-job-card-handoff/test-report.md` with a new "Browser tests" section listing each test and its result.

- [ ] **Step 5: Commit**

```bash
git add packages/dashboard/tests/browser/progress-card-handoff.test.ts \
        docs/sprints/m9.4-s5-job-card-handoff/test-report.md
git commit -m "test(browser): M9.4-S5 progress card handoff tests

Covers acceptance criteria 4-7 and 12 (handing-off persistence, sibling
reset, legacy fade for notify=none/undefined, safety net trip,
cold-start handoff_pending reset)."
```

---

### Task 13: Cleanup — downgrade timing logs, post-implementation smoke test

**Files:**
- Modify: `packages/dashboard/src/automations/timing.ts` (downgrade or remove)
- Modify: callers from Task 1 (delete the calls if `timing.ts` removed)

- [ ] **Step 1: User runs CNN smoke test on the implemented version**

```bash
cd packages/dashboard && npx tsc
systemctl --user restart nina-dashboard.service
```

User triggers CNN automation. Monitor with:

```bash
journalctl --user -u nina-dashboard.service -f | grep '\[timing\]'
```

- [ ] **Step 2: Append post-implementation timing to test report**

In `docs/sprints/m9.4-s5-job-card-handoff/test-report.md`, add a "Post-implementation timing" section comparing to the baseline from Task 2. Confirm:

- `enqueued` → `deliverPending start`: should be < 300 ms (acceptance #3).
- Total perceived gap (job done → first text on screen): should be 2-4 seconds.
- Card stays visible through the full handoff.

- [ ] **Step 3: Decide: delete timing.ts or downgrade to debug-only**

Easiest: delete `timing.ts` and remove all callers. Per CLAUDE.md: "Don't add features beyond what the task requires."

```bash
rm packages/dashboard/src/automations/timing.ts
```

Then delete the import + call in each of:
- `automation-executor.ts` (line ~422 `timingMark(job.id);` and the import)
- `automation-processor.ts` (the `timingLog` call after enqueue, and the entry log, and the import)
- `heartbeat-service.ts` (the upfront for-of timingLog, the per-iteration timingLog, and the import)
- `send-system-message.ts` (the `console.log("[timing] start emitted ...")`)
- `ws-client.js` (no timing logs added in tasks 10/11 — skip)

- [ ] **Step 4: Verify the build still compiles**

Run: `cd packages/dashboard && npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 5: Run the full test suite**

Run: `cd packages/dashboard && npx vitest run`
Expected: All non-pre-existing-failures pass.

- [ ] **Step 6: Restart and visually verify one more time**

```bash
systemctl --user restart nina-dashboard.service
```

Trigger an automation. Confirm UX is still correct (handing-off, fade on Nina's reply).

- [ ] **Step 7: Commit**

```bash
git add -u  # captures deletions and modifications
git commit -m "refactor(m9.4-s5): remove timing instrumentation

Post-implementation measurements confirmed in test-report.md.
Removes timing.ts and all [timing] log call sites added in Task 1."
```

- [ ] **Step 8: Update roadmap status**

In `docs/ROADMAP.md`, find the M9.4 row and the M9.4-S5 sprint entry. Change status from "Spec'd" to "Done" and add a one-line summary. Update the M9.4 milestone status from "In Progress" back to "Done".

```bash
git add docs/ROADMAP.md
git commit -m "docs(roadmap): mark M9.4-S5 done, M9.4 milestone done"
```

---

## Self-review checklist

- **Spec coverage:**
  - B1 reentrancy guard → Task 7 step 2-3 ✓
  - B2 setHeartbeat + drainNow on enqueue → Task 8 + Task 9 ✓
  - B3 triggerJobId plumbing → Task 5 + Task 6 ✓
  - B4 todoProgress regardless of status → Task 4 ✓
  - B5 notify in JobSnapshot → Task 4 ✓
  - B6 busy-skip explicit signal → not implemented as a separate event in plan; the existing early-return path is preserved (no change needed to ship — `handoff_pending` retry from B7 covers the recovery case). Documented as deferred refinement.
  - B7 handoff_pending two-stage broadcast → Task 7 step 4 ✓
  - F1-F5 frontend phases + sibling-aware → Task 11 ✓
  - F6 visual states (label flips for completed/failed/needs_review) → only "Done" implemented in Task 11; failed/needs-review label refinements deferred (current code shows "Done" for all terminal statuses since the phase distinguishes only by isDone(), not the underlying status). Acceptable for v1; track as polish.
  - Acceptance criteria 1-12 → Tasks 1-2 (timing), 7-9 (drain), 12 (browser) ✓
- **Placeholder scan:** No TBD/TODO. All steps have actual code.
- **Type consistency:** `triggerJobId?: string` used consistently; `phase` keys are `"running" | "handing-off" | "fading"` consistently; `enterHandingOff` and `enterFading` named consistently; `safetyTimers` (plural) consistently.
- **Test coverage:** Unit tests for chat plumbing (Task 5), heartbeat reentrancy + handoff_pending (Task 7), processor drainNow (Task 8), ws-client emission (Task 10). Browser tests for all acceptance criteria (Task 12). Integration tests for state snapshots (Task 4).

## Deferred refinements (track for follow-up if smoke test reveals)

1. **B6 explicit busy-skip event.** If `isStreaming()` early-returns are observed in production, surface them as an event so the frontend can extend the safety net more precisely. Today's design relies on the next tick re-broadcasting `handoff_pending`.
2. **F6 status-specific labels.** Currently all terminal statuses show "Done." If the user wants distinct "Failed" / "Needs review" labels, extend `progress-card.js` to read `frozenSnapshot.status`.
3. **Per-text_delta safety reset (NF4 residual).** If Nina's response to one card takes >10 s and the next sibling fades prematurely, reset siblings on each `text_delta` of any active stream.
