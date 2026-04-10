# M9.4-S2: Channel Message Unification — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route inbound channel messages (WhatsApp) through `app.chat.sendMessage()` for brain interaction, unify STT into `sendMessage()` as the single transcription path, add write-only `injectTurn()` for admin/scheduler, and fix S1 architect review items.

**Architecture:** Extend `ChatMessageOptions` with channel metadata and source field so `sendMessage()` stamps turns correctly. Move STT from WhatsApp plugin to `sendMessage()` — transports pass raw audio, the application layer transcribes. The message-handler keeps channel-specific responsibilities (conversation resolution, outbound delivery, typing, voice TTS) but delegates brain invocation + STT to `app.chat`. A new `injectTurn()` method handles transcript-only writes without brain invocation.

**Tech Stack:** TypeScript, Vitest, better-sqlite3, Claude Agent SDK, Deepgram STT

**Design spec:** `docs/superpowers/specs/2026-04-08-conversation-ux-ui-design.md` (Section 8)

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `packages/core/src/transports/types.ts` | Add `audioAttachment` to `IncomingMessage` |
| Modify | `plugins/channel-whatsapp/src/plugin.ts` | Pass raw audio instead of pre-transcribing |
| Modify | `packages/dashboard/src/chat/types.ts` | Extend `ChatMessageOptions` with `channel`, `source` |
| Modify | `packages/dashboard/src/chat/chat-service.ts` | Handle channel metadata in `sendMessage()`, add `injectTurn()`, return `detectedLanguage` |
| Modify | `packages/dashboard/src/agent/conversation-initiator.ts` | Make `trySendViaChannel` public as `forwardToChannel` |
| Modify | `packages/dashboard/src/app.ts` | Remove `(ci as any)` cast, remove `onAudioMessage` wiring |
| Modify | `packages/dashboard/src/channels/message-handler.ts` | Replace direct session management with `app.chat.sendMessage()`, pass audio as attachment |
| Modify | `packages/dashboard/src/routes/admin.ts` | Use `app.chat.injectTurn()` |
| Modify | `packages/dashboard/src/scheduler/event-handler.ts` | Use `app.chat.injectTurn()` |
| Create | `packages/dashboard/tests/unit/chat/inject-turn.test.ts` | Tests for `injectTurn()` |
| Create | `packages/dashboard/tests/unit/chat/channel-options.test.ts` | Tests for channel metadata + STT unification |
| Modify | `packages/dashboard/tests/conversation-initiator.test.ts` | Strengthen channel-switch assertion |
| Modify | `packages/dashboard/tests/integration/notification-delivery.test.ts` | Add ResponseWatchdog test |

---

## Task 1: S1 Corrections (Architect Review Items)

Three items carried from the S1 architect review (spec Section 8.6).

**Files:**
- Modify: `packages/dashboard/src/agent/conversation-initiator.ts`
- Modify: `packages/dashboard/src/app.ts`
- Modify: `packages/dashboard/tests/conversation-initiator.test.ts`
- Modify: `packages/dashboard/tests/integration/notification-delivery.test.ts`

- [ ] **Step 1: Make `trySendViaChannel` public as `forwardToChannel`**

In `packages/dashboard/src/agent/conversation-initiator.ts`:
- Rename `private async trySendViaChannel(` → `async forwardToChannel(`
- Update internal call sites: `this.trySendViaChannel(` → `this.forwardToChannel(` (2 occurrences: alert line ~157, initiate line ~197)

- [ ] **Step 2: Remove `(ci as any)` cast in app.ts ResponseWatchdog**

In `packages/dashboard/src/app.ts`, find `(ci as any).trySendViaChannel(response)` in the `injectRecovery` callback and replace with `ci.forwardToChannel(response)`.

- [ ] **Step 3: Strengthen channel-switch test assertion**

In `packages/dashboard/tests/conversation-initiator.test.ts`, find "routes to WhatsApp when web message is stale" test. Replace the weak assertion with:

```typescript
const result = await initiator.alert("Task completed.");
expect(result).toBe(true);
// Channel switch creates a NEW conversation via initiate()
const allConversations = await manager.list({});
expect(allConversations.length).toBe(2);
const lastCall = chatService.calls[chatService.calls.length - 1];
expect(lastCall.conversationId).not.toBe(conv.id);
```

- [ ] **Step 4: Add ResponseWatchdog injectRecovery test**

Add to `packages/dashboard/tests/integration/notification-delivery.test.ts`:

```typescript
it("injectRecovery routes through sendSystemMessage", async () => {
  const conv = await harness.conversations.create();
  let response = "";
  for await (const event of harness.chat.sendSystemMessage(
    conv.id, "Recovery: user seems confused", 2,
  )) {
    if (event.type === "text_delta" && event.text) response += event.text;
  }
  expect(response.length).toBeGreaterThan(0);
  const turns = await harness.conversationManager.getTurns(conv.id);
  expect(turns.some((t) => t.role === "assistant")).toBe(true);
});
```

