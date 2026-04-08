# M9.4-S1: Real-Time Notification Delivery — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route `alert()`, `initiate()`, and ResponseWatchdog through `app.chat` so brain responses broadcast to WebSocket clients in real-time, and separate channel decision (web vs WhatsApp) from conversation lookup.

**Architecture:** Replace `SessionFactory.injectSystemTurn()` / `streamNewConversation()` direct calls with a new `app.chat.sendSystemMessage()` method that streams brain responses through the App event pipeline without saving a user turn. The ConversationInitiator switches from `getActiveConversation(threshold)` to `getCurrent()` + `getLastWebMessageAge()` for the channel decision.

**Tech Stack:** TypeScript, Vitest, better-sqlite3, Claude Agent SDK

**Design spec:** `docs/superpowers/specs/2026-04-08-conversation-ux-ui-design.md`

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `packages/dashboard/src/chat/send-system-message.ts` | `sendSystemMessage()` — inject system prompt, stream brain response, save assistant turn, emit events |
| Modify | `packages/dashboard/src/chat/chat-service.ts` | Wire `sendSystemMessage()` into `AppChatService` |
| Modify | `packages/dashboard/src/chat/types.ts` | Add `SystemMessageOptions` type |
| Modify | `packages/dashboard/src/chat/index.ts` | Re-export new module |
| Modify | `packages/dashboard/src/agent/conversation-initiator.ts` | Refactor `alert()` + `initiate()` to use `app.chat`, add `getLastWebMessageAge()` |
| Modify | `packages/dashboard/src/app.ts` | Refactor ResponseWatchdog `injectRecovery`, update `onAlertDelivered` |
| Modify | `packages/dashboard/src/automations/heartbeat-service.ts` | Simplify delivery logic |
| Modify | `packages/dashboard/src/conversations/db.ts` | Remove `getActiveConversation()` |
| Modify | `packages/dashboard/src/conversations/manager.ts` | Remove `getActiveConversation()` wrapper |
| Modify | `packages/dashboard/tests/conversation-initiator.test.ts` | Rewrite tests for new behavior |
| Create | `packages/dashboard/tests/unit/chat/send-system-message.test.ts` | Unit tests for `sendSystemMessage()` |
| Create | `packages/dashboard/tests/integration/notification-delivery.test.ts` | E2E smoke test |

---

## Task 1: Add `sendSystemMessage()` to ChatService

This is the core new method — streams a brain response from a system prompt injection without saving a user turn. Unlike `sendMessage()`, it doesn't create user turns, handle attachments, or do skill expansion. It just injects a system prompt into an existing session, streams the response, saves the assistant turn, and emits events.

**Files:**
- Create: `packages/dashboard/src/chat/send-system-message.ts`
- Modify: `packages/dashboard/src/chat/types.ts`
- Modify: `packages/dashboard/src/chat/chat-service.ts`
- Modify: `packages/dashboard/src/chat/index.ts`

- [ ] **Step 1: Add SystemMessageOptions type**

In `packages/dashboard/src/chat/types.ts`, add after the `ChatMessageOptions` interface (after line 69):

```typescript
/**
 * Options for system-initiated messages (alert, initiate, watchdog recovery).
 * Unlike ChatMessageOptions, no attachments/audio — just brain invocation.
 */
export interface SystemMessageOptions {
  /** Channel to stamp on the assistant turn (for channel-aware conversations) */
  channel?: string;
}
```

- [ ] **Step 2: Run type check to confirm no errors**

Run: `cd /home/nina/my_agent/packages/dashboard && npx tsc --noEmit`
Expected: No new errors

- [ ] **Step 3: Create `sendSystemMessage()` implementation**

Create `packages/dashboard/src/chat/send-system-message.ts`:

```typescript
/**
 * System Message — inject a system prompt into an existing conversation's
 * brain session, stream the response, save it, and emit App events.
 *
 * Unlike sendMessage(), this does NOT:
 * - Save a user turn (the system prompt is ephemeral)
 * - Handle attachments, STT, skill expansion
 * - Auto-create conversations
 *
 * It DOES:
 * - Get/create an SDK session for the conversation
 * - Inject the prompt via SessionManager.injectSystemTurn()
 * - Yield ChatEvent stream (text_delta, done)
 * - Save the assistant response turn
 * - Persist SDK session ID
 * - Emit chat:done App event
 */

import type { ConversationManager } from "../conversations/manager.js";
import type { SessionRegistry } from "../agent/session-registry.js";
import type { TranscriptTurn } from "../conversations/types.js";
import type { ChatEvent, SystemMessageOptions } from "./types.js";
import type { App } from "../app.js";

export async function* sendSystemMessage(
  app: App,
  conversationId: string,
  prompt: string,
  turnNumber: number,
  options?: SystemMessageOptions,
): AsyncGenerator<ChatEvent> {
  const conversationManager = app.conversationManager;
  const sessionRegistry = app.sessionRegistry;

  // Get or create session
  const storedSid = conversationManager
    .getConversationDb()
    .getSdkSessionId(conversationId);
  const sessionManager = await sessionRegistry.getOrCreate(
    conversationId,
    storedSid,
  );

  // If session is busy, skip (caller handles this — e.g. queue notification)
  if (sessionManager.isStreaming()) {
    console.log(
      `[sendSystemMessage] Session busy for ${conversationId}, skipping`,
    );
    return;
  }

  yield { type: "start" as const };

  let assistantContent = "";

  try {
    for await (const event of sessionManager.injectSystemTurn(prompt)) {
      if (event.type === "text_delta" && event.text) {
        assistantContent += event.text;
        yield { type: "text_delta" as const, text: event.text };
      }
    }

    // Save assistant response (not the system prompt)
    if (assistantContent) {
      const assistantTurn: TranscriptTurn = {
        type: "turn",
        role: "assistant",
        content: assistantContent,
        timestamp: new Date().toISOString(),
        turnNumber,
        channel: options?.channel,
      };

      await conversationManager.appendTurn(conversationId, assistantTurn);
    }

    // Persist SDK session ID
    const sdkSid = sessionManager.getSessionId();
    if (sdkSid) {
      conversationManager
        .getConversationDb()
        .updateSdkSessionId(conversationId, sdkSid);
    }

    yield { type: "done" as const };

    // Emit App event — triggers StatePublisher broadcast to WS clients
    app.emit("chat:done", conversationId, undefined, undefined);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[sendSystemMessage] Error:", err);
    yield { type: "error" as const, message };
  }
}
```

