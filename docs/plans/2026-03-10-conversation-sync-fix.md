# Conversation Active State Sync — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the active conversation state server-authoritative — all connected clients sync via WebSocket, including after channel switches and reconnects.

**Architecture:** The `StatePublisher` already broadcasts `state:conversations` with full conversation lists including `status`. The fix wires this into: (1) the channel message-handler (WhatsApp), (2) `makeCurrent()` calls, and (3) the frontend `currentConversationId`. The `state:conversations` message becomes the single source of truth — any client receiving it updates both its widget list AND its active conversation pointer.

**Tech Stack:** TypeScript (Fastify backend), Alpine.js (frontend), WebSocket

---

## Pitfalls

1. **Don't duplicate state management.** The `conversations` Alpine store already holds the list. The `currentConversationId` is in the app component. Don't create a third source — derive `currentConversationId` from the store's `status: "current"` entry.
2. **Avoid UI flash.** When a WhatsApp message makes the web conversation inactive, the chat panel should NOT clear or switch — the user keeps seeing their conversation, it's just no longer "current" on the server. The chat panel shows whatever conversation is loaded, independently of which one is "current."
3. **Race with `_pendingNewConversation`.** When the web client initiates a new chat, `_pendingNewConversation` is set true, and the `conversation_created` event switches the UI. The `state:conversations` broadcast arrives ~100ms later (debounced). Don't let the state broadcast fight with the event-driven switch.
4. **`publishConversations()` needs `statePublisher` reference.** The channel message-handler doesn't have access to `fastify.statePublisher`. Pass it through deps or use the existing pattern from chat-handler.

---

## Task 1: Backend — Broadcast state on channel-triggered conversation changes

When a WhatsApp (or any channel) message creates a new conversation or changes the current one, broadcast the updated conversation list to all WebSocket clients.

**Files:**
- Modify: `packages/dashboard/src/channels/message-handler.ts`
- Reference: `packages/dashboard/src/state/state-publisher.ts`

### Steps

- [ ] **Step 1: Add statePublisher to ChannelMessageHandler deps**

In `message-handler.ts`, the `deps` object is passed to the constructor. Add an optional `statePublisher` field:

```typescript
// In the deps type/interface (near line 53)
statePublisher?: { publishConversations: () => void } | null;
```

- [ ] **Step 2: Call publishConversations after conversation creation**

After the `conversation_created` broadcast (around line 415), add:

```typescript
// Broadcast updated conversation state to all clients
this.deps.statePublisher?.publishConversations();
```

Also after the `/new` command's `conversation_created` broadcast (around line 316):

```typescript
this.deps.statePublisher?.publishConversations();
```

- [ ] **Step 3: Call publishConversations after channel-switch unpin**

After the `conversation_unpinned` broadcast in the channel-switch block (around line 264):

```typescript
// State will be published after the new conversation is created below
```

Actually, the `publishConversations()` after `create()` at line 415 already covers this — `create()` demotes the old conversation and inserts the new one, so the broadcast after create captures both changes. No extra call needed here.

- [ ] **Step 4: Wire statePublisher into message-handler construction**

Find where `ChannelMessageHandler` is constructed in `index.ts` and pass `statePublisher`:

```typescript
statePublisher: server.statePublisher ?? null,
```

- [ ] **Step 5: Also broadcast on makeCurrent from chat-handler**

In `chat-handler.ts`, `handleSwitchConversation` calls `makeCurrent()` (line 664) but doesn't broadcast the state. Add after line 664:

```typescript
fastify.statePublisher?.publishConversations();
```

- [ ] **Step 6: Verify TypeScript compiles**

```bash
cd packages/dashboard && npx tsc --noEmit
```

- [ ] **Step 7: Commit**

```bash
git add packages/dashboard/src/channels/message-handler.ts packages/dashboard/src/index.ts packages/dashboard/src/ws/chat-handler.ts
git commit -m "fix(conversations): broadcast state on channel-triggered conversation changes"
```

---

## Task 2: Frontend — Derive active conversation from server state

Make the frontend update `currentConversationId` when `state:conversations` arrives, so all clients stay in sync with the server.

**Files:**
- Modify: `packages/dashboard/public/js/ws-client.js` (lines 79-83)
- Modify: `packages/dashboard/public/js/app.js` (lines 1383-1386)

### Steps

- [ ] **Step 1: Update ws-client.js to extract currentConversationId from state**

In `ws-client.js`, the `state:conversations` handler (line 79-83) currently only updates `Alpine.store("conversations").items`. Add extraction of the current conversation:

```javascript
case "state:conversations":
  if (Alpine.store("conversations")) {
    Alpine.store("conversations").items = data.conversations || [];
    // Extract the server's current conversation ID
    const current = (data.conversations || []).find(c => c.status === "current");
    Alpine.store("conversations").serverCurrentId = current ? current.id : null;
  }
  break;
```

- [ ] **Step 2: Initialize the store field**

Find where `Alpine.store("conversations")` is initialized (in `app.js` or `index.html`) and add `serverCurrentId: null`.

- [ ] **Step 3: Update app.js to react to serverCurrentId changes**

In `app.js`, the `state:conversations` case (lines 1383-1386) says "silently handled." Replace it to also update the conversations list:

```javascript
case "state:conversations": {
  // Update the widget's conversation list from server state
  const serverConvs = data.conversations || [];
  this.conversations = serverConvs.filter(
    (c) => c.channel === "web" || !c.isPinned,
  );
  break;
}
```

- [ ] **Step 4: Add an Alpine effect to sync currentConversationId**

In the app's `init()` method, add an effect that watches the store's `serverCurrentId` and updates `currentConversationId` when the server changes it (but NOT when this client just changed it):

```javascript
// Sync active conversation from server state
Alpine.effect(() => {
  const serverId = Alpine.store("conversations").serverCurrentId;
  if (serverId === null || serverId === undefined) return;
  // If the server's current differs from ours, and we didn't just create a new conversation,
  // update our pointer. Don't switch the chat panel — just update the data model.
  if (serverId !== this.currentConversationId && !this._pendingNewConversation) {
    this.currentConversationId = serverId;
  }
});
```

Wait — per pitfall #2, we should NOT switch what the chat panel shows. The user may be typing in their web conversation. The server says the WhatsApp conversation is now "current," but the web user should keep chatting in their conversation.

Let me reconsider. The `currentConversationId` in the app controls what the chat panel shows. If we change it, the chat panel switches — bad UX if the user is mid-conversation.

**Revised approach:** The widget should update (show correct active indicators), but the chat panel stays on whatever conversation the user loaded. The `currentConversationId` should remain local to the chat panel (what the user is viewing), while the widget uses the store's data (including status) for rendering.

- [ ] **Step 4 (revised): Update widget rendering to use store status**

The Conversations widget already filters `c.id !== currentConversationId && c.turnCount > 0`. The `currentConversationId` here means "what I'm viewing in the chat panel." This is correct — the widget should exclude the chat panel's conversation, regardless of server status.

The key fix is: the widget's conversation list should refresh from the store, which already happens via the `state:conversations` → `Alpine.store("conversations").items` pipeline. The widget just needs to use the store as its data source.

Check: does the widget already read from the store, or from a local `conversations` property?

- [ ] **Step 5: Verify the widget reads from the store**

Check how the Conversations widget gets its data. If it reads from `this.conversations` (app-level), it won't see store updates. If it reads from `$store.conversations.items`, it will.

If it reads from `this.conversations`, add an Alpine effect to sync:

```javascript
Alpine.effect(() => {
  const items = Alpine.store("conversations").items;
  if (items && items.length >= 0) {
    this.conversations = items;
  }
});
```

- [ ] **Step 6: Run prettier**

```bash
cd packages/dashboard && npx prettier --write public/js/ws-client.js public/js/app.js
```

- [ ] **Step 7: Verify TypeScript (backend) still compiles**

```bash
cd packages/dashboard && npx tsc --noEmit
```

- [ ] **Step 8: Commit**

```bash
git add packages/dashboard/public/js/ws-client.js packages/dashboard/public/js/app.js
git commit -m "fix(dashboard): sync conversation widget from server state via WebSocket"
```

---

## Task 3: Reconnect sync — server sends state on WebSocket connect

Ensure that when a client reconnects (after disconnect, page reload, etc.), it receives the current conversation state immediately.

**Files:**
- Reference: `packages/dashboard/src/state/state-publisher.ts` (publishAllTo, line 181)
- Modify: `packages/dashboard/src/ws/chat-handler.ts` (connection setup)

### Steps

- [ ] **Step 1: Verify publishAllTo is called on WebSocket connect**

Check that `statePublisher.publishAllTo(socket)` is called when a new WebSocket connection is established. This should already happen — verify in `chat-handler.ts` or the WebSocket setup.

- [ ] **Step 2: Verify state:conversations is included in publishAllTo**

`publishAllTo` (line 218-247) already sends `state:conversations`. Verify it includes the `status` field in each conversation object. ✓ It does (line 237).

- [ ] **Step 3: Test reconnect scenario**

1. Open dashboard in browser
2. Send a WhatsApp message (creates new conversation, triggers state broadcast)
3. Verify widget updates
4. Refresh the page
5. Verify widget still shows correct state after reload

- [ ] **Step 4: Commit (if any changes needed)**

```bash
git commit -m "fix(dashboard): verify reconnect sync for conversation state"
```

---

## Task 4: Browser verification

**Files:** None (testing only)

### Steps

- [ ] **Step 1: Restart dashboard**

```bash
systemctl --user restart nina-dashboard
```

- [ ] **Step 2: Open two browser windows**

Both pointing to the dashboard.

- [ ] **Step 3: Send a WhatsApp message**

Verify both browser windows update their Conversations widget to show the new WhatsApp conversation.

- [ ] **Step 4: Click "New chat" in one window**

Verify the other window's widget updates.

- [ ] **Step 5: Resume a conversation in one window**

Verify the other window reflects the change.

- [ ] **Step 6: Disconnect one window's network briefly**

Reconnect and verify it syncs to the correct state.

---

## Task 5: Commit and push

- [ ] **Step 1: Run full test suite**

```bash
cd packages/dashboard && npx vitest run && npx tsc --noEmit
```

- [ ] **Step 2: Run prettier**

```bash
cd packages/dashboard && npx prettier --write src/ public/
```

- [ ] **Step 3: Final commit if needed**

- [ ] **Step 4: Push**

```bash
git push origin master
```
