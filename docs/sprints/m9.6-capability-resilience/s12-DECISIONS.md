---
sprint: m9.6-s12
title: PostToolUseFailure CFR Hook + Automation-Origin Wiring — decisions
---

# S12 Decisions

## D1 — SessionContext type and lifecycle

### Type definition

```typescript
/** Context captured at SDK session-open time; keyed by SDK session_id. */
export type SessionContext =
  | ConversationSessionContext
  | AutomationSessionContext;

/** Brain/conversation session — one per active streamMessage call */
export interface ConversationSessionContext {
  kind: "conversation";
  channel: ChannelContext;
  conversationId: string;
  turnNumber: number;
}

/** Automation/job session — one per AutomationExecutor.run() call */
export interface AutomationSessionContext {
  kind: "automation";
  automationId: string;
  jobId: string;
  runDir: string;
  notifyMode: "immediate" | "debrief" | "none";
}
```

`ChannelContext` is the existing interface from `packages/core/src/capabilities/cfr-types.ts`:

```typescript
export interface ChannelContext {
  transportId: string;   // e.g. "whatsapp", "dashboard"
  channelId: string;
  sender: string;
  replyTo?: string;
  senderName?: string;
  groupId?: string;
}
```

`SessionContext` maps 1-to-1 to `TriggeringOrigin`'s `"conversation"` and `"automation"` variants.
The `"system"` variant of `TriggeringOrigin` has no corresponding `SessionContext` because system
origins are not spawned by SDK sessions — they come from scheduled background components that
pass their own origin inline.

### Storage

Two separate maps, each owned by its respective module:

- `SessionManager` — `private sessionContexts: Map<string, ConversationSessionContext>`
- `AutomationExecutor` — `private sessionContexts: Map<string, AutomationSessionContext>`

Each map is keyed by the SDK `session_id` string received in the `system.init` event
(`msg.type === "system" && msg.subtype === "init" && msg.session_id`).

The maps are kept on the class instances (not module-level singletons) so each
`SessionManager` (one per conversation) and each `AutomationExecutor` instance owns
its own map. There is no cross-instance lookup requirement.

### Population

**Brain/conversation sessions (`SessionManager`):**

Population happens at the top of `streamMessage()`, before `processStream()` starts.
At that point the caller has already called `setChannel()` (which stores the channel
string) but the full `ChannelContext` is not yet available — it arrives from
`message-handler.ts` via the `chat.sendMessage()` call chain, which passes a
`channel` struct with all fields populated.

The implementation must wire the full `ChannelContext` into `SessionManager` before
`streamMessage()` is called. The recommended approach is a `setTurnContext()` method
(or an optional parameter to `streamMessage()`) that the chat-service calls alongside
`setChannel()`, supplying the full `{ transportId, channelId, sender, replyTo, senderName, groupId }`.

When the SDK's `session_init` event fires and we capture `this.sdkSessionId`, we
simultaneously write to `sessionContexts`:

```typescript
// On session_init event inside streamMessage():
if (event.type === "session_init") {
  this.sdkSessionId = event.sessionId;
  if (this.pendingTurnContext) {
    this.sessionContexts.set(event.sessionId, this.pendingTurnContext);
    this.pendingTurnContext = null;
  }
}
```

**Automation sessions (`AutomationExecutor`):**

Population happens when the SDK's `system.init` event fires inside `AutomationExecutor.run()`.
The job context (`automationId`, `jobId`, `runDir`, `notifyMode`) is already known at
job-start from the `Automation` manifest and `Job` record:

```typescript
// On init event inside run():
if (msg.type === "system" && msg.subtype === "init" && msg.session_id) {
  sdkSessionId = msg.session_id;
  this.sessionContexts.set(sdkSessionId, {
    kind: "automation",
    automationId: automation.id,
    jobId: job.id,
    runDir: job.run_dir ?? "",
    notifyMode: resolveNotifyMode(automation.manifest),
  });
  this.config.jobService.updateJob(job.id, { sdk_session_id: sdkSessionId });
}
```

### Clearing

**Brain sessions:** cleared at the end of `streamMessage()`'s `finally` block, keyed by
the `sdkSessionId` captured for that call:

```typescript
finally {
  this.activeQuery = null;
  if (this.sdkSessionId) {
    this.sessionContexts.delete(this.sdkSessionId);
  }
}
```

On session-resume, the old session_id is discarded and the new one replaces it; the
`finally` block deletes whichever `sdkSessionId` was active at function exit, which
is correct whether a fresh or resumed session completed.

**Automation sessions:** cleared at the end of `AutomationExecutor.run()`'s `finally`
block after the job-completion update runs:

```typescript
finally {
  if (sdkSessionId) {
    this.sessionContexts.delete(sdkSessionId);
  }
  this.abortControllers.delete(job.id);
  if (disabledSkills.length > 0) { ... }
}
```

On abort, the `abortController.signal.aborted` early-return path falls through to
the same `finally`, so cleanup is guaranteed.