- [ ] **Step 4: Wire into AppChatService**

In `packages/dashboard/src/chat/chat-service.ts`, add import at the top (after existing imports):

```typescript
import { sendSystemMessage } from "./send-system-message.js";
```

Then add method to `AppChatService` class (after the `sendMessage` method, around line 850):

```typescript
  /**
   * Inject a system prompt into an existing conversation's brain session.
   * Streams the response and saves the assistant turn.
   * Does NOT save a user turn — the system prompt is ephemeral.
   */
  async *sendSystemMessage(
    conversationId: string,
    prompt: string,
    turnNumber: number,
    options?: SystemMessageOptions,
  ): AsyncGenerator<ChatEvent> {
    yield* sendSystemMessage(
      this.app,
      conversationId,
      prompt,
      turnNumber,
      options,
    );
  }
```

- [ ] **Step 5: Update exports**

In `packages/dashboard/src/chat/index.ts`, add:

```typescript
export { sendSystemMessage } from "./send-system-message.js";
```

- [ ] **Step 6: Run type check**

Run: `cd /home/nina/my_agent/packages/dashboard && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add packages/dashboard/src/chat/send-system-message.ts packages/dashboard/src/chat/types.ts packages/dashboard/src/chat/chat-service.ts packages/dashboard/src/chat/index.ts
git commit -m "feat(chat): add sendSystemMessage() for system-initiated brain invocations

Routes system prompts through the App event pipeline (session management,
turn persistence, SDK session ID, chat:done event) without saving a user
turn. Used by alert(), initiate(), and ResponseWatchdog."
```

---

## Task 2: Add `getLastWebMessageAge()` helper

Private method on ConversationInitiator that reads recent turns to find the most recent web-channel user message and returns its age in minutes.

**Files:**
- Modify: `packages/dashboard/src/agent/conversation-initiator.ts`

- [ ] **Step 1: Add the helper method**

In `packages/dashboard/src/agent/conversation-initiator.ts`, add after the `trySendViaChannel()` method (before the closing `}` of the class, after line 306):

```typescript
  /**
   * Get the age (in minutes) of the most recent user message on the web channel.
   * Returns null if no web user messages exist in the conversation.
   *
   * Web messages are identified by having no `channel` field or `channel === 'web'`.
   */
  private async getLastWebMessageAge(
    conversationId: string,
  ): Promise<number | null> {
    const SEARCH_DEPTH = 50;
    const recentTurns = await this.conversationManager.getRecentTurns(
      conversationId,
      SEARCH_DEPTH,
    );

    // Find the most recent user turn from web (no channel = web, or channel === 'web')
    const lastWebUserTurn = recentTurns
      .filter(
        (t) =>
          t.role === "user" && (!t.channel || t.channel === "web"),
      )
      .at(-1); // getRecentTurns returns oldest-first, so last = most recent

    if (!lastWebUserTurn) return null;

    const ageMs = Date.now() - new Date(lastWebUserTurn.timestamp).getTime();
    return ageMs / (60 * 1000);
  }
```

- [ ] **Step 2: Run type check**

Run: `cd /home/nina/my_agent/packages/dashboard && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/dashboard/src/agent/conversation-initiator.ts
git commit -m "feat(initiator): add getLastWebMessageAge() helper

Returns minutes since last web-channel user message. Used to separate
channel decision (web vs WhatsApp) from conversation lookup."
```

---

## Task 3: Refactor `alert()` to use `app.chat` + `getCurrent()`

Replace `getActiveConversation(threshold)` with `getCurrent()` + web recency check. Route brain invocation through `app.chat.sendSystemMessage()`.

**Files:**
- Modify: `packages/dashboard/src/agent/conversation-initiator.ts`

- [ ] **Step 1: Update ConversationInitiatorOptions to accept app.chat**

Replace the `sessionFactory` dependency with `chatService` (the `AppChatService` instance). In `conversation-initiator.ts`, update the options interface and imports:

Replace the `SessionFactory` interface and `ConversationInitiatorOptions` (lines 18-65):

```typescript
import type { ConversationManager } from "../conversations/manager.js";
import type { Conversation } from "../conversations/types.js";
import type { ChatEvent, SystemMessageOptions } from "../chat/types.js";

/**
 * Minimal chat service interface for system-initiated brain invocation.
 */
export interface ChatServiceLike {
  sendSystemMessage(
    conversationId: string,
    prompt: string,
    turnNumber: number,
    options?: SystemMessageOptions,
  ): AsyncGenerator<ChatEvent>;
}

/**
 * Minimal transport manager interface for sending messages.
 */
export interface TransportManagerLike {
  send(
    transportId: string,
    to: string,
    message: { content: string },
  ): Promise<void>;
  getTransportConfig(id: string): { ownerJid?: string } | undefined;
  getTransportInfos(): Array<{
    id: string;
    plugin?: string;
    statusDetail?: { connected: boolean };
  }>;
}

export interface ConversationInitiatorOptions {
  conversationManager: ConversationManager;
  chatService: ChatServiceLike;
  channelManager: TransportManagerLike;
  getOutboundChannel: () => string;
  activityThresholdMinutes?: number;
}
```

- [ ] **Step 2: Update constructor and class fields**

Replace the constructor and fields (lines 69-83):

