# M9.4-S2.5: Streaming Broadcast — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move streaming event broadcasts (text_delta, done, etc.) from the WS adapter into the App layer so all callers of `sendMessage()` — dashboard, channels, alert() — automatically broadcast to all connected WebSocket clients. Remove the `conversation_ready` workaround. Sweep all remaining state mutations that bypass App events into the same pattern.

**Root cause:** M6.10 established the principle "every App mutation emits events, adapters subscribe." Streaming events were the one exception — they're yielded by the `sendMessage()` generator but only the WS chat-handler sends them to the originating client. When the channel message-handler calls `sendMessage()`, nobody broadcasts to WS clients. An audit also found 6 other state mutation paths that bypass App events (direct DB writes + direct WS broadcasts).

**The fix:** `ChatService.sendMessage()` and `sendSystemMessage()` emit `chat:*` App events as they yield generator events. A new subscriber in `index.ts` (the WS adapter layer) listens to these events and broadcasts via `connectionRegistry.broadcastToConversation()`. The chat-handler stops sending streaming events directly and receives them through the broadcast like any other client. All remaining bypass paths (unpin, setModel, abbreviation rename, job:started, external messages) are routed through App event wrappers.

**Design spec:** [conversation-ux-ui-design.md](../../superpowers/specs/2026-04-08-conversation-ux-ui-design.md) — S2.5 addendum

**Also fixes:**
- 6 broken tests in `conversation-initiator-routing.test.ts` and `source-channel.test.ts` (S1-induced mock mismatches)
- `sendSystemMessage()` not emitting streaming events (alert/heartbeat invisible to dashboard)
- `conversation_created` double-broadcast from message-handler + App event
- `conversationManager.unpin()` called directly in message-handler (bypasses App events)
- `setModel()` in message-handler bypasses App events
- `AbbreviationQueue` rename uses bespoke callback instead of App events
- `job:started` event never emitted despite being defined in AppEventMap
- `ExternalMessageStore` writes directly to DB with no events
- Split-path (tool use after text) missing `chat:start` for message 2

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `packages/dashboard/src/chat/chat-service.ts` | Emit `chat:*` App events alongside generator yields (incl. split-path) |
| Modify | `packages/dashboard/src/chat/send-system-message.ts` | Emit `chat:start` and `chat:text_delta` App events |
| Modify | `packages/dashboard/src/app-events.ts` | Add `chat:user_turn`, `chat:conversation_created`, `external_message:created` |
| Modify | `packages/dashboard/src/index.ts` | Subscribe to `chat:*` events, broadcast via connectionRegistry |
| Modify | `packages/dashboard/src/ws/chat-handler.ts` | Remove direct `send()` for streaming events; keep control events |
| Modify | `packages/dashboard/src/channels/message-handler.ts` | Remove `conversation_ready` + duplicate broadcasts; route unpin/setModel through App |
| Modify | `packages/dashboard/src/channels/external-store.ts` | Emit `external_message:created` App event |
| Modify | `packages/dashboard/src/app.ts` | Add `setModel()` to AppConversationService; wire external store event |
| Modify | `packages/dashboard/src/conversations/abbreviation.ts` | Emit `conversation:updated` App event instead of bespoke callback |
| Modify | `packages/dashboard/src/automations/automation-processor.ts` | Emit `job:started` via onJobEvent callback |
| Modify | `packages/dashboard/src/ws/protocol.ts` | Remove `conversation_ready` type |
| Modify | `packages/dashboard/public/js/app.js` | Remove `conversation_ready` handler |
| Modify | `packages/dashboard/tests/e2e/conversation-initiator-routing.test.ts` | Fix mock: SessionFactory → ChatServiceLike |
| Modify | `packages/dashboard/tests/unit/notifications/source-channel.test.ts` | Fix mock to match S1 heartbeat simplification |

---

## Task 1: Emit Chat Streaming Events from ChatService

**Files:**
- Modify: `packages/dashboard/src/chat/chat-service.ts`

The chat streaming event types already exist in `app-events.ts` (lines 61-71) but only `chat:done` is emitted. Wire the rest.