**Leak prevention:** A missing `session_init` event (e.g. the SDK never fires it for
a handler-dispatched job) leaves nothing in the map — harmless. A crash inside the
for-await loop that does not reach `finally` is a process-exit scenario; in-memory
maps do not persist across restarts.

### Lookup at hook fire (originFactory)

The `originFactory` closure captures three things: a reference to the map, the
`session_id` that the hook input provides via `BaseHookInput.session_id`, and the
`kind` hint used to construct the fallback error message.

```typescript
// In SessionManager (brain side):
const originFactory = (): TriggeringOrigin => {
  const ctx = this.sessionContexts.get(hookSessionId);
  if (!ctx) {
    throw new Error(
      `[McpCfrDetector] No SessionContext for session_id "${hookSessionId}" — ` +
      `this is a programming error: originFactory called outside an active session`,
    );
  }
  return { kind: ctx.kind, ...ctx } as TriggeringOrigin;
};
```

A missing context is treated as a programming error (not a runtime path) because:

1. The hook fires only while an SDK session is active.
2. The session context is populated before the session starts streaming.
3. The context is cleared only in the `finally` block that runs after streaming ends.

If the hook fires outside this window, something has gone wrong in the wiring — a
hard throw surfaces the bug immediately rather than silently producing an empty origin.

The `session_id` available inside the hook comes from `BaseHookInput.session_id`
(confirmed present in `sdk.d.ts:1229-1236`). The detector closure captures
`input.session_id` at hook-fire time to perform the lookup.

---

## D2 — notifyMode defaults to "debrief"

**Decision:** when an automation manifest does not declare a `notify_mode` field
(or the field is absent/null), `AutomationSessionContext.notifyMode` is set to
`"debrief"`.

**Rationale:**

- `"immediate"` would fire a channel notification mid-job at the moment the CFR
  terminal transition occurs. For most automations this is surprising: the user
  asked for a job result, not a progress interrupt. The correct time to learn about
  a capability failure is in the job's debrief.
- `"none"` would suppress the notification entirely, leaving the user with no record
  of the recovery effort unless they inspect the run dir manually. Not acceptable for
  unmonitored overnight automations.
- `"debrief"` writes `CFR_RECOVERY.md` synchronously on terminal transition
  (durable record), then surfaces the recovery summary in the next debrief cycle.
  The job result already signals completion to the user; the debrief carries the
  "here's what the framework fixed while you weren't watching" narrative. This
  matches the workflow the system was designed for.

`resolveNotifyMode(manifest)` is a small helper that reads `manifest.notify_mode`
with a fallback to `"debrief"`:

```typescript
function resolveNotifyMode(manifest: AutomationManifest): "immediate" | "debrief" | "none" {
  const m = manifest.notify_mode;
  if (m === "immediate" || m === "debrief" || m === "none") return m;
  return "debrief";
}
```

---

## D3 — ChannelContext completeness constraint

**Problem:** The S10 placeholder in `app.ts:542-546` creates a `ChannelContext` with
hard-coded empty/synthetic values:

```typescript
{ transportId: "dashboard", channelId: "dashboard", sender: "system" }
```

This means any CFR emitted via `CapabilityInvoker` gets a context that cannot be
used to route an ack back to the real user — the `sender` is `"system"`, the
`channelId` is fake, and `conversationId` is `""`.

**Constraint for S12:** when `SessionManager` populates a `ConversationSessionContext`,
the `ChannelContext` must be fully populated from the originating turn. All fields
known at turn-start must be present:

| Field | Source | Required |
|---|---|---|
| `transportId` | `channelId` from `message-handler.ts` (the transport name) | Always |
| `channelId` | Same as `transportId` in current channel design | Always |
| `sender` | `first.from` (the JID or user identifier of the message sender) | Always |
| `replyTo` | `first.replyTo?.text` | Optional |
| `senderName` | `first.senderName` | Optional |
| `groupId` | `first.groupId` | Optional |

**How the constraint is met:** `message-handler.ts` already assembles this struct
at lines 543-550 before passing it to `chat.sendMessage()`. The implementation must
thread this struct from the call site into `SessionManager.setTurnContext()` (or
an equivalent per-turn context setter) so it is available when `session_init` fires.

For dashboard web sessions where the message originates from the browser WebSocket
(not from a channel plugin), the context is:

```typescript
{ transportId: "dashboard", channelId: "dashboard", sender: userId }
```

where `userId` is the authenticated session's user identifier (not `"system"`).
The `conversationId` and `turnNumber` come from the `SessionManager`'s own fields.

**Why not populate at session-open instead of turn-start?** A `SessionManager`
instance lives across multiple turns (one per conversation). The `conversationId`
is stable across turns but the `channel`, `sender`, and `turnNumber` change per
turn (especially in group chats where different senders can write to the same
conversation). The context must be captured per-turn so the `TriggeringOrigin`
reflects the actual sender of the turn that triggered the capability failure.

---

## D4 — originFactory placement for the S10 CapabilityInvoker placeholder

The S10 `app.ts:542-546` placeholder wires a static factory into `CapabilityInvoker`.
Script-plug invocations via `CapabilityInvoker.run()` use this factory when no
caller-provided `TriggeringInput` is given (see S10-D1).