```typescript
export class ConversationInitiator {
  private conversationManager: ConversationManager;
  private chatService: ChatServiceLike;
  private channelManager: TransportManagerLike;
  private getOutboundChannel: () => string;
  private thresholdMinutes: number;

  constructor(options: ConversationInitiatorOptions) {
    this.conversationManager = options.conversationManager;
    this.chatService = options.chatService;
    this.channelManager = options.channelManager;
    this.getOutboundChannel = options.getOutboundChannel;
    this.thresholdMinutes =
      options.activityThresholdMinutes ?? DEFAULT_THRESHOLD_MINUTES;
  }
```

- [ ] **Step 3: Rewrite `alert()` method**

Replace the entire `alert()` method (lines 98-177):

```typescript
  /**
   * Deliver a system notification to the current conversation.
   *
   * Always finds the current conversation (there's always one, unless fresh install).
   * Uses web recency to decide delivery channel:
   * - Last web message < threshold: deliver via web (app.chat broadcasts to WS clients)
   * - Last web message > threshold: deliver via preferred channel (WhatsApp)
   *
   * Channel switches (web→WhatsApp) trigger a new conversation per the asymmetric rule.
   *
   * Returns true if delivered, false only if no current conversation exists.
   */
  async alert(
    prompt: string,
    options?: { sourceChannel?: string },
  ): Promise<boolean> {
    const current = await this.conversationManager.getCurrent();
    if (!current) {
      console.warn(
        "[ConversationInitiator] alert() — no current conversation exists",
      );
      return false;
    }

    // Channel decision: is the user on the web?
    const webAge = await this.getLastWebMessageAge(current.id);
    const useWeb = webAge !== null && webAge < this.thresholdMinutes;

    // Dashboard-sourced actions always stay on web — never route to WhatsApp
    const isDashboardSourced = options?.sourceChannel === "dashboard";

    if (useWeb || isDashboardSourced) {
      // Deliver via app.chat — broadcasts to all WS clients automatically
      let response = "";
      for await (const event of this.chatService.sendSystemMessage(
        current.id,
        prompt,
        (current.turnCount ?? 0) + 1,
      )) {
        if (event.type === "text_delta" && event.text) {
          response += event.text;
        }
      }
      return true;
    }

    // User not on web — deliver via preferred channel
    const outboundChannel = this.getOutboundChannel();
    if (!outboundChannel || outboundChannel === "web") {
      // Web-only user, but they haven't messaged recently. Still deliver via web.
      let response = "";
      for await (const event of this.chatService.sendSystemMessage(
        current.id,
        prompt,
        (current.turnCount ?? 0) + 1,
      )) {
        if (event.type === "text_delta" && event.text) {
          response += event.text;
        }
      }
      return true;
    }

    // Check if this is a channel switch (web→WhatsApp)
    const currentChannel = current.channel ?? "web";
    const needsNewConversation = currentChannel !== outboundChannel;

    if (needsNewConversation) {
      // Channel switch: create new conversation on preferred channel
      await this.initiate({ firstTurnPrompt: `[SYSTEM: ${prompt}]` });
    } else {
      // Same channel: continue current conversation via app.chat
      let response = "";
      for await (const event of this.chatService.sendSystemMessage(
        current.id,
        prompt,
        (current.turnCount ?? 0) + 1,
        { channel: outboundChannel },
      )) {
        if (event.type === "text_delta" && event.text) {
          response += event.text;
        }
      }
      // Forward to external channel
      await this.trySendViaChannel(response, outboundChannel);
    }

    return true;
  }
```

- [ ] **Step 4: Run type check**

Run: `cd /home/nina/my_agent/packages/dashboard && npx tsc --noEmit`
Expected: Errors related to `sessionFactory` usage in `initiate()` and in `app.ts` wiring — those are fixed in Tasks 4 and 5.

- [ ] **Step 5: Commit**

```bash
git add packages/dashboard/src/agent/conversation-initiator.ts
git commit -m "refactor(initiator): alert() uses getCurrent() + app.chat

Replaces getActiveConversation(threshold) with getCurrent() — there's
always a current conversation. Channel decision (web vs WhatsApp) uses
getLastWebMessageAge() instead of baking the threshold into the query.
Brain invocation routes through app.chat.sendSystemMessage()."
```

---

## Task 4: Refactor `initiate()` to use `app.chat`

Route the brain's first turn through `app.chat.sendSystemMessage()` instead of `sessionFactory.streamNewConversation()`.

**Files:**
- Modify: `packages/dashboard/src/agent/conversation-initiator.ts`

- [ ] **Step 1: Rewrite `initiate()` method**

Replace the entire `initiate()` method (lines 184-222):

```typescript
  /**
   * Start a new conversation on the preferred outbound channel.
   * Falls back silently to web if the channel is unavailable.
   * The conversation agent speaks first — no user turn needed.
   */
  async initiate(options?: {
    firstTurnPrompt?: string;
  }): Promise<Conversation> {
    // Resolve outbound channel info so the conversation is reply-matchable
    const { ownerJid, resolvedChannelId } = this.resolveOutboundInfo();

    const conv = await this.conversationManager.create({
      externalParty: ownerJid ?? undefined,
    });

    // Brain speaks first via app.chat — broadcasts to WS clients
    const prompt =
      options?.firstTurnPrompt ||
      "[SYSTEM: You are reaching out to the user proactively. You are the conversation layer — explain briefly why you're messaging them. If you don't have a specific reason, let them know you're available.]";

    let response = "";
    for await (const event of this.chatService.sendSystemMessage(
      conv.id,
      prompt,
      1,
      { channel: resolvedChannelId ?? undefined },
    )) {
      if (event.type === "text_delta" && event.text) {
        response += event.text;
      }
    }

    // Forward to external channel if applicable
    if (response && resolvedChannelId) {
      await this.trySendViaChannel(response);
    }

    return conv;
  }
```

- [ ] **Step 2: Remove the `SessionFactory` interface entirely**

The `SessionFactory` interface (lines 18-36 in the original file) is no longer needed. It was already replaced by `ChatServiceLike` in Task 3. Verify it's fully removed.