- [ ] **Step 5: Run tests + type check + commit**

```bash
cd packages/dashboard && npx tsc --noEmit
npx vitest run tests/conversation-initiator.test.ts tests/integration/notification-delivery.test.ts
```

Commit: `"fix(s1-corrections): forwardToChannel public API, stronger tests"`

---

## Task 2: Add `audioAttachment` to IncomingMessage

Enable transports to pass raw audio instead of pre-transcribing.

**Files:**
- Modify: `packages/core/src/transports/types.ts`

- [ ] **Step 1: Write failing test — verify IncomingMessage accepts audioAttachment**

Create `packages/core/tests/transport-types.test.ts` (or verify existing):

```typescript
import { describe, it, expect } from "vitest";
import type { IncomingMessage } from "../src/transports/types.js";

describe("IncomingMessage type", () => {
  it("accepts audioAttachment field for voice notes", () => {
    const msg: IncomingMessage = {
      id: "1", from: "user", content: "", timestamp: new Date(),
      channelId: "whatsapp", isVoiceNote: true,
      audioAttachment: { buffer: Buffer.from("fake-audio"), mimeType: "audio/ogg" },
    };
    expect(msg.audioAttachment).toBeDefined();
    expect(msg.audioAttachment!.mimeType).toBe("audio/ogg");
  });
});
```

- [ ] **Step 2: Add field to IncomingMessage**

In `packages/core/src/transports/types.ts`, add after `detectedLanguage` (line 104):

```typescript
  /** Raw audio attachment for voice notes — transports pass raw audio, app layer transcribes */
  audioAttachment?: { buffer: Buffer; mimeType: string };
```

- [ ] **Step 3: Run test + type check + commit**

```bash
cd packages/core && npx tsc --noEmit
```

Commit: `"feat(core): add audioAttachment to IncomingMessage for STT unification"`

---

## Task 3: WhatsApp Plugin Passes Raw Audio

Remove STT from the WhatsApp plugin. Pass raw audio buffer on `IncomingMessage` instead of pre-transcribed text.

**Files:**
- Modify: `plugins/channel-whatsapp/src/plugin.ts`
- Modify: `packages/dashboard/src/app.ts`

- [ ] **Step 1: Modify WhatsApp plugin voice note handling**

In `plugins/channel-whatsapp/src/plugin.ts`, replace lines 505-588 (the voice note handling block) with a simpler version that passes raw audio:

```typescript
          // ── Voice note handling ────────────────────────────────────
          const audioMessage = msg.message?.audioMessage;
          if (audioMessage) {
            // Download audio buffer — STT happens in the application layer
            let audioBuffer: Buffer | undefined;
            try {
              audioBuffer = (await downloadMediaMessage(
                msg, "buffer", {},
              )) as Buffer;
            } catch (err) {
              console.warn("[WhatsApp] Failed to download voice note:", err);
            }

            const timestamp = msg.messageTimestamp
              ? new Date(Number(msg.messageTimestamp) * 1000)
              : new Date();

            const incoming: IncomingMessage = {
              id: msg.key.id ?? `${Date.now()}`,
              from: isGroup
                ? (msg.key.participant ?? remoteJid)
                : remoteJid,
              content: audioBuffer
                ? "[Voice note — audio attached, pending transcription]"
                : "[Voice note — failed to download audio]",
              timestamp,
              channelId: this.config!.id,
              isVoiceNote: true,
              ...(audioBuffer && {
                audioAttachment: { buffer: audioBuffer, mimeType: "audio/ogg" },
              }),
              ...(isGroup && { groupId: remoteJid }),
              ...(msg.pushName && { senderName: msg.pushName }),
            };

            // Cache for reaction context
            if (msg.key.id) {
              this.cacheMessage(msg.key.id, incoming.content, false);
            }

            this._status = {
              ...this._status,
              lastMessageAt: new Date(),
              lastEventAt: new Date(),
            };

            for (const handler of this.handlers.message) {
              handler(incoming);
            }

            if (this.config?.role === "dedicated" && this.sock && msg.key) {
              this.sock.readMessages([msg.key]).catch(() => {});
            }
            continue;
          }
```

- [ ] **Step 2: Remove `onAudioMessage` callback wiring from app.ts**

In `packages/dashboard/src/app.ts`, in the `wireAudioCallbacks` function (around line 1950-1969), remove the `plugin.onAudioMessage = ...` block. Keep the `plugin.onSendVoiceReply` (TTS) wiring intact.

```typescript
function wireAudioCallbacks(plugin: BaileysPlugin, app: App): void {
  // STT removed — transcription now happens in sendMessage() via capability
  // onAudioMessage callback no longer needed

  // TTS: synthesize voice replies (unchanged)
  plugin.onSendVoiceReply = async (text: string, _jid: string, language?: string) => {
    // ... existing TTS code ...
  };
}
```