- [ ] **Step 1: Emit `chat:start` when yielding start event**

In `sendMessage()`, after the `yield { type: "start", _effects }` (around line 647), add:

```typescript
this.app.emit("chat:start", convId);
```

- [ ] **Step 2: Emit `chat:text_delta` when yielding text_delta**

In the streaming loop (around line 691), after `yield { type: "text_delta", text: event.text }`:

```typescript
this.app.emit("chat:text_delta", convId, event.text);
```

- [ ] **Step 3: Emit `chat:thinking_delta` and `chat:thinking_end`**

Same pattern — after each yield:

```typescript
// thinking_delta (around line 697)
this.app.emit("chat:thinking_delta", convId, event.text);

// thinking_end (around line 700)
this.app.emit("chat:thinking_end", convId);
```

- [ ] **Step 4: Emit `chat:error` on error**

Where errors are yielded, add:

```typescript
this.app.emit("chat:error", convId, errorMessage);
```

- [ ] **Step 5: Verify `chat:done` is already emitted**

Confirm the existing `this.app.emit("chat:done", convId, cost, usage)` at line 858 is still in place. No change needed.

- [ ] **Step 6: Emit user turn and conversation creation as chat events**

Add two new events to `app-events.ts`:

```typescript
"chat:user_turn": [conversationId: string, turn: TranscriptTurn];
"chat:conversation_created": [conversationId: string, conversation: Conversation];
```

Emit from `sendMessage()` after saving the user turn (around line 628):

```typescript
this.app.emit("chat:user_turn", convId, userTurn);
if (conversationCreated) {
  this.app.emit("chat:conversation_created", convId, conversationCreated);
}
```

- [ ] **Step 7: Emit streaming events from `sendSystemMessage()`**

`send-system-message.ts` is a separate code path used by `alert()` and heartbeat delivery. It currently only emits `chat:done` (line 89). Without the other events, alert responses are invisible to dashboard WS clients.

In `send-system-message.ts`, add emits:

```typescript
// After yield { type: "start" as const } (line 52):
app.emit("chat:start", conversationId);

// After yield { type: "text_delta", text: event.text } (line 60):
app.emit("chat:text_delta", conversationId, event.text);
```

- [ ] **Step 8: Emit `chat:start` for message 2 in split-path**

When the assistant sends text then uses a tool, `sendMessage()` yields `done` to close message 1, then continues streaming message 2. The second segment has no `chat:start`. In `chat-service.ts`, after the split `yield { type: "done" }` (around line 714), add:

```typescript
// Signal start of message 2 (post-tool-use continuation)
this.app.emit("chat:start", convId);
```

- [ ] **Step 9: Type check**

```bash
cd packages/dashboard && npx tsc --noEmit
```

Commit: `"feat(chat): emit all chat streaming events as App events"`

---

## Task 2: Subscribe to Chat Events in WS Adapter

**Files:**
- Modify: `packages/dashboard/src/index.ts`

The WS adapter layer subscribes to `chat:*` App events and broadcasts to connected clients via connectionRegistry. This is the same pattern as StatePublisher (subscribes to App events, broadcasts to WS) but for streaming events.

- [ ] **Step 1: Add chat event subscriptions after StatePublisher setup**

In `index.ts`, after `app.statePublisher.subscribeToApp(app)` (or similar wiring), add:

```typescript
// ── Chat streaming broadcasts ──────────────────────────────────
// Streams chat events to all WS clients viewing the conversation.
// This makes streaming work regardless of who called sendMessage()
// (dashboard, channel handler, alert, etc.)

app.on("chat:start", (conversationId) => {
  server.connectionRegistry.broadcastToConversation(conversationId, {
    type: "start",
  });
});

app.on("chat:text_delta", (conversationId, text) => {
  server.connectionRegistry.broadcastToConversation(conversationId, {
    type: "text_delta",
    content: text,
  });
});

app.on("chat:thinking_delta", (conversationId, text) => {
  server.connectionRegistry.broadcastToConversation(conversationId, {
    type: "thinking_delta",
    content: text,
  });
});

app.on("chat:thinking_end", (conversationId) => {
  server.connectionRegistry.broadcastToConversation(conversationId, {
    type: "thinking_end",
  });
});

app.on("chat:done", (conversationId, cost, usage) => {
  server.connectionRegistry.broadcastToConversation(conversationId, {
    type: "done",
    cost,
    usage,
  });
});

app.on("chat:error", (conversationId, message) => {
  server.connectionRegistry.broadcastToConversation(conversationId, {
    type: "error",
    message,
  });
});

app.on("chat:user_turn", (conversationId, turn) => {
  server.connectionRegistry.broadcastToConversation(conversationId, {
    type: "conversation_updated",
    conversationId,
    turn,
  });
});

app.on("chat:conversation_created", (conversationId, conversation) => {
  server.connectionRegistry.broadcastToAll({
    type: "conversation_created",
    conversation,
  });
});
```

- [ ] **Step 2: Type check**

```bash
cd packages/dashboard && npx tsc --noEmit
```

Commit: `"feat(ws): subscribe to chat App events, broadcast to all clients"`

---

## Task 3: Remove Direct Sends from Chat Handler

**Files:**
- Modify: `packages/dashboard/src/ws/chat-handler.ts`

The chat-handler currently sends streaming events directly to the originating client. Now that App events broadcast to all clients viewing the conversation, the chat-handler should stop doing this to avoid duplicate messages.

**Important:** The chat-handler MUST still:
- Subscribe the originating socket to the conversation (`connectionRegistry.switchConversation`)
- Handle the `_effects` from the start event (conversationId resolution)
- Manage the response timer (cancel on first token)
- Handle `turn_advanced` for turn number tracking

It should NOT:
- `send(serverMsg)` for text_delta/done/thinking_delta/thinking_end/error
- `broadcastToConversation()` for user turns (now handled by chat:user_turn event)
- `broadcastToAll()` for conversation_created (now handled by chat:conversation_created event)

- [ ] **Step 1: Remove streaming sends from the generator loop**

In the main `for await` loop (lines 523-578), replace:

```typescript
// BEFORE:
const serverMsg = chatEventToServerMessage(event);
if (serverMsg.type === "text_delta" && firstToken) {
  responseTimer.cancel();
  firstToken = false;
}
send(serverMsg);
```

With:

```typescript
// AFTER:
// Streaming events are broadcast by the App event listener (index.ts).
// We only need to track first token for the response timer.
if (event.type === "text_delta" && firstToken) {
  responseTimer.cancel();
  firstToken = false;
}
```

- [ ] **Step 2: Remove user turn broadcast from start effects handler**

Remove the `broadcastToConversation()` call for `conversation_updated` (user turn) at line 556 — now handled by `chat:user_turn`.