- [ ] **Step 3: Run type check**

Run: `cd /home/nina/my_agent/packages/dashboard && npx tsc --noEmit`
Expected: Errors in `app.ts` where ConversationInitiator is constructed with old options — fixed in Task 5.

- [ ] **Step 4: Commit**

```bash
git add packages/dashboard/src/agent/conversation-initiator.ts
git commit -m "refactor(initiator): initiate() uses app.chat.sendSystemMessage

Brain's first turn routes through app.chat event pipeline. Removes
dependency on SessionFactory.streamNewConversation()."
```

---

## Task 5: Update `app.ts` wiring — ConversationInitiator + ResponseWatchdog

Update the ConversationInitiator construction to pass `chatService` instead of `sessionFactory`. Refactor the ResponseWatchdog `injectRecovery` to use `app.chat.sendSystemMessage()`. Update `onAlertDelivered` to use `getCurrent()`.

**Files:**
- Modify: `packages/dashboard/src/app.ts`

- [ ] **Step 1: Find and update ConversationInitiator construction**

Search for where `ConversationInitiator` is instantiated in `app.ts` and update to pass `chatService` instead of `sessionFactory`:

```typescript
app.conversationInitiator = new ConversationInitiator({
  conversationManager: app.conversationManager,
  chatService: app.chat,
  channelManager: app.transportManager!,
  getOutboundChannel: () => /* existing logic */,
  activityThresholdMinutes: 15,
});
```

The exact location needs to be found — search for `new ConversationInitiator` in `app.ts`.

- [ ] **Step 2: Refactor `injectRecovery` in ResponseWatchdog**

Replace the `injectRecovery` callback (lines 740-793) with:

```typescript
injectRecovery: async (conversationId, prompt, options) => {
  let response = "";
  for await (const event of app.chat.sendSystemMessage(
    conversationId,
    prompt,
    ((await app.conversationManager.get(conversationId))?.turnCount ?? 0) + 1,
  )) {
    if (event.type === "text_delta" && event.text) {
      response += event.text;
    }
  }

  // Send via outbound channel if available — but not for dashboard-originated messages
  if (response && options?.source !== "dashboard") {
    const ci = app.conversationInitiator;
    if (ci) {
      await (ci as any).trySendViaChannel(response);
    }
  }

  console.log(
    `[ResponseWatchdog] Recovery for ${conversationId}: ${response.length} chars`,
  );
  return response || null;
},
```

This removes:
- Direct `sessionRegistry.getOrCreate()` call
- Direct `sm.injectSystemTurn()` call
- Manual `conversationManager.appendTurn()` call
- Manual `connectionRegistry.broadcastToConversation()` call

All of that is now handled by `sendSystemMessage()`.

- [ ] **Step 3: Update `onAlertDelivered` callback**

Replace the `onAlertDelivered` callback (lines 1281-1290) to use `getCurrent()`:

```typescript
onAlertDelivered: () => {
  const current = app.conversationManager
    .getConversationDb()
    .getCurrent();
  if (current?.id && recentAutomationAlerts) {
    recentAutomationAlerts.set(current.id, Date.now());
  }
},
```

- [ ] **Step 4: Update mount_failure handler**

The `watchTriggerService` mount_failure handler (lines 1668-1681) calls `alert()` then falls back to `initiate()`. With the new `alert()` that always succeeds, simplify:

```typescript
watchTriggerService.on("mount_failure", async ({ path, attempts }) => {
  if (app.conversationInitiator) {
    const prompt = `A filesystem watch on "${path}" has failed after ${attempts} retry attempts. The mount may be down.\n\nYou are the conversation layer — let the user know about this infrastructure issue briefly. Don't be dramatic, just inform them so they can check if needed.`;
    await app.conversationInitiator.alert(prompt, {
      sourceChannel: "dashboard",
    });
  }
});
```

- [ ] **Step 5: Run type check**

Run: `cd /home/nina/my_agent/packages/dashboard && npx tsc --noEmit`
Expected: PASS (or errors only in test files)

- [ ] **Step 6: Commit**

```bash
git add packages/dashboard/src/app.ts
git commit -m "refactor(app): wire ConversationInitiator + ResponseWatchdog through app.chat