In S12 this factory must become a live lookup into `SessionManager`'s context map.
The challenge is that `app.capabilityInvoker` is constructed once at startup, but
the active SDK session changes per-turn.

**Decision:** `app.capabilityInvoker.originFactory` is replaced with a closure that
delegates to `app.sessionManager`'s context map at call time, not at construction
time. The closure captures the `SessionManager` reference:

```typescript
app.capabilityInvoker = new CapabilityInvoker({
  cfr: app.cfr,
  registry,
  originFactory: () => {
    // At hook-fire time, ask SessionManager for the current active session's origin.
    // SessionManager exposes a getCurrentOrigin() method that returns the context
    // for the most recently active session (or throws if none is active).
    return app.sessionManager.getCurrentOrigin();
  },
});
```

`SessionManager.getCurrentOrigin()` looks up the context by `this.sdkSessionId`
(the session ID captured from the most recent `session_init` event). This works
because `CapabilityInvoker` is only called by the brain session, which is
single-threaded per conversation (one active query at a time).

This wiring is identical in structure to the `McpCapabilityCfrDetector`'s own
`originFactory` — both are closures over the same context map and follow the same
"throw on miss" contract from D1.

---

## D5 — CFR_RECOVERY.md schema (load-bearing; debrief-prep parses this)

Defined here as the authoritative schema for Task 5 (ack-delivery) and Task 7
(debrief-prep reader). Must not change shape without updating both sides.

**File location:** `<job.run_dir>/CFR_RECOVERY.md`

**Format:** YAML frontmatter (written via `writeFrontmatter()` per the
normalized-metadata standard) + markdown body.

```yaml
---
plug_name: <capability.name>            # e.g. browser-chrome
plug_type: <capability.provides>        # e.g. browser-control
detected_at: <ISO8601>                  # CFR detection timestamp
resolved_at: <ISO8601>                  # terminal transition timestamp
attempts: <1|2|3>                       # number of fix attempts run
outcome: fixed | surrendered
surrender_reason: <iteration-3 | redesign-needed | insufficient-context | budget>
  # surrender_reason is present only when outcome === "surrendered"; omit otherwise
---

# <plug_name> recovery summary

<one paragraph from the final attempt's deliverable.md frontmatter.summary;
 or, on surrender, a brief explanation of what was tried and why it stopped>

## Attempts

| # | Hypothesis | Change | Result |
|---|---|---|---|
| 1 | <session.attempts[0].hypothesis> | <session.attempts[0].change> | pass or fail: <failureMode> |
...
```

**Writing rules:**
- Written synchronously by `ack-delivery.ts` on terminal transition for automation origins.
- `outcome: "fixed"` when reverify passed; `outcome: "surrendered"` otherwise.
- `surrender_reason` is populated from `session.surrenderReason` (`"budget"` or
  `"iteration-3"`). If `surrenderReason` is undefined (should not happen in practice),
  omit the field.
- If `notifyMode === "none"`, the file is still written — `notifyMode` controls
  whether a notification fires, not whether the durable record is created.
- `detected_at` comes from `failure.detectedAt`; `resolved_at` is `now()` at
  terminal-transition time.

---

## D6 — Option A for non-conversation surrender handling

**Decision:** automation and system origins skip `SurrenderScope` recording entirely.
Their surrender info lands in `CFR_RECOVERY.md` (automation) or console log (system).

**Rationale:** `SurrenderScope` (from S9-D1) is conversation-scoped
(`{capabilityType, conversationId, turnNumber, expiresAt}`) and its purpose is to
prevent the same user from receiving repeated "sorry, I can't fix this" messages
within a 10-minute window. Automations do not directly face users during execution;
the debrief carries the summary. Cross-automation cooldown is therefore not needed
by this mechanism — the run dir record is sufficient.

Option B (widening `SurrenderScope` to a discriminated union covering automation
origins) is deferred to a future sprint if cross-origin cooldown proves necessary.
Named in `s12-FOLLOW-UPS.md`.

---

## D7 — attachedOrigins initialization in FixSession

**Decision:** `FixSession` gains `attachedOrigins: TriggeringOrigin[]`, initialized
with the first CFR's origin when a new fix session is created. Late-arriving CFRs for
the same plug append to this list rather than spawning a second automation.

The existing behavior at `recovery-orchestrator.ts:~103` (which currently throws
"unreachable in S9") is replaced with:

```typescript
// Dedup: fix already in-flight for this capability type — attach silently.
if (this.inFlight.has(capabilityType)) {
  const existing = this.inFlight.get(capabilityType)!;
  existing.attachedOrigins.push(origin);
  // No second fix job; no duplicate ack; terminal drain handles all attached origins.
  return;
}
```

The originating origin is already in `attachedOrigins` (set at session creation),
so the terminal drain processes it along with any attached late-arrivers in the
§3.4 six-step order.

---

*Task 0 complete. These decisions gate Tasks 2–9. Implementation begins after Day-1
spike (Task 1) confirms the PostToolUseFailure hook wiring.*