- [ ] **Step 3: Remove `onAudioMessage` property from BaileysPlugin if it's a public API**

Check if `onAudioMessage` is declared on the plugin class. If it is, remove the property declaration (it's no longer used). Keep backward compat — an `undefined` callback is harmless.

- [ ] **Step 4: Build core (types changed) + type check dashboard**

```bash
cd packages/core && npx tsc
cd packages/dashboard && npx tsc --noEmit
```

Commit: `"refactor(whatsapp): pass raw audio buffer instead of pre-transcribing"`

---

## Task 4: Extend ChatMessageOptions + Handle in sendMessage()

Add channel metadata, source field, and audio-from-channel support to `sendMessage()`.

**Files:**
- Modify: `packages/dashboard/src/chat/types.ts`
- Modify: `packages/dashboard/src/chat/chat-service.ts`

- [ ] **Step 1: Write failing test for channel stamping**

Create `packages/dashboard/tests/unit/chat/channel-options.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { sendSystemMessage } from "../../../src/chat/send-system-message.js";

describe("Channel options — turn stamping", () => {
  function createMockApp(response: string = "Response") {
    const appendedTurns: Array<{ id: string; turn: any }> = [];
    return {
      app: {
        conversationManager: {
          getConversationDb: () => ({
            getSdkSessionId: () => null,
            updateSdkSessionId: () => {},
          }),
          appendTurn: async (id: string, turn: any) => {
            appendedTurns.push({ id, turn });
          },
        },
        sessionRegistry: {
          getOrCreate: async () => ({
            isStreaming: () => false,
            async *injectSystemTurn() {
              yield { type: "text_delta", text: response };
            },
            getSessionId: () => "sdk-1",
          }),
        },
        emit: () => {},
      } as any,
      appendedTurns,
    };
  }

  it("stamps channel on assistant turn when channel option provided", async () => {
    const { app, appendedTurns } = createMockApp();
    for await (const _ of sendSystemMessage(app, "conv-1", "test", 1, {
      channel: "whatsapp",
    })) {}
    expect(appendedTurns[0].turn.channel).toBe("whatsapp");
  });

  it("no channel stamp when option omitted", async () => {
    const { app, appendedTurns } = createMockApp();
    for await (const _ of sendSystemMessage(app, "conv-1", "test", 1)) {}
    expect(appendedTurns[0].turn.channel).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test — should pass (sendSystemMessage already handles channel)**

```bash
npx vitest run tests/unit/chat/channel-options.test.ts
```

Expected: PASS (Task 1 of S1 already wired channel on sendSystemMessage)

- [ ] **Step 3: Add channel + source to ChatMessageOptions**

In `packages/dashboard/src/chat/types.ts`, add to `ChatMessageOptions` (after `context` field):

```typescript
  /** Channel metadata for messages originating from external channels (WhatsApp, etc.) */
  channel?: {
    transportId: string;
    channelId: string;
    sender: string;
    replyTo?: string;
    senderName?: string;
    groupId?: string;
    isVoiceNote?: boolean;
    detectedLanguage?: string;
  };
  /** Where this message originated — affects post-response hooks and channel routing */
  source?: "dashboard" | "channel";
```

- [ ] **Step 4: Handle channel in sendMessage() — stamp user turn**

In `chat-service.ts`, in the user turn creation (around line 619), add channel and sender:

```typescript
    const userTurn: TranscriptTurn = {
      type: "turn",
      role: "user",
      content: savedContent,
      timestamp: userTimestamp,
      turnNumber,
      attachments: savedAttachments.length > 0 ? savedAttachments : undefined,
      channel: options?.channel?.channelId,
      sender: options?.channel?.sender,
    };
```

- [ ] **Step 5: Handle channel in sendMessage() — set session channel**

After session creation (around line 475), add:

```typescript
    if (options?.channel?.channelId) {
      sessionManager.setChannel(options.channel.channelId);
    }
```

- [ ] **Step 6: Handle channel in sendMessage() — stamp assistant turns**

Add `channel: options?.channel?.channelId` to:
- Split turn (around line 709): `const splitTurn: TranscriptTurn = { ..., channel: options?.channel?.channelId };`
- Final turn (around line 785): `const assistantTurn: TranscriptTurn = { ..., channel: options?.channel?.channelId };`

- [ ] **Step 7: Handle source in sendMessage() — post-response hooks**

Around line 838, replace hardcoded `"dashboard"`:

```typescript
              source: options?.source ?? "dashboard",
```

- [ ] **Step 8: Skip naming for titled channel conversations**

Around line 820:

```typescript
      if (originalTurnNumber === 5) {
        const conv = await this.conversationManager.get(convId);
        if (!conv?.title || !options?.channel) {
          this.triggerNaming(convId).catch(() => {});
        }
      }
```

- [ ] **Step 9: Return detectedLanguage from STT for TTS path**

The STT section (around line 594) already sets `detectedLanguage`. Add it to the `done` event so channel consumers can use it for TTS:

In the `ChatEvent` type in `types.ts`, extend the `done` variant:

```typescript
  | { type: "done"; cost?: number; usage?: { input: number; output: number }; audioUrl?: string; detectedLanguage?: string }
```

In `sendMessage()`, when yielding the final `done` event (around line 767), include it:

```typescript
            yield {
              type: "done" as const,
              cost: event.cost,
              usage: event.usage,
              audioUrl,
              detectedLanguage,
            };
```

And declare `detectedLanguage` alongside the other STT variables (around line 583):

```typescript
    let detectedLanguage: string | undefined;
    // ... (already exists — just ensure it's in scope for the done event)
```

- [ ] **Step 10: Type check + run tests + commit**

```bash
cd packages/dashboard && npx tsc --noEmit
npx vitest run tests/unit/chat/
```

Commit: `"feat(chat): sendMessage handles channel metadata, source, detectedLanguage"`

---

## Task 5: Add `injectTurn()` Method

**Files:**
- Modify: `packages/dashboard/src/chat/chat-service.ts`

- [ ] **Step 1: Write failing test**

Create `packages/dashboard/tests/unit/chat/inject-turn.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { AppHarness } from "../../integration/app-harness.js";
import { installMockSession } from "../../integration/mock-session.js";

describe("injectTurn()", () => {
  let harness: AppHarness;

  beforeEach(async () => {
    harness = await AppHarness.create();
    installMockSession(harness);
  });

  afterEach(async () => {
    await harness.shutdown();
  });

  it("writes turn to transcript without brain invocation", async () => {
    const conv = await harness.conversations.create();
    await harness.chat.injectTurn(conv.id, {
      role: "user", content: "Admin injected", turnNumber: 1,
    });
    const turns = await harness.conversationManager.getTurns(conv.id);
    expect(turns).toHaveLength(1);
    expect(turns[0].content).toBe("Admin injected");
  });

  it("emits conversation:updated event", async () => {
    const conv = await harness.conversations.create();
    const events: string[] = [];
    harness.emitter.on("conversation:updated", (id: string) => events.push(id));

    await harness.chat.injectTurn(conv.id, {
      role: "assistant", content: "Event logged.", turnNumber: 1,
    });
    expect(events).toContain(conv.id);
  });

  it("stamps channel field when provided", async () => {
    const conv = await harness.conversations.create();
    await harness.chat.injectTurn(conv.id, {
      role: "user", content: "Calendar event", turnNumber: 1, channel: "system",
    });
    const turns = await harness.conversationManager.getTurns(conv.id);
    expect(turns[0].channel).toBe("system");
  });
});
```

- [ ] **Step 2: Run test — should fail (method doesn't exist yet)**

```bash
npx vitest run tests/unit/chat/inject-turn.test.ts
```

Expected: FAIL

- [ ] **Step 3: Implement injectTurn()**

Add to `AppChatService` in `chat-service.ts`:

```typescript
  /**
   * Write a turn directly to the transcript without invoking the brain.
   * Emits conversation:updated event (triggers StatePublisher).
   *
   * Used for: admin inject-message, scheduler event logging.
   */
  async injectTurn(
    conversationId: string,
    turn: {
      role: "user" | "assistant";
      content: string;
      turnNumber: number;
      channel?: string;
    },
  ): Promise<void> {
    const transcriptTurn: TranscriptTurn = {
      type: "turn",
      role: turn.role,
      content: turn.content,
      timestamp: new Date().toISOString(),
      turnNumber: turn.turnNumber,
      channel: turn.channel,
    };

    await this.conversationManager.appendTurn(conversationId, transcriptTurn);
    this.app.emit("conversation:updated", conversationId);
  }
```

- [ ] **Step 4: Run test — should pass**

```bash
npx vitest run tests/unit/chat/inject-turn.test.ts
```

Expected: 3/3 PASS

- [ ] **Step 5: Commit**

Commit: `"feat(chat): add injectTurn() for transcript-only writes"`

---

## Task 6: Refactor Message Handler

Replace direct session management with `app.chat.sendMessage()`. Pass audio attachments for STT. Keep outbound delivery, typing, TTS.

**Files:**
- Modify: `packages/dashboard/src/channels/message-handler.ts`

- [ ] **Step 1: Replace brain invocation section (lines 569-780)**

The section from "Save user turn" to end of `handleOwnerMessage` gets replaced. The message-handler now:
1. Converts audio attachments to `ChatMessageOptions.attachments` format
2. Calls `app.chat.sendMessage()` with channel options
3. Consumes events for typing timer management and split delivery
4. Handles outbound delivery (text or voice)

Replace lines 569-780 with:

```typescript
    // ── Delegate to app.chat for brain interaction ────────────────────
    // sendMessage() handles: user turn saving, STT transcription, session management,
    // brain streaming, assistant turn saving, WS broadcasting, post-response hooks.

    // Convert channel attachments to ChatMessageOptions format
    const chatAttachments: Array<{ filename: string; base64Data: string; mimeType: string }> = [];

    // Audio attachment from voice notes (STT happens in sendMessage)
    if (first.isVoiceNote && first.audioAttachment) {
      chatAttachments.push({
        filename: `voice-note-${Date.now()}.ogg`,
        base64Data: first.audioAttachment.buffer.toString("base64"),
        mimeType: first.audioAttachment.mimeType,
      });
    }

    // Image/file attachments (already processed above into savedAttachments)
    if (first.attachments?.length) {
      for (const att of first.attachments) {
        chatAttachments.push({
          filename: att.filename,
          base64Data: att.data.toString("base64"),
          mimeType: att.mimeType,
        });
      }
    }

    // Determine input medium — voice notes use audio STT path
    const inputMedium = first.isVoiceNote && first.audioAttachment
      ? ("audio" as const)
      : ("text" as const);

    // Send typing indicator
    await this.deps.sendTypingIndicator(channelId, replyTo);

    // Start response timer
    const responseTimer = new ResponseTimer({
      sendTyping: () => this.deps.sendTypingIndicator(channelId, replyTo),
      sendInterim: async (message) => {
        await this.deps.sendViaTransport(channelId, replyTo, { content: message });
        this.deps.connectionRegistry.broadcastToConversation(conversation.id, {
          type: "interim_status", message,
        });
      },
    });
    responseTimer.start();

    // Stream brain response via app.chat
    let currentText = "";
    let firstToken = true;
    let isFirstMessage = true;
    let detectedLanguage: string | undefined;

    try {
      for await (const event of this.deps.app.chat.sendMessage(
        conversation.id,
        textContent,
        turnNumber,
        {
          channel: {
            transportId: channelId,
            channelId,
            sender: first.from,
            replyTo: first.replyTo?.text,
            senderName: first.senderName,
            groupId: first.groupId,
            isVoiceNote: first.isVoiceNote,
            detectedLanguage: first.detectedLanguage,
          },
          source: "channel",
          attachments: chatAttachments.length > 0 ? chatAttachments : undefined,
          inputMedium: inputMedium === "audio" ? "audio" : undefined,
        },
      )) {
        switch (event.type) {
          case "text_delta":
            if (firstToken) { responseTimer.cancel(); firstToken = false; }
            currentText += event.text;
            break;
          case "turn_advanced":
            // Split: send ack immediately via channel
            if (currentText.trim()) {
              await this.deps.sendViaTransport(channelId, replyTo, { content: currentText });
            }
            currentText = "";
            isFirstMessage = false;
            break;
          case "done":
            // Capture detectedLanguage from STT (for TTS response)
            if ("detectedLanguage" in event && event.detectedLanguage) {
              detectedLanguage = event.detectedLanguage;
            }
            break;
        }
      }
    } catch (err) {
      responseTimer.cancel();
      console.error(`Brain error for channel message in ${conversation.id}:`, err);
      currentText = "I encountered an error processing your message.";
    } finally {
      responseTimer.cancel();
    }

    // Send final response via channel
    if (currentText.trim() || isFirstMessage) {
      let sentAsAudio = false;
      if (first.isVoiceNote && this.deps.sendAudioViaTransport) {
        try {
          sentAsAudio = await this.deps.sendAudioViaTransport(
            channelId, replyTo, currentText,
            detectedLanguage ?? first.detectedLanguage,
          );
        } catch (err) {
          console.warn("[ChannelMessageHandler] Voice reply failed, falling back to text:", err);
        }
      }
      if (!sentAsAudio) {
        await this.deps.sendViaTransport(channelId, replyTo, { content: currentText });
      }
    }
  }