ConversationInitiator receives chatService instead of sessionFactory.
ResponseWatchdog injectRecovery uses sendSystemMessage() — removes
manual session/broadcast/turn management. onAlertDelivered uses getCurrent()."
```

---

## Task 6: Simplify heartbeat

With the corrected `alert()` that always finds a current conversation and handles channel routing internally, the heartbeat's delivery logic simplifies dramatically. No more dashboard-vs-channel branching, no more attempt counting for channel escalation.

**Files:**
- Modify: `packages/dashboard/src/automations/heartbeat-service.ts`

- [ ] **Step 1: Simplify `deliverPendingNotifications()`**

Replace the `deliverPendingNotifications()` method (lines 116-186):

```typescript
  private async deliverPendingNotifications(): Promise<void> {
    if (!this.config.conversationInitiator) return;

    const pending = this.config.notificationQueue.listPending();
    for (const notification of pending) {
      try {
        const prompt = this.formatNotification(notification);
        const delivered =
          await this.config.conversationInitiator.alert(prompt, {
            sourceChannel: notification.source_channel,
          });

        if (delivered) {
          this.config.notificationQueue.markDelivered(notification._filename!);
        } else {
          // No current conversation at all (fresh install edge case).
          // Fall back to initiate().
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
        this.config.notificationQueue.incrementAttempts(
          notification._filename!,
        );
      }
    }
  }
```

- [ ] **Step 2: Remove `MAX_DELIVERY_ATTEMPTS` constant**

Delete line 114: `private static readonly MAX_DELIVERY_ATTEMPTS = 20;`

- [ ] **Step 3: Run type check**

Run: `cd /home/nina/my_agent/packages/dashboard && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/dashboard/src/automations/heartbeat-service.ts
git commit -m "simplify(heartbeat): remove attempt counting and escalation logic

alert() now always finds the current conversation and handles channel
routing internally. The heartbeat just calls alert(), marks delivered,
and falls back to initiate() only when no conversation exists at all."
```

---

## Task 7: Deprecate `getActiveConversation()`

Remove the method from db.ts and manager.ts. All callers have been migrated to `getCurrent()`.

**Files:**
- Modify: `packages/dashboard/src/conversations/db.ts`
- Modify: `packages/dashboard/src/conversations/manager.ts`
- Modify: `packages/dashboard/src/ws/connection-registry.ts` (if it uses getActiveConversation — verify; its `getActiveConversations` is a different method)

- [ ] **Step 1: Verify no remaining callers**

Run: `grep -rn 'getActiveConversation' packages/dashboard/src/ --include='*.ts'`

Expected callers: only `db.ts` (definition) and `manager.ts` (wrapper). If `app.ts` still references it, those should have been updated in Task 5.

- [ ] **Step 2: Remove from `db.ts`**

Delete the `getActiveConversation()` method (lines 526-541 in `packages/dashboard/src/conversations/db.ts`):

```typescript
// DELETE THIS ENTIRE METHOD:
getActiveConversation(thresholdMinutes: number): Conversation | null {
  // ...
}
```

- [ ] **Step 3: Remove from `manager.ts`**

Delete the `getActiveConversation()` method (lines 133-137 in `packages/dashboard/src/conversations/manager.ts`):

```typescript
// DELETE THIS ENTIRE METHOD:
async getActiveConversation(
  thresholdMinutes: number = 15,
): Promise<Conversation | null> {
  return this.db.getActiveConversation(thresholdMinutes);
}
```

- [ ] **Step 4: Run type check**

Run: `cd /home/nina/my_agent/packages/dashboard && npx tsc --noEmit`
Expected: PASS — if any callers remain, fix them.

- [ ] **Step 5: Commit**

```bash
git add packages/dashboard/src/conversations/db.ts packages/dashboard/src/conversations/manager.ts
git commit -m "refactor(conversations): remove deprecated getActiveConversation()

All callers migrated to getCurrent() + getLastWebMessageAge().
The threshold no longer gates conversation lookup — only channel decision."
```

---

## Task 8: Unit tests — `sendSystemMessage()`

**Files:**
- Create: `packages/dashboard/tests/unit/chat/send-system-message.test.ts`

- [ ] **Step 1: Write the test file**

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { sendSystemMessage } from "../../../src/chat/send-system-message.js";
import type { ChatEvent } from "../../../src/chat/types.js";

// Minimal App mock — only the parts sendSystemMessage touches
function createMockApp(options?: {
  isStreaming?: boolean;
  response?: string;
  sessionId?: string;
}) {
  const response = options?.response ?? "Brain response";
  const appendedTurns: Array<{ id: string; turn: any }> = [];
  const emittedEvents: Array<{ event: string; args: any[] }> = [];
  let storedSdkSessionId: string | null = null;

  const mockSessionManager = {
    isStreaming: () => options?.isStreaming ?? false,
    async *injectSystemTurn(_prompt: string) {
      yield { type: "text_delta" as const, text: response };
    },
    getSessionId: () => options?.sessionId ?? "sdk-123",
  };

  return {
    app: {
      conversationManager: {
        getConversationDb: () => ({
          getSdkSessionId: (_id: string) => null,
          updateSdkSessionId: (_id: string, sid: string | null) => {
            storedSdkSessionId = sid;
          },
        }),
        appendTurn: async (id: string, turn: any) => {
          appendedTurns.push({ id, turn });
        },
      },
      sessionRegistry: {
        getOrCreate: async () => mockSessionManager,
      },
      emit: (event: string, ...args: any[]) => {
        emittedEvents.push({ event, args });
      },
    } as any,
    appendedTurns,
    emittedEvents,
    getStoredSdkSessionId: () => storedSdkSessionId,
  };
}

async function collectEvents(
  gen: AsyncGenerator<ChatEvent>,
): Promise<ChatEvent[]> {
  const events: ChatEvent[] = [];
  for await (const event of gen) {
    events.push(event);
  }
  return events;
}

describe("sendSystemMessage()", () => {
  it("streams brain response and yields ChatEvents", async () => {
    const { app } = createMockApp({ response: "Hello from brain" });
    const events = await collectEvents(
      sendSystemMessage(app, "conv-1", "test prompt", 3),
    );

    expect(events[0].type).toBe("start");
    expect(events[1]).toEqual({ type: "text_delta", text: "Hello from brain" });
    expect(events[2].type).toBe("done");
  });

  it("saves assistant turn with correct turnNumber and channel", async () => {
    const { app, appendedTurns } = createMockApp({ response: "Response" });
    await collectEvents(
      sendSystemMessage(app, "conv-1", "prompt", 5, { channel: "whatsapp" }),
    );

    expect(appendedTurns).toHaveLength(1);
    expect(appendedTurns[0].id).toBe("conv-1");
    expect(appendedTurns[0].turn.role).toBe("assistant");
    expect(appendedTurns[0].turn.content).toBe("Response");
    expect(appendedTurns[0].turn.turnNumber).toBe(5);
    expect(appendedTurns[0].turn.channel).toBe("whatsapp");
  });

  it("does not save turn when brain returns empty response", async () => {
    const { app, appendedTurns } = createMockApp({ response: "" });
    await collectEvents(
      sendSystemMessage(app, "conv-1", "prompt", 1),
    );

    expect(appendedTurns).toHaveLength(0);
  });

  it("persists SDK session ID", async () => {
    const { app, getStoredSdkSessionId } = createMockApp({
      sessionId: "sdk-456",
    });
    await collectEvents(
      sendSystemMessage(app, "conv-1", "prompt", 1),
    );

    expect(getStoredSdkSessionId()).toBe("sdk-456");
  });

  it("emits chat:done App event", async () => {
    const { app, emittedEvents } = createMockApp();
    await collectEvents(
      sendSystemMessage(app, "conv-1", "prompt", 1),
    );

    expect(emittedEvents).toHaveLength(1);
    expect(emittedEvents[0].event).toBe("chat:done");
    expect(emittedEvents[0].args[0]).toBe("conv-1");
  });

  it("skips when session is busy streaming", async () => {
    const { app, appendedTurns, emittedEvents } = createMockApp({
      isStreaming: true,
    });
    const events = await collectEvents(
      sendSystemMessage(app, "conv-1", "prompt", 1),
    );

    expect(events).toHaveLength(0);
    expect(appendedTurns).toHaveLength(0);
    expect(emittedEvents).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the tests**

Run: `cd /home/nina/my_agent/packages/dashboard && npx vitest run tests/unit/chat/send-system-message.test.ts`
Expected: All 6 tests PASS

- [ ] **Step 3: Commit**

```bash
git add packages/dashboard/tests/unit/chat/send-system-message.test.ts
git commit -m "test(chat): unit tests for sendSystemMessage()

Covers: event streaming, turn persistence, empty response, SDK session ID,
chat:done event emission, session-busy skip."
```

---

## Task 9: Rewrite conversation-initiator tests

The existing tests use `getActiveConversation()` and mock `SessionFactory`. Rewrite to test the new behavior: `getCurrent()` + web recency + `ChatServiceLike`.

**Files:**
- Modify: `packages/dashboard/tests/conversation-initiator.test.ts`

- [ ] **Step 1: Update mock factories**

Replace `createMockSessionFactory()` (lines 163-183) with a mock `ChatServiceLike`:

```typescript
function createMockChatService(
  response: string = "Good morning!",
): ChatServiceLike & { calls: Array<{ conversationId: string; prompt: string; turnNumber: number }> } {
  const calls: Array<{ conversationId: string; prompt: string; turnNumber: number }> = [];
  return {
    calls,
    async *sendSystemMessage(
      conversationId: string,
      prompt: string,
      turnNumber: number,
    ): AsyncGenerator<ChatEvent> {
      calls.push({ conversationId, prompt, turnNumber });
      yield { type: "start" };
      yield { type: "text_delta", text: response };
      yield { type: "done" };
    },
  };
}
```

Update imports at the top:

```typescript
import {
  ConversationInitiator,
  type ChatServiceLike,
  type TransportManagerLike,
} from "../src/agent/conversation-initiator.js";
import type { ChatEvent } from "../src/chat/types.js";
```

- [ ] **Step 2: Rewrite Task 3 tests for getCurrent()**

Replace the "Task 3: getActiveConversation()" describe block (lines 93-159) with tests for `getCurrent()`:

```typescript
describe("Task 3: getCurrent() replaces getActiveConversation()", () => {
  let manager: ConversationManager;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "conv-initiator-"));
    fs.mkdirSync(path.join(tmpDir, "conversations"), { recursive: true });
    manager = new ConversationManager(tmpDir);
  });

  afterEach(() => {
    manager.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns the current conversation regardless of user message age", async () => {
    const conv = await manager.create();
    // Add a 20-min-old user message — getCurrent() should still find it
    const oldTime = new Date(Date.now() - 20 * 60 * 1000);
    await manager.appendTurn(conv.id, {
      type: "turn",
      role: "user",
      content: "old message",
      timestamp: oldTime.toISOString(),
      turnNumber: 1,
    });

    const current = await manager.getCurrent();
    expect(current).not.toBeNull();
    expect(current!.id).toBe(conv.id);
  });

  it("returns null when no conversations exist", async () => {
    const current = await manager.getCurrent();
    expect(current).toBeNull();
  });
});
```

- [ ] **Step 3: Rewrite Task 5 alert() tests**

Replace the alert() describe block (lines 222-343) with tests for new behavior:

```typescript
describe("alert()", () => {
  it("delivers via app.chat when user has recent web message", async () => {
    const conv = await manager.create();
    await manager.appendTurn(conv.id, {
      type: "turn",
      role: "user",
      content: "Hello",
      timestamp: new Date().toISOString(),
      turnNumber: 1,
      // no channel = web
    });

    const chatService = createMockChatService("Morning brief ready!");
    const channelManager = createMockChannelManager(false);
    const initiator = new ConversationInitiator({
      conversationManager: manager,
      chatService,
      channelManager,
      getOutboundChannel: () => "web",
    });

    const result = await initiator.alert("Morning brief is due.");
    expect(result).toBe(true);
    expect(chatService.calls).toHaveLength(1);
    expect(chatService.calls[0].conversationId).toBe(conv.id);
  });

  it("returns true even when last web message is stale (>15 min)", async () => {
    const conv = await manager.create();
    const oldTime = new Date(Date.now() - 20 * 60 * 1000);
    await manager.appendTurn(conv.id, {
      type: "turn",
      role: "user",
      content: "Old message",
      timestamp: oldTime.toISOString(),
      turnNumber: 1,
    });

    const chatService = createMockChatService();
    const channelManager = createMockChannelManager(false);
    const initiator = new ConversationInitiator({
      conversationManager: manager,
      chatService,
      channelManager,
      getOutboundChannel: () => "web",
    });

    const result = await initiator.alert("Morning brief is due.");
    expect(result).toBe(true);
    // Still delivers via web since outbound channel is web
  });

  it("returns false when no current conversation exists", async () => {
    // Don't create any conversation
    const chatService = createMockChatService();
    const channelManager = createMockChannelManager();
    const initiator = new ConversationInitiator({
      conversationManager: manager,
      chatService,
      channelManager,
      getOutboundChannel: () => "whatsapp",
    });

    const result = await initiator.alert("Morning brief is due.");
    expect(result).toBe(false);
  });

  it("dashboard-sourced alerts never route to WhatsApp", async () => {
    const conv = await manager.create();
    // Stale web message — normally would route to WhatsApp
    const oldTime = new Date(Date.now() - 20 * 60 * 1000);
    await manager.appendTurn(conv.id, {
      type: "turn",
      role: "user",
      content: "Old message",
      timestamp: oldTime.toISOString(),
      turnNumber: 1,
    });

    const chatService = createMockChatService();
    const channelManager = createMockChannelManager(true);
    const initiator = new ConversationInitiator({
      conversationManager: manager,
      chatService,
      channelManager,
      getOutboundChannel: () => "whatsapp",
    });

    const result = await initiator.alert("test prompt", {
      sourceChannel: "dashboard",
    });
    expect(result).toBe(true);
    expect(channelManager.sent).toHaveLength(0); // no WhatsApp send
    expect(chatService.calls).toHaveLength(1); // delivered via web
  });
});
```

- [ ] **Step 4: Rewrite initiate() and integration tests**

Update the initiate() tests and daily brief integration tests to use `chatService` instead of `sessionFactory`:

```typescript
describe("initiate()", () => {
  it("creates new conversation and invokes brain via app.chat", async () => {
    const chatService = createMockChatService("Good morning!");
    const channelManager = createMockChannelManager(false);
    const initiator = new ConversationInitiator({
      conversationManager: manager,
      chatService,
      channelManager,
      getOutboundChannel: () => "web",
    });

    const conv = await initiator.initiate();
    expect(conv).toBeTruthy();
    expect(conv.id).toMatch(/^conv-/);
    expect(chatService.calls).toHaveLength(1);
    expect(chatService.calls[0].conversationId).toBe(conv.id);
    expect(chatService.calls[0].turnNumber).toBe(1);
  });

  it("sends via preferred channel when connected", async () => {
    const chatService = createMockChatService("Good morning!");
    const channelManager = createMockChannelManager(true);
    const initiator = new ConversationInitiator({
      conversationManager: manager,
      chatService,
      channelManager,
      getOutboundChannel: () => "whatsapp",
    });

    await initiator.initiate();
    expect(channelManager.sent).toHaveLength(1);
    expect(channelManager.sent[0].content).toBe("Good morning!");
  });

  it("demotes existing current conversation", async () => {
    const existing = await manager.create();
    expect(existing.status).toBe("current");

    const chatService = createMockChatService("Good morning!");
    const channelManager = createMockChannelManager(false);
    const initiator = new ConversationInitiator({
      conversationManager: manager,
      chatService,
      channelManager,
      getOutboundChannel: () => "web",
    });

    const newConv = await initiator.initiate();
    expect(newConv.id).not.toBe(existing.id);

    const old = await manager.get(existing.id);
    expect(old!.status).toBe("inactive");
  });
});