Also remove the `send(userTurnUpdate)` at line 563 — the originating client receives it via the broadcast too (they're viewing the conversation).

- [ ] **Step 3: Remove conversation_created broadcast from start effects**

Remove the `broadcastToAll()` for `conversation_created` at line 542 — now handled by `chat:conversation_created`.

- [ ] **Step 4: Keep the essentials**

Verify these remain in the handler:
- `connectionRegistry.switchConversation(socket, effects.conversationId)` — socket must be subscribed to receive broadcasts
- `currentConversationId = effects.conversationId` — for turn number tracking
- `currentTurnNumber` tracking on `turn_advanced`
- `responseTimer` management

- [ ] **Step 5: Remove `chatEventToServerMessage` if no longer used**

Check if the mapping function (lines 618-641) is still referenced. If not, remove it.

- [ ] **Step 6: Handle double-delivery for originating client**

The originating client's socket is already registered to the conversation (via `switchConversation`), so `broadcastToConversation()` will include it. This means the originating client now receives streaming events through the broadcast — no special handling needed.

**BUT:** Verify this doesn't cause duplicate messages on the frontend. The frontend's `text_delta` handler appends to `currentAssistantMessage.content`. If the same text_delta arrives twice, the message doubles. Since we're removing the direct `send()`, there should be only one source (the broadcast). Confirm by testing.

- [ ] **Step 7: Type check + test**

```bash
cd packages/dashboard && npx tsc --noEmit
npx vitest run tests/
```

Commit: `"refactor(ws): remove direct streaming sends, rely on App event broadcasts"`

---

## Task 4: Remove conversation_ready

**Files:**
- Modify: `packages/dashboard/src/channels/message-handler.ts`
- Modify: `packages/dashboard/src/ws/protocol.ts`
- Modify: `packages/dashboard/public/js/app.js`

Now that channel messages broadcast streaming events through App, `conversation_ready` is no longer needed.

- [ ] **Step 1: Remove conversation_ready broadcast from message-handler**

In `message-handler.ts`, remove the `broadcastToAll({ type: "conversation_ready", ... })` block (around lines 609-612).

- [ ] **Step 2: Remove conversation_ready from protocol types**

In `ws/protocol.ts`, remove:

```typescript
| { type: "conversation_ready"; conversationId: string }
```

- [ ] **Step 3: Remove conversation_ready handler from frontend**

In `public/js/app.js`, remove the `case "conversation_ready"` block (lines 1589-1603).

- [ ] **Step 4: Remove duplicate `conversation_created` broadcasts from message-handler**

Now that `chat:conversation_created` App event broadcasts to all WS clients (Task 2), the message-handler's direct `broadcastToAll({ type: "conversation_created", ... })` calls create duplicates. Remove them:

- `/new` handler (around line 359): remove `broadcastToAll({ type: "conversation_created", ... })`
- Normal message path (around line 462): remove `broadcastToAll({ type: "conversation_created", ... })`

Both conversations are created via `app.conversations.create()` which emits `conversation:created` → StatePublisher already handles the conversation list update. The `chat:conversation_created` event handles the detailed broadcast.

- [ ] **Step 5: Handle new channel conversations**

When a channel message creates a new conversation (channel switch), the `chat:conversation_created` App event broadcasts it. The frontend's existing `conversation_created` handler should handle this — verify it switches to the new conversation and subscribes.

Check: does the frontend's `conversation_created` handler call `switchConversation()`? If not, add:

```javascript
case "conversation_created":
  // Add to conversation list
  // ...existing logic...
  // If this is the current conversation (server marked it current), switch to it
  if (data.conversation.status === "current") {
    this.switchConversation(data.conversation.id);
  }
  break;
```

- [ ] **Step 6: Type check + test**

```bash
cd packages/dashboard && npx tsc --noEmit
npx vitest run tests/
```

Commit: `"refactor(channels): remove conversation_ready, use App event streaming"`

---

## Task 5: Fix Broken Tests

**Files:**
- Modify: `packages/dashboard/tests/e2e/conversation-initiator-routing.test.ts`
- Modify: `packages/dashboard/tests/unit/notifications/source-channel.test.ts`

6 tests broken since S1 — mocks use old `SessionFactory` API.

- [ ] **Step 1: Fix conversation-initiator-routing.test.ts (5 tests)**

The test imports `SessionFactory` and mocks `injectSystemTurn()` / `streamNewConversation()`. S1 changed ConversationInitiator to use `ChatServiceLike` with `sendSystemMessage()`.

Replace the mock setup (lines 33-47):

```typescript
// BEFORE:
sessionFactory = {
  async *injectSystemTurn(_convId: string, _prompt: string) {
    yield { type: "text", text: "Hey, here is an update!" };
  },
  async *streamNewConversation(_convId: string, _prompt?: string) {
    yield { type: "text", text: "Hello, I have news for you." };
  },
  isStreaming(_convId: string): boolean { return false; },
  async queueNotification(_convId: string, _prompt: string): Promise<void> {},
};

// AFTER:
const chatService = {
  async *sendSystemMessage(_convId: string, _prompt: string, _turn: number) {
    yield { type: "text_delta" as const, text: "Hello, I have news for you." };
  },
};
```

Update the constructor call (line 64-69):

```typescript
// BEFORE:
initiator = new ConversationInitiator({
  conversationManager,
  sessionFactory,
  channelManager,
  getOutboundChannel: () => "whatsapp",
});

// AFTER:
initiator = new ConversationInitiator({
  conversationManager,
  chatService,
  channelManager,
  getOutboundChannel: () => "whatsapp",
});
```

Update imports to use `ChatServiceLike` instead of `SessionFactory`.

Verify: the test assertions check `conv.externalParty`, `turns[].channel`, and `getByExternalParty()` — these should still work since the underlying ConversationManager is real (not mocked).

- [ ] **Step 2: Fix source-channel.test.ts (1 test)**

Read the test to understand what it expects. The failure is "dashboard-sourced + alert fails -> stays in queue, no initiate()." S1 simplified the heartbeat — the attempt counting and escalation logic was removed. The test expects old behavior.

Update the test to match the S1 heartbeat behavior: `alert()` always succeeds (there's always a current conversation), so the "alert fails" scenario only happens when no conversations exist at all.

- [ ] **Step 3: Run all tests**

```bash
cd packages/dashboard && npx vitest run tests/
```

Expected: All 6 previously-failing tests now pass. No new regressions.

Commit: `"fix(tests): update mocks for S1 ChatServiceLike + heartbeat simplification"`

---

## Task 6: App Event Consistency Sweep

**Files:**
- Modify: `packages/dashboard/src/channels/message-handler.ts`
- Modify: `packages/dashboard/src/app.ts`
- Modify: `packages/dashboard/src/app-events.ts`
- Modify: `packages/dashboard/src/conversations/abbreviation.ts`
- Modify: `packages/dashboard/src/automations/automation-processor.ts`
- Modify: `packages/dashboard/src/channels/external-store.ts`

Audit found 5 state mutation paths that bypass App events — direct DB writes + direct WS broadcasts. Fix all of them.

- [ ] **Step 1: Route `unpin()` through App in message-handler**

In `message-handler.ts`, two locations (lines 302 and 318) call `conversationManager.unpin()` directly and broadcast `conversation_unpinned` manually. Replace with:

```typescript
// BEFORE (line 302):
await this.deps.conversationManager.unpin(existingConversation.id);
this.deps.connectionRegistry.broadcastToAll({
  type: "conversation_unpinned",
  conversationId: existingConversation.id,
});

// AFTER:
await this.deps.app.conversations.unpin(existingConversation.id);
```

Same change at line 318. `AppConversationService.unpin()` already emits `conversation:updated` → StatePublisher refreshes the conversation list. The separate `conversation_unpinned` broadcast type may still be needed for the frontend — check if `app.js` handles it. If so, emit it as an App event or keep as a direct broadcast from the App wrapper.

- [ ] **Step 2: Route `setModel()` through App in message-handler**

In `message-handler.ts` (line 422), the `/model` command calls `conversationManager.setModel()` directly. Replace:

```typescript
// BEFORE:
await this.deps.conversationManager.setModel(existingConversation.id, newModelId);

// AFTER:
await this.deps.app.chat.setModel(existingConversation.id, newModelId);
```

Also: `AppChatService.setModel()` (chat-service.ts line 331) doesn't emit `conversation:updated`. Add:

```typescript
async setModel(conversationId: string, model: string): Promise<void> {
  // ...existing validation...
  await this.conversationManager.setModel(conversationId, model);
  this.app.emit("conversation:updated", conversationId);
}
```

- [ ] **Step 3: Replace AbbreviationQueue bespoke callback with App event**

In `abbreviation.ts` (line 245), after renaming a conversation, it calls `this.onRenamed?.(conversationId, result.title)` which is wired to `connectionRegistry.broadcastToAll` in chat-handler.ts (line 49). This is a parallel notification system.

Replace with App event emission. The AbbreviationQueue needs an App reference:

```typescript
// In abbreviation.ts constructor, add app parameter
constructor(private manager: ConversationManager, private app: App) {}

// Replace onRenamed callback (line 245) with:
this.app.emit("conversation:updated", conversationId);
```

Then remove the `onRenamed` callback wiring in `chat-handler.ts` (lines 47-55). The `conversation_renamed` WS message type is still useful for the frontend (it carries the new title) — emit it from the `conversation:updated` subscriber in StatePublisher, or keep the dedicated broadcast but source it from the App event.

**Note:** Evaluate whether the `onRenamed` callback is also used elsewhere before removing. If `AbbreviationQueue` is only instantiated once, safe to remove.

- [ ] **Step 4: Emit `job:started` from AutomationProcessor**

In `automation-processor.ts`, `executeAndDeliver()` creates a job (line 87, emits `job:created`) then executes. But the status transition to `"running"` happens inside the executor without emitting `job:started`. Similarly, `resume()` (line 141) sets status to `"running"` but doesn't emit.

Add after `updateJob` calls:

```typescript
// In executeAndDeliver(), after createJob (line 88):
this.config.onJobEvent?.("job:created", job);
// The job starts running immediately — emit job:started too:
const startedJob = this.config.jobService.updateJob(job.id, { status: "running" });
this.config.onJobEvent?.("job:started", startedJob);

// In resume(), after updateJob (line 141):
this.config.jobService.updateJob(job.id, { status: "running" });
this.config.onJobEvent?.("job:started", { ...job, status: "running" });
```

Note: `job:started` is already defined in `AppEventMap` (line 48) and subscribed in `StatePublisher` — this just makes it actually fire.

- [ ] **Step 5: Add `external_message:created` event for ExternalMessageStore**

In `app-events.ts`, add:

```typescript
// External messages (stored for S3 trust tier)
"external_message:created": [message: { id: string; channelId: string; from: string; content: string }];
```

In `message-handler.ts`, after `this.externalStore.storeMessage(...)` (line 629-637), emit:

```typescript
this.deps.app.emit("external_message:created", {
  id: msg.id,
  channelId,
  from: msg.from,
  content: msg.content,
});
```

This has no subscriber yet (no dashboard UI for external messages), but establishes the pattern for when the S3 trust tier UI arrives. No broadcast wiring needed — just the event emission.

- [ ] **Step 6: Type check + test**

```bash
cd packages/dashboard && npx tsc --noEmit
npx vitest run tests/
```

Commit: `"refactor: route all state mutations through App events"`

---

## Task 7: Verification

- [ ] **Step 1: Full test suite**

```bash
cd packages/dashboard && npx vitest run tests/
```

Zero failures.

- [ ] **Step 2: Build clean**

```bash
cd packages/core && npx tsc
cd packages/dashboard && npx tsc
```

- [ ] **Step 3: Restart dashboard**

```bash
systemctl --user restart nina-dashboard.service
journalctl --user -u nina-dashboard.service --since "1 min ago" --no-pager
```

- [ ] **Step 4: HITL — Dashboard message streams in real-time**

1. Open dashboard in browser
2. Send a message
3. Verify: response streams token-by-token (text_delta events)
4. Open a second tab — verify it also sees the streaming
5. Verify: no duplicate `conversation_created` messages in WS devtools

- [ ] **Step 5: HITL — Channel message streams to dashboard**

1. Send a WhatsApp message to Nina
2. Watch the dashboard — verify: user message appears, then response streams in real-time (not a full reload after completion)
3. Verify: WhatsApp receives the reply
4. Verify: no duplicate conversation entries in sidebar

- [ ] **Step 6: HITL — alert() streams to dashboard**

1. Trigger a delegation (ask Nina to research something)
2. Wait for the worker to complete
3. Verify: the heartbeat alert response streams into the dashboard in real-time (text_delta tokens visible, not just a done refresh)

- [ ] **Step 7: HITL — Job progress card shows "running" state**

1. Fire an automation from the dashboard
2. Verify: job card shows "running" status (not jumping from "pending" to "completed")
3. This confirms `job:started` event is now emitting

- [ ] **Step 8: Record results + commit**

Commit: `"docs: M9.4-S2.5 verification complete"`