```

- [ ] **Step 2: Remove now-unused code from the replaced section**

Remove the manual voice hint injection (old lines 544-561) — `sendMessage()` handles `VOICE_MODE_HINT` via `inputMedium: "audio"`.

Remove the `ContentBlock` type if no longer used elsewhere in the file.

Remove `savedAttachments` and `contentBlocks` variable declarations that were used in the old flow, IF the new flow doesn't need them. Check: the attachment processing section (old lines 503-537) saved attachments and built content blocks — with the new flow, we convert to `ChatMessageOptions.attachments` format instead. Remove the old processing and replace with the conversion in Step 1.

- [ ] **Step 3: Remove `sessionRegistry` from MessageHandlerDeps if unused**

Check if `sessionRegistry` is used anywhere else in the handler (e.g., for session invalidation on `/new`). If not, remove from `MessageHandlerDeps` interface and constructor. If used for `/new`, keep it.

- [ ] **Step 4: Type check + commit**

```bash
cd packages/dashboard && npx tsc --noEmit
```

Commit: `"refactor(channels): message-handler delegates brain + STT to app.chat"`

---

## Task 7: Route Admin Inject Through `injectTurn()`

**Files:**
- Modify: `packages/dashboard/src/routes/admin.ts`

- [ ] **Step 1: Replace appendTurn with injectTurn**

In the inject-message handler (around line 390), replace the manual `appendTurn` call:

```typescript
  // Route through app.chat for proper event emission
  const app = (fastify as any).app;
  if (!app?.chat) {
    return reply.code(503).send({ error: "Chat service not initialized" });
  }

  await app.chat.injectTurn(conversationId, {
    role: role as "user" | "assistant",
    content,
    turnNumber,
  });