describe("alert() — channel routing", () => {
  it("routes to WhatsApp when web message is stale and preferred channel is whatsapp", async () => {
    const conv = await manager.create();
    const oldTime = new Date(Date.now() - 20 * 60 * 1000);
    await manager.appendTurn(conv.id, {
      type: "turn",
      role: "user",
      content: "Old web message",
      timestamp: oldTime.toISOString(),
      turnNumber: 1,
      // no channel = web
    });

    const chatService = createMockChatService("Notification delivered");
    const channelManager = createMockChannelManager(true);
    const initiator = new ConversationInitiator({
      conversationManager: manager,
      chatService,
      channelManager,
      getOutboundChannel: () => "whatsapp",
    });

    const result = await initiator.alert("Task completed.");
    expect(result).toBe(true);
    // Should send via WhatsApp since web is stale
    expect(channelManager.sent).toHaveLength(1);
  });

  it("starts new conversation on channel switch (web→WhatsApp)", async () => {
    const conv = await manager.create();
    // Conv is on web (no channel), but user hasn't messaged recently
    const oldTime = new Date(Date.now() - 20 * 60 * 1000);
    await manager.appendTurn(conv.id, {
      type: "turn",
      role: "user",
      content: "Old web message",
      timestamp: oldTime.toISOString(),
      turnNumber: 1,
    });

    const chatService = createMockChatService("Starting new conv");
    const channelManager = createMockChannelManager(true);
    const initiator = new ConversationInitiator({
      conversationManager: manager,
      chatService,
      channelManager,
      getOutboundChannel: () => "whatsapp",
    });

    const result = await initiator.alert("Task completed.");
    expect(result).toBe(true);
    // Channel switch should create new conversation via initiate()
    // chatService should have been called (for the new conversation)
    expect(chatService.calls.length).toBeGreaterThanOrEqual(1);
  });

  it("continues current conversation when same channel (WhatsApp→WhatsApp)", async () => {
    const conv = await manager.create();
    await manager.appendTurn(conv.id, {
      type: "turn",
      role: "user",
      content: "WhatsApp message",
      timestamp: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
      turnNumber: 1,
      channel: "whatsapp",
    });

    const chatService = createMockChatService("Continued");
    const channelManager = createMockChannelManager(true);
    const initiator = new ConversationInitiator({
      conversationManager: manager,
      chatService,
      channelManager,
      getOutboundChannel: () => "whatsapp",
    });

    const result = await initiator.alert("Task completed.");
    expect(result).toBe(true);
    // Should continue in current conv (no new conversation)
    expect(chatService.calls).toHaveLength(1);
    expect(chatService.calls[0].conversationId).toBe(conv.id);
  });
});