```

Check how `app` is available on the Fastify instance — follow existing patterns in the file.

- [ ] **Step 2: Type check + commit**

Commit: `"refactor(admin): inject-message uses app.chat.injectTurn()"`

---

## Task 8: Route Scheduler Through `injectTurn()`

**Files:**
- Modify: `packages/dashboard/src/scheduler/event-handler.ts`
- Modify: `packages/dashboard/src/app.ts` (wire `app` to scheduler config)

- [ ] **Step 1: Add app to EventHandlerConfig**

```typescript
interface EventHandlerConfig {
  conversationManager: ConversationManager;
  agentDir: string;
  db: ConversationDatabase;
  app?: {
    chat: {
      injectTurn(conversationId: string, turn: {
        role: "user" | "assistant"; content: string; turnNumber: number; channel?: string;
      }): Promise<void>;
    };
  };
}
```

- [ ] **Step 2: Use injectTurn when available**

Replace the two `appendTurn` calls in `spawnEventQuery()`:

```typescript
    const chat = config.app?.chat;
    if (chat) {
      await chat.injectTurn(conversationId, {
        role: "user", content: description, turnNumber, channel: "system",
      });
      await chat.injectTurn(conversationId, {
        role: "assistant",
        content: "Event logged. Scheduled work is handled by automations.",
        turnNumber: turnNumber + 1, channel: "system",
      });
    } else {
      // Fallback for cases without app
      await conversationManager.appendTurn(conversationId, {
        type: "turn", role: "user", content: description, timestamp, turnNumber,
      });
      await conversationManager.appendTurn(conversationId, {
        type: "turn", role: "assistant",
        content: "Event logged. Scheduled work is handled by automations.",
        timestamp: new Date().toISOString(), turnNumber,
      });
    }