describe("getLastWebMessageAge() (tested via alert() behavior)", () => {
  it("returns web recency for recent web message", async () => {
    const conv = await manager.create();
    // Recent web message (< 15 min)
    await manager.appendTurn(conv.id, {
      type: "turn",
      role: "user",
      content: "Just now",
      timestamp: new Date().toISOString(),
      turnNumber: 1,
    });

    const chatService = createMockChatService("Response");
    const channelManager = createMockChannelManager(true);
    const initiator = new ConversationInitiator({
      conversationManager: manager,
      chatService,
      channelManager,
      getOutboundChannel: () => "whatsapp",
    });

    const result = await initiator.alert("test");
    expect(result).toBe(true);
    // Recent web message = deliver via web, no WhatsApp
    expect(channelManager.sent).toHaveLength(0);
  });

  it("returns null when no web messages exist (only channel messages)", async () => {
    const conv = await manager.create();
    await manager.appendTurn(conv.id, {
      type: "turn",
      role: "user",
      content: "WhatsApp only",
      timestamp: new Date().toISOString(),
      turnNumber: 1,
      channel: "whatsapp",
    });

    const chatService = createMockChatService("Response");
    const channelManager = createMockChannelManager(true);
    const initiator = new ConversationInitiator({
      conversationManager: manager,
      chatService,
      channelManager,
      getOutboundChannel: () => "whatsapp",
    });

    const result = await initiator.alert("test");
    expect(result).toBe(true);
    // No web messages = not on web, so route to WhatsApp
    expect(channelManager.sent).toHaveLength(1);
  });
});