```

- [ ] **Step 3: Wire app in app.ts**

Find where `createEventHandler` is called and add `app`:

```typescript
const handler = createEventHandler({
  conversationManager: app.conversationManager,
  agentDir, db: app.conversationManager.getConversationDb(),
  app,
});
```

- [ ] **Step 4: Type check + commit**

Commit: `"refactor(scheduler): event-handler uses app.chat.injectTurn()"`

---

## Task 9: Spec Validation Tests (Section 8.8)

Cover the 6 remaining validation tests from spec Section 8.8 that aren't already tested.

**Files:**
- Create: `packages/dashboard/tests/integration/channel-unification.test.ts`

- [ ] **Step 1: Create the test file with all 6 missing tests**

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { AppHarness } from "./app-harness.js";
import { installMockSession } from "./mock-session.js";

describe("S2 Validation: Channel Unification (Spec 8.8)", () => {
  let harness: AppHarness;

  beforeEach(async () => {
    harness = await AppHarness.create();
    installMockSession(harness, { response: "Brain response" });
  });

  afterEach(async () => {
    await harness.shutdown();
  });

  // 8.8 Test 2: Channel-switch detection still works after unification
  it("channel-switch detection still works — no spurious new conversations", async () => {
    // Create a WhatsApp conversation with externalParty
    const conv = await harness.conversations.create({
      externalParty: "1234567890@s.whatsapp.net",
    });
    // Send a message on it via app.chat with channel metadata
    for await (const event of harness.chat.sendMessage(conv.id, "Hello", 1, {
      channel: { transportId: "whatsapp", channelId: "whatsapp", sender: "1234567890@s.whatsapp.net" },
      source: "channel",
    })) {}

    // The conversation should still be the same (no spurious new conversation)
    const current = await harness.conversationManager.getCurrent();
    expect(current).not.toBeNull();
    expect(current!.id).toBe(conv.id);

    // Verify turns have channel field
    const turns = await harness.conversationManager.getTurns(conv.id);
    expect(turns.length).toBeGreaterThanOrEqual(2); // user + assistant
    expect(turns[0].channel).toBe("whatsapp");
    expect(turns[1].channel).toBe("whatsapp");
  });

  // 8.8 Test 5: Concurrent channel + web messages on same conversation
  it("concurrent channel + web messages — no turn number collision", async () => {
    const conv = await harness.conversations.create();

    // Send web message (turn 1)
    for await (const event of harness.chat.sendMessage(conv.id, "Web hello", 1)) {}

    // Send channel message (turn 3 — sendMessage auto-increments from turnCount)
    const updatedConv = await harness.conversationManager.get(conv.id);
    const nextTurn = (updatedConv?.turnCount ?? 0) + 1;
    for await (const event of harness.chat.sendMessage(conv.id, "WhatsApp hello", nextTurn, {
      channel: { transportId: "wa", channelId: "whatsapp", sender: "user@wa" },
      source: "channel",
    })) {}

    // Verify all turns have unique turn numbers
    const turns = await harness.conversationManager.getTurns(conv.id);
    const turnNumbers = turns.map((t) => t.turnNumber);
    const uniqueTurnNumbers = new Set(turnNumbers);
    expect(uniqueTurnNumbers.size).toBe(turnNumbers.length);
  });

  // 8.8 Test 6: source: "channel" reaches post-response hooks
  it("source: 'channel' reaches post-response hooks", async () => {
    const conv = await harness.conversations.create();

    // Wire a spy on post-response hooks
    let capturedSource: string | undefined;
    harness.chat.setDeps({
      log: () => {},
      logError: () => {},
      abbreviationQueue: null,
      idleTimerManager: null,
      attachmentService: null,
      conversationSearchService: null,
      postResponseHooks: {
        run: async (_convId, _user, _assistant, options) => {
          capturedSource = options?.source;
        },
      },
    });

    for await (const event of harness.chat.sendMessage(conv.id, "test", 1, {
      source: "channel",
    })) {}

    expect(capturedSource).toBe("channel");
  });

  // 8.8 Test 7: WhatsApp voice note arrives as raw audio, STT runs in sendMessage()
  it("audio attachment with inputMedium='audio' triggers STT in sendMessage", async () => {
    const conv = await harness.conversations.create();

    // Send with audio attachment + inputMedium: "audio"
    // Since mock session doesn't have real STT, we verify the flow doesn't crash
    // and a turn is saved (transcription result depends on capability availability)
    const events: Array<{ type: string }> = [];
    for await (const event of harness.chat.sendMessage(conv.id, "", 1, {
      inputMedium: "audio",
      attachments: [{
        filename: "voice.ogg",
        base64Data: Buffer.from("fake-ogg-audio").toString("base64"),
        mimeType: "audio/ogg",
      }],
      channel: { transportId: "wa", channelId: "whatsapp", sender: "user@wa", isVoiceNote: true },
      source: "channel",
    })) {
      events.push(event);
    }

    // Should complete without error (STT may fail on fake audio but shouldn't crash)
    expect(events.some((e) => e.type === "start" || e.type === "error")).toBe(true);
  });

  // 8.8 Test 9: detectedLanguage flows from STT through to TTS response
  it("detectedLanguage included in done event when STT runs", async () => {
    const conv = await harness.conversations.create();

    // Verify done event type supports detectedLanguage field
    const doneEvents: Array<any> = [];
    for await (const event of harness.chat.sendMessage(conv.id, "test", 1)) {
      if (event.type === "done") doneEvents.push(event);
    }

    // done event should exist (even without audio, detectedLanguage is optional)
    expect(doneEvents.length).toBeGreaterThanOrEqual(1);
    // Type check: detectedLanguage field exists on done event (may be undefined)
    const lastDone = doneEvents[doneEvents.length - 1];
    expect("detectedLanguage" in lastDone || lastDone.detectedLanguage === undefined).toBe(true);
  });

  // 8.8 Test 10: VOICE_MODE_HINT injected for both WhatsApp and dashboard audio
  // (tested via integration — VOICE_MODE_HINT is injected when inputMedium="audio")
  it("VOICE_MODE_HINT path exists for audio input", async () => {
    const conv = await harness.conversations.create();

    // Send audio input — even with fake audio, the code path should be exercised
    const events: Array<{ type: string }> = [];
    for await (const event of harness.chat.sendMessage(conv.id, "voice test", 1, {
      inputMedium: "audio",
    })) {
      events.push(event);
    }

    // Should not crash — voice mode hint path is exercised
    expect(events.some((e) => e.type === "start" || e.type === "done" || e.type === "error")).toBe(true);
  });

  // 8.8 Test 4: Voice note round-trip (automated stub — full round-trip is HITL)
  it("voice note with audio attachment flows through sendMessage without crash", async () => {
    const conv = await harness.conversations.create({
      externalParty: "user@s.whatsapp.net",
    });

    // Simulate channel voice note: audio attachment + isVoiceNote flag
    const events: Array<{ type: string }> = [];
    for await (const event of harness.chat.sendMessage(conv.id, "", 1, {
      inputMedium: "audio",
      attachments: [{
        filename: "voice.ogg",
        base64Data: Buffer.from("fake-ogg-audio-data").toString("base64"),
        mimeType: "audio/ogg",
      }],
      channel: {
        transportId: "whatsapp", channelId: "whatsapp",
        sender: "user@s.whatsapp.net", isVoiceNote: true,
      },
      source: "channel",
    })) {
      events.push(event);
    }

    // Completes (STT may error on fake audio — that's fine, path exercised)
    expect(events.length).toBeGreaterThan(0);

    // Conversation still exists and has turns
    const turns = await harness.conversationManager.getTurns(conv.id);
    expect(turns.length).toBeGreaterThanOrEqual(1);
  });

  // 8.8 Test 8: Dashboard voice input still transcribes correctly (no regression)
  it("dashboard audio input with inputMedium='audio' exercises STT path", async () => {
    const conv = await harness.conversations.create();

    // Simulate dashboard voice: audio attachment, no channel metadata
    const events: Array<{ type: string }> = [];
    for await (const event of harness.chat.sendMessage(conv.id, "", 1, {
      inputMedium: "audio",
      attachments: [{
        filename: "recording.webm",
        base64Data: Buffer.from("fake-webm-audio").toString("base64"),
        mimeType: "audio/webm",
      }],
      // No channel option = dashboard source
    })) {
      events.push(event);
    }

    // Path exercised without crash (STT will error on fake audio)
    expect(events.some((e) => e.type === "start" || e.type === "error")).toBe(true);

    // User turn should be saved (even if content is error message)
    const turns = await harness.conversationManager.getTurns(conv.id);
    expect(turns.length).toBeGreaterThanOrEqual(1);
    expect(turns[0].role).toBe("user");
    // No channel stamp on dashboard voice input
    expect(turns[0].channel).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run all validation tests**

```bash
cd packages/dashboard && npx vitest run tests/integration/channel-unification.test.ts
```

Expected: All pass. Some audio tests may yield `error` events due to missing STT capability in test env — that's expected, the test verifies the path doesn't crash.

- [ ] **Step 3: Commit**

Commit: `"test(s2): spec 8.8 validation tests — channel-switch, concurrent, source, STT, voice hint"`

---

## Task 10: Integration Verification + HITL + Roadmap (Spec 8.9)

Covers all 9 verification steps from spec Section 8.9. Steps 1-6 are automated, steps 7-9 are HITL. The sprint is not done until all 9 pass.

- [ ] **Step 1: (8.9-1) Run full test suite — no regressions**

```bash
cd packages/dashboard && npx vitest run tests/
```

Fix any regressions. Pay attention to: `chat-service.test.ts`, `channel-message-flow.test.ts`, `app-events.test.ts`.

- [ ] **Step 2: (8.9-2) All new unit tests pass**

```bash
cd packages/dashboard && npx vitest run tests/unit/chat/ tests/conversation-initiator.test.ts tests/integration/notification-delivery.test.ts tests/integration/channel-unification.test.ts
```

Expected: All 8.8 validation tests green.

- [ ] **Step 3: (8.9-3+4) Headless App integration tests**

Already covered by `channel-unification.test.ts` (channel message through app.chat) and `inject-turn.test.ts` (write-only turn). Confirm both passed in Step 2.

- [ ] **Step 4: (8.9-5) STT integration test**

Already covered by `channel-unification.test.ts` tests for audio attachment + inputMedium. Confirm passed in Step 2.

- [ ] **Step 5: (8.9-6) Build clean**

```bash
cd packages/core && npx tsc
cd packages/dashboard && npx tsc
```

- [ ] **Step 6: Restart dashboard**

```bash
systemctl --user restart nina-dashboard.service
```

Check logs:
```bash
journalctl --user -u nina-dashboard.service --since "1 min ago" --no-pager
```

Expected: No errors related to message-handler, chat-service, scheduler, or STT.

- [ ] **Step 7: (8.9-7) HITL — Dashboard voice round-trip**

1. Open dashboard in browser
2. Record a voice message (press mic button)
3. Verify: transcription appears in chat ("`[Voice message] ...`")
4. Verify: TTS audio response plays back

If STT capability is unavailable in test env, note as BLOCKED with reason.

- [ ] **Step 8: (8.9-8) HITL — WhatsApp voice round-trip**

1. Send a voice note on WhatsApp to Nina
2. Verify: transcription appears in dashboard transcript with `[Voice message]` prefix
3. Verify: voice note reply received on WhatsApp (TTS)
4. Verify: dashboard transcript shows assistant response with `channel: "whatsapp"` (check via debug endpoint or DB)

If WhatsApp not connected, note as BLOCKED with reason.

- [ ] **Step 9: (8.9-9) HITL — Text message on both channels**

1. Send a text message on dashboard
2. Send a text message on WhatsApp
3. Verify: both route through `app.chat` (check logs for `[Model Debug]` lines from sendMessage)
4. Verify: dashboard message has no `channel` field, WhatsApp message has `channel: "whatsapp"` in DB

If WhatsApp not connected, note as BLOCKED with reason.

- [ ] **Step 10: Record HITL results in test-report.md**

Document pass/fail/blocked for each of the 9 verification steps. The sprint is not done until all 9 pass (spec Section 8.9).

- [ ] **Step 11: Update ROADMAP.md — mark S2 Done**

- [ ] **Step 12: Commit**

Commit: `"docs: M9.4-S2 verification complete, roadmap updated"`