describe("daily brief integration flow", () => {
  it("alert() always succeeds when a conversation exists (no initiate fallback needed)", async () => {
    const conv = await manager.create();
    await manager.appendTurn(conv.id, {
      type: "turn",
      role: "user",
      content: "I'm here",
      timestamp: new Date().toISOString(),
      turnNumber: 1,
    });

    const chatService = createMockChatService("Brief is ready, shall we?");
    const channelManager = createMockChannelManager(false);
    const initiator = new ConversationInitiator({
      conversationManager: manager,
      chatService,
      channelManager,
      getOutboundChannel: () => "web",
    });

    const alerted = await initiator.alert("Morning brief ready.");
    expect(alerted).toBe(true);
    expect(chatService.calls).toHaveLength(1);
  });
});
```

- [ ] **Step 5: Run all tests**

Run: `cd /home/nina/my_agent/packages/dashboard && npx vitest run tests/conversation-initiator.test.ts`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add packages/dashboard/tests/conversation-initiator.test.ts
git commit -m "test(initiator): rewrite tests for getCurrent() + app.chat

Tests now verify: alert() always finds current conversation, web recency
governs channel choice, dashboard-sourced alerts stay on web, initiate()
routes through chatService."
```

---

## Task 10: E2E smoke test — notification delivery pipeline

One end-to-end test proving the full notification delivery path works: system message → brain response → turn saved → App event emitted.

**Files:**
- Create: `packages/dashboard/tests/integration/notification-delivery.test.ts`

- [ ] **Step 1: Write the E2E test**

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { AppHarness } from "../../src/testing/app-harness.js";

describe("E2E: Notification delivery via app.chat", () => {
  let harness: AppHarness;

  beforeEach(async () => {
    harness = await AppHarness.create();
  });

  afterEach(async () => {
    await harness.cleanup();
  });

  it("alert() delivers brain response and emits events", async () => {
    const app = harness.app;

    // 1. Create a conversation (becomes current)
    const conv = await app.conversations.create();
    expect(conv.status).toBe("current");

    // 2. Send a user message via app.chat (establishes web recency)
    const events: Array<{ type: string }> = [];
    for await (const event of app.chat.sendMessage(
      conv.id,
      "Hello, I'm here",
      1,
    )) {
      events.push(event);
    }
    expect(events.some((e) => e.type === "done")).toBe(true);

    // 3. Track App events
    const chatDoneEvents: string[] = [];
    app.on("chat:done", (convId: string) => {
      chatDoneEvents.push(convId);
    });

    // 4. Call alert() with a test prompt
    const ci = app.conversationInitiator;
    expect(ci).not.toBeNull();

    const delivered = await ci!.alert(
      "A working agent completed a task. Results: test passed.\n\nYou are the conversation layer — present what matters to the user naturally.",
    );
    expect(delivered).toBe(true);

    // 5. Assert: chat:done event was emitted
    expect(chatDoneEvents).toContain(conv.id);

    // 6. Assert: conversation has the new assistant turn in transcript
    const turns = await app.conversationManager.getTurns(conv.id);
    // At least: user turn + assistant response from sendMessage + assistant from alert
    expect(turns.length).toBeGreaterThanOrEqual(3);
    const lastTurn = turns[turns.length - 1];
    expect(lastTurn.role).toBe("assistant");
    expect(lastTurn.content.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run the E2E test**

Run: `cd /home/nina/my_agent/packages/dashboard && npx vitest run tests/integration/notification-delivery.test.ts`
Expected: PASS

Note: This test requires `AppHarness` which creates a real App instance with mock SDK sessions. If `AppHarness` doesn't support ConversationInitiator setup, the test may need adjustment — check `AppHarness.create()` to verify it wires up the initiator.

- [ ] **Step 3: Commit**

```bash
git add packages/dashboard/tests/integration/notification-delivery.test.ts
git commit -m "test(e2e): notification delivery pipeline smoke test

Proves: alert() → sendSystemMessage() → brain response → turn saved →
chat:done event emitted. Uses AppHarness for full App lifecycle."
```

---

## Task 11: Manual verification

Restart the dashboard and verify notification delivery works end-to-end in the real system.

- [ ] **Step 1: Build**

```bash
cd /home/nina/my_agent/packages/core && npx tsc
cd /home/nina/my_agent/packages/dashboard && npx tsc
```

- [ ] **Step 2: Restart dashboard**

```bash
systemctl --user restart nina-dashboard.service
```

- [ ] **Step 3: Check logs for errors**

```bash
journalctl --user -u nina-dashboard.service --since "1 min ago" --no-pager
```

Expected: No errors related to ConversationInitiator, sendSystemMessage, or heartbeat.

- [ ] **Step 4: Verify heartbeat runs**

Watch logs for 60 seconds to confirm heartbeat ticks without errors:

```bash
journalctl --user -u nina-dashboard.service -f | grep -i heartbeat
```

Expected: `[Heartbeat] Started` and periodic tick logs without errors.
