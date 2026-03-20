# M6.10-S3: Chat Handler Decomposition — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the 1399-line `chat-handler.ts` into an App-owned `ChatService` (business logic) and a thin WS adapter (transport), targeting chat-handler.ts < 200 lines.

**Architecture:** `ChatService` is a new App service namespace (`app.chat`) that owns all chat business logic — conversation switching, skill expansion, message validation, streaming orchestration, naming, and post-response hooks. It accepts explicit IDs and returns typed results or async generators, with zero knowledge of WebSocket transport. The WS adapter retains only per-connection state (`currentConversationId`, `isStreaming`), auth gating, message JSON parsing, and forwarding ChatService results to the socket.

**Tech Stack:** TypeScript, Node.js EventEmitter, Vitest

**Design spec:** `docs/superpowers/specs/2026-03-16-headless-app-design.md` §S3

**Test baseline:** 619 tests (68 files, 2 skipped) — must remain green throughout.

---

## File Structure

| Action | Path | Responsibility |
|--------|------|----------------|
| **Create** | `src/chat/chat-service.ts` | `AppChatService` — all chat business logic |
| **Create** | `src/chat/types.ts` | Result types, ChatEvent union, ChatMessageOptions |
| **Create** | `src/chat/skill-expander.ts` | Skill command expansion (pure functions) |
| **Create** | `src/chat/index.ts` | Barrel export |
| **Modify** | `src/app-events.ts` | Add `chat:*` events to AppEventMap |
| **Modify** | `src/app.ts` | Add `chat: AppChatService` namespace, wire deps |
| **Modify** | `src/ws/chat-handler.ts` | Slim to thin WS adapter (< 200 lines) |
| **Modify** | `src/index.ts` | Remove `connectionRegistry` import from chat-handler, create locally |
| **Modify** | `tests/integration/app-harness.ts` | Add `AppChatService` to harness |
| **Create** | `tests/integration/chat-service.test.ts` | Integration tests for ChatService |

## Key Design Decisions

### Per-Connection State

`ChatService` is stateless — it takes explicit `conversationId` parameters. Per-connection state (`currentConversationId`, `currentTurnNumber`, `isStreaming`, `sessionManager`) stays in the WS adapter. This matches the existing service namespace pattern (AppTaskService, AppConversationService are stateless wrappers).

### Streaming Interface

`ChatService.sendMessage()` returns an `AsyncGenerator<ChatEvent>` — same pattern as `SessionManager.streamMessage()`. The WS adapter iterates the generator and sends each event as JSON. No EventEmitter needed for streaming — generators give natural backpressure and per-connection isolation.

### SessionRegistry Consolidation

`chat-handler.ts` currently has its own module-level `sessionRegistry` (line 94) separate from `App.sessionRegistry` (created in S2). S3 consolidates to App's — the ChatService uses `app.sessionRegistry`.

### ConnectionRegistry Stays in Adapter

Per design spec: "connectionRegistry stays in adapter since it's transport-specific." It moves from being a chat-handler.ts module singleton to being created in `index.ts` and passed to both the Fastify adapter and `App.create()`.

### Auth/Hatching Stays in Adapter

Auth gate and hatching flow (ScriptedHatchingEngine, LLM hatching) are transport-specific — they send controls, compose hints, and auth messages that are WebSocket protocol concepts. They stay in the adapter.

### ResponseTimer Stays in Adapter

The `ResponseTimer` sends "still thinking..." interim status messages after a delay. This is a transport UX concern — the adapter creates and manages the timer, sending `interim_status` messages directly to the socket. The ChatService does not create a ResponseTimer; it only yields streaming content events. The adapter wraps the ChatService generator with its own timer logic.

---

## Task 1: Chat Event Types + Result Types

**Files:**
- Modify: `src/app-events.ts`
- Create: `src/chat/types.ts`
- Create: `src/chat/index.ts`

- [ ] **Step 1: Add chat events to AppEventMap**

In `src/app-events.ts`, add after the `"skills:changed"` entry:

```typescript
// Chat streaming events (emitted by ChatService through App)
"chat:text_delta": [conversationId: string, text: string];
"chat:thinking_delta": [conversationId: string, text: string];
"chat:thinking_end": [conversationId: string];
"chat:done": [conversationId: string, cost?: number, usage?: { input: number; output: number }];
"chat:error": [conversationId: string, message: string];
"chat:start": [conversationId: string];
```

- [ ] **Step 2: Create chat result types**

Create `src/chat/types.ts`:

```typescript
import type { Conversation } from "../conversations/types.js";
import type { ConversationMeta, Turn } from "../ws/protocol.js";

/** Event yielded from ChatService.sendMessage() */
export type ChatEvent =
  | { type: "start" }
  | { type: "text_delta"; text: string }
  | { type: "thinking_delta"; text: string }
  | { type: "thinking_end" }
  | { type: "done"; cost?: number; usage?: { input: number; output: number } }
  | { type: "error"; message: string }
  | { type: "interim_status"; message: string };

/** Result from ChatService.connect() */
export interface ConnectResult {
  conversation: ConversationMeta | null;
  turns: Turn[];
  hasMore: boolean;
  allConversations: ConversationMeta[];
}

/** Result from ChatService.newConversation() / switchConversation() */
export interface ConversationSwitchResult {
  conversation: ConversationMeta;
  turns: Turn[];
  hasMore: boolean;
}

/** Result from ChatService.loadMoreTurns() */
export interface LoadMoreResult {
  turns: Turn[];
  hasMore: boolean;
}

/** Options for sendMessage */
export interface ChatMessageOptions {
  reasoning?: boolean;
  model?: string;
  attachments?: Array<{
    filename: string;
    base64Data: string;
    mimeType: string;
  }>;
  context?: {
    type: string;
    title: string;
    file?: string;
    taskId?: string;
  } | null;
}

/** Side effects produced by sendMessage (for adapter to handle) */
export interface MessageSideEffects {
  /** User turn to broadcast to other tabs */
  userTurn: Turn;
  /** Assistant turn to broadcast after streaming completes */
  assistantTurn: Turn;
  /** Conversation was auto-created (first message) */
  conversationCreated?: ConversationMeta;
  /** Conversation was auto-renamed (turn 5) */
  conversationRenamed?: { conversationId: string; title: string };
}
```

- [ ] **Step 3: Run TypeScript compilation**

Run: `cd packages/dashboard && npx tsc --noEmit`
Expected: Clean compile (types.ts is standalone, no imports from unwritten modules yet)

- [ ] **Step 4: Commit**

```bash
git add packages/dashboard/src/app-events.ts packages/dashboard/src/chat/types.ts
git commit -m "feat(m6.10-s3): add chat event types and result types"
```

---

## Task 2: Extract Skill Expander

**Files:**
- Create: `src/chat/skill-expander.ts`
- Modify: `src/ws/chat-handler.ts` (import from new location)

- [ ] **Step 1: Create skill-expander.ts**

Move the pure functions `getSkillsDirs()`, `loadSkillContent()`, and `expandSkillCommand()` from `chat-handler.ts` (lines 25-77) into `src/chat/skill-expander.ts`:

```typescript
import { readFile } from "node:fs/promises";
import * as path from "node:path";

/** Skills directories: SDK skills (primary) + framework skills (fallback) */
function getSkillsDirs(agentDir: string): string[] {
  return [
    path.join(agentDir, ".claude", "skills"),
    path.resolve(import.meta.dirname, "../../../core/skills"),
  ];
}

/**
 * Load skill content for /my-agent:* commands.
 * Searches SDK skills first, then framework skills.
 */
async function loadSkillContent(
  skillName: string,
  agentDir: string,
): Promise<string | null> {
  for (const dir of getSkillsDirs(agentDir)) {
    const skillPath = path.join(dir, skillName, "SKILL.md");
    try {
      return await readFile(skillPath, "utf-8");
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * Expand /my-agent:* commands in message content.
 * Returns expanded content with skill instructions prepended.
 */
export async function expandSkillCommand(
  content: string,
  agentDir: string,
): Promise<string> {
  const match = content.match(/^\/my-agent:(\S+)/);
  if (!match) return content;

  const skillName = match[1];
  const skillContent = await loadSkillContent(skillName, agentDir);

  if (!skillContent) {
    return content;
  }

  const lines = content.split("\n");
  const contextLines = lines.slice(1);
  const context = contextLines.join("\n").trim();

  return `[SKILL: ${skillName}]\n\n${skillContent.trim()}\n\n---\n\n${context}`;
}
```

- [ ] **Step 2: Update chat-handler.ts to import from new module**

In `chat-handler.ts`, replace the inline `getSkillsDirs`, `loadSkillContent`, and `expandSkillCommand` functions (lines 24-77) with:

```typescript
import { expandSkillCommand } from "../chat/skill-expander.js";
```

- [ ] **Step 3: Run tests**

Run: `cd packages/dashboard && npx vitest run 2>&1 | tail -20`
Expected: All 619 tests pass

- [ ] **Step 4: Commit**

```bash
git add packages/dashboard/src/chat/skill-expander.ts packages/dashboard/src/ws/chat-handler.ts
git commit -m "refactor(m6.10-s3): extract skill expander from chat-handler"
```

---

## Task 3: Create AppChatService with Conversation Operations

**Files:**
- Create: `src/chat/chat-service.ts`
- Modify: `src/app.ts` (add `chat` namespace)

This task extracts the "easy" methods — conversation management operations that don't involve streaming. The streaming `sendMessage` is Task 4.

- [ ] **Step 1: Create ChatService with conversation operation methods**

Create `src/chat/chat-service.ts`. The ChatService wraps conversation management methods with the turn-loading, abbreviation-queuing, and naming logic that currently lives in the WS handler:

```typescript
import type { App } from "../app.js";
import type { ConversationManager } from "../conversations/index.js";
import type { SessionRegistry } from "../agent/session-registry.js";
import type { Conversation, TranscriptTurn } from "../conversations/types.js";
import type { ConversationMeta, Turn } from "../ws/protocol.js";
import type {
  ConnectResult,
  ConversationSwitchResult,
  LoadMoreResult,
} from "./types.js";
import { loadModels } from "@my-agent/core";

const TURNS_PER_PAGE = 50;
const MAX_TITLE_LENGTH = 100;
const CONVERSATION_ID_RE = /^conv-[A-Z0-9]{26}$/;

export function isValidConversationId(id: string): boolean {
  return CONVERSATION_ID_RE.test(id);
}

/**
 * Convert Conversation to ConversationMeta for protocol.
 */
export function toConversationMeta(conv: Conversation): ConversationMeta {
  return {
    id: conv.id,
    title: conv.title,
    topics: conv.topics,
    created: conv.created.toISOString(),
    updated: conv.updated.toISOString(),
    turnCount: conv.turnCount,
    model: conv.model,
    externalParty: conv.externalParty,
    isPinned: conv.isPinned,
    status: conv.status,
  };
}

/**
 * Convert TranscriptTurn to Turn for protocol.
 */
export function toTurn(turn: TranscriptTurn): Turn {
  return {
    role: turn.role,
    content: turn.content,
    timestamp: turn.timestamp,
    turnNumber: turn.turnNumber,
    thinkingText: turn.thinkingText,
    usage: turn.usage,
    cost: turn.cost,
    attachments: turn.attachments,
    channel: turn.channel,
  };
}

export class AppChatService {
  constructor(private app: App) {}

  // ─── Read helpers ──────────────────────────────────────────────────

  get conversationManager(): ConversationManager {
    return this.app.conversationManager;
  }

  get sessionRegistry(): SessionRegistry {
    return this.app.sessionRegistry;
  }

  // ─── Conversation Operations ───────────────────────────────────────

  /**
   * Load conversation state (on initial connect or reconnect).
   */
  async connect(conversationId?: string | null): Promise<ConnectResult> {
    let conversation: Conversation | null;

    if (conversationId) {
      conversation = await this.conversationManager.get(conversationId);
      if (!conversation) {
        throw new Error("Conversation not found");
      }
    } else {
      conversation = await this.conversationManager.getCurrent();
    }

    let turns: TranscriptTurn[] = [];
    let meta: ConversationMeta | null = null;

    if (conversation) {
      turns = await this.conversationManager.getTurns(conversation.id, {
        limit: TURNS_PER_PAGE,
      });
      meta = toConversationMeta(conversation);
    }

    const allConversations = await this.conversationManager.list({});

    return {
      conversation: meta,
      turns: turns.map(toTurn),
      hasMore: turns.length === TURNS_PER_PAGE,
      allConversations: allConversations.slice(0, 50).map(toConversationMeta),
    };
  }

  /**
   * Create a new conversation.
   * Caller should queue abbreviation for the previous conversation if applicable.
   */
  async newConversation(): Promise<ConversationSwitchResult> {
    const conversation = await this.app.conversations.create();

    return {
      conversation: toConversationMeta(conversation),
      turns: [],
      hasMore: false,
    };
  }

  /**
   * Switch to an existing conversation.
   */
  async switchConversation(
    conversationId: string,
  ): Promise<ConversationSwitchResult> {
    const conversation = await this.conversationManager.get(conversationId);
    if (!conversation) {
      throw new Error("Conversation not found");
    }

    await this.app.conversations.makeCurrent(conversationId);

    const turns = await this.conversationManager.getTurns(conversation.id, {
      limit: TURNS_PER_PAGE,
    });

    return {
      conversation: toConversationMeta(conversation),
      turns: turns.map(toTurn),
      hasMore: turns.length === TURNS_PER_PAGE,
    };
  }

  /**
   * Rename the current conversation.
   */
  async renameConversation(
    conversationId: string,
    title: string,
  ): Promise<string> {
    const trimmedTitle = title.slice(0, MAX_TITLE_LENGTH);
    await this.conversationManager.setTitleManual(conversationId, trimmedTitle);
    return trimmedTitle;
  }

  /**
   * Load more turns (pagination).
   */
  async loadMoreTurns(
    conversationId: string,
    before: string,
  ): Promise<LoadMoreResult> {
    const { turns, hasMore } = await this.conversationManager.getTurnsBefore(
      conversationId,
      before,
      TURNS_PER_PAGE,
    );

    return {
      turns: turns.map(toTurn),
      hasMore,
    };
  }

  /**
   * Delete a conversation with full cleanup.
   */
  async deleteConversation(
    conversationId: string,
    cleanup?: {
      cancelAbbreviation?: (convId: string) => void;
      clearIdleTimer?: (convId: string) => void;
      deleteAttachments?: (convId: string) => void;
      removeSearchEmbeddings?: (convId: string) => void;
    },
  ): Promise<void> {
    const conversation = await this.conversationManager.get(conversationId);
    if (!conversation) {
      throw new Error("Conversation not found");
    }

    // Cleanup hooks (adapter provides transport-specific cleanup)
    cleanup?.cancelAbbreviation?.(conversationId);
    cleanup?.clearIdleTimer?.(conversationId);
    cleanup?.deleteAttachments?.(conversationId);
    cleanup?.removeSearchEmbeddings?.(conversationId);

    // Remove from session registry
    this.sessionRegistry.remove(conversationId);

    // Delete from database + transcript (emits conversation:deleted → StatePublisher)
    await this.app.conversations.delete(conversationId);
  }

  /**
   * Set model for a conversation.
   */
  async setModel(conversationId: string, model: string): Promise<void> {
    const models = loadModels();
    const validModels = Object.values(models);
    if (!validModels.includes(model)) {
      throw new Error("Invalid model");
    }

    await this.conversationManager.setModel(conversationId, model);
  }

  /**
   * Delete a conversation if it has no turns (empty conversation cleanup).
   */
  async deleteIfEmpty(conversationId: string): Promise<void> {
    const conv = await this.conversationManager.get(conversationId);
    if (conv && conv.turnCount === 0) {
      await this.app.conversations.delete(conversationId);
    }
  }
}
```

- [ ] **Step 2: Wire ChatService into App**

In `src/app.ts`, add the import and namespace:

1. Add import at top:
```typescript
import { AppChatService } from "./chat/chat-service.js";
```

2. Add to class properties (after `memory!: AppMemoryService`):
```typescript
chat!: AppChatService;
```

3. In `App.create()`, add after the service namespaces block (after line 1029):
```typescript
app.chat = new AppChatService(app);
```

- [ ] **Step 3: Run TypeScript compilation**

Run: `cd packages/dashboard && npx tsc --noEmit`
Expected: Clean compile

- [ ] **Step 4: Run tests**

Run: `cd packages/dashboard && npx vitest run 2>&1 | tail -20`
Expected: All 619 tests pass

- [ ] **Step 5: Commit**

```bash
git add packages/dashboard/src/chat/chat-service.ts packages/dashboard/src/app.ts
git commit -m "feat(m6.10-s3): create AppChatService with conversation operations"
```

---

## Task 4: Move Streaming (sendMessage) into ChatService

**Files:**
- Modify: `src/chat/chat-service.ts`
- Modify: `src/chat/types.ts`

This is the highest-risk task — extracting the streaming state machine from `handleChatMessage()` (chat-handler.ts lines 820-1354). The ChatService method returns an `AsyncGenerator<ChatEvent>` that the WS adapter iterates.

- [ ] **Step 1: Add sendMessage dependencies to ChatService constructor**

The `sendMessage` method needs access to services that are currently accessed via `fastify.*` closures. Add a deps interface:

In `src/chat/types.ts`, add:

```typescript
import type { AbbreviationQueue, NamingService } from "../conversations/index.js";
import type { AttachmentService } from "../conversations/attachments.js";
import type { IdleTimerManager } from "../conversations/index.js";
import type { PostResponseHooks } from "../conversations/post-response-hooks.js";
import type { ConversationSearchService } from "../conversations/search-service.js";

/** External services that ChatService delegates to for sendMessage side effects */
export interface ChatServiceDeps {
  abbreviationQueue?: AbbreviationQueue | null;
  idleTimerManager?: IdleTimerManager | null;
  attachmentService?: AttachmentService | null;
  conversationSearchService?: ConversationSearchService | null;
  postResponseHooks?: PostResponseHooks | null;
  log: (msg: string) => void;
  logError: (err: unknown, msg: string) => void;
}
```

Note: `IdleTimerManager` and `NamingService` may need to be checked for actual export names. Verify at implementation time.

- [ ] **Step 2: Add sendMessage to ChatService**

This method encapsulates the full message flow: create conversation if needed → expand skills → process attachments → save user turn → stream response → save assistant turn → trigger naming → run post-response hooks.

Add to `AppChatService` in `src/chat/chat-service.ts`:

```typescript
import { expandSkillCommand } from "./skill-expander.js";
import { NamingService } from "../conversations/index.js";
import { AttachmentService } from "../conversations/attachments.js";
import { ResponseTimer } from "../channels/response-timer.js";
import type { ChatEvent, ChatMessageOptions, ChatServiceDeps } from "./types.js";

// Add to class:
private namingService: NamingService | null = null;
private deps: ChatServiceDeps | null = null;

/** Set runtime dependencies (called once from adapter wiring in index.ts) */
setDeps(deps: ChatServiceDeps): void {
  this.deps = deps;
}

/**
 * Send a chat message and stream the response.
 *
 * Handles the full lifecycle:
 * 1. Auto-create conversation if conversationId is null
 * 2. Expand skill commands
 * 3. Process attachments
 * 4. Save user turn
 * 5. Stream response via SessionManager
 * 6. Save assistant turn
 * 7. Trigger naming (at turn 5)
 * 8. Run post-response hooks
 *
 * Returns an async generator of ChatEvents for the adapter to forward.
 * Also returns side-effect metadata via the `effects` property on the return value.
 */
async *sendMessage(
  conversationId: string | null,
  content: string,
  turnNumber: number,
  options?: ChatMessageOptions,
): AsyncGenerator<ChatEvent & { _effects?: any }> {
  const deps = this.deps;
  const log = deps?.log ?? console.log;
  const logError = deps?.logError ?? console.error;

  // ── Skill expansion ───────────────────────────────────────────
  const expandedContent = await expandSkillCommand(content, this.app.agentDir);
  if (expandedContent !== content) {
    log("Expanded skill command in message");
  }

  // ── Auto-create conversation if needed ────────────────────────
  let convId = conversationId;
  let conversationCreated: ConversationMeta | undefined;

  if (!convId) {
    const conversation = await this.app.conversations.create();
    convId = conversation.id;

    if (options?.model) {
      await this.conversationManager.setModel(conversation.id, options.model);
      conversation.model = options.model;
    }

    conversationCreated = toConversationMeta(conversation);
  }

  // ── Get or create session ─────────────────────────────────────
  const storedSid = this.conversationManager
    .getConversationDb()
    .getSdkSessionId(convId);
  const sessionManager = await this.sessionRegistry.getOrCreate(
    convId,
    storedSid,
  );

  // ── Task context ──────────────────────────────────────────────
  if (options?.context?.type === "task" && options.context.taskId) {
    sessionManager.setTaskContext(options.context.taskId, options.context.title);
  }

  // ── Process attachments ───────────────────────────────────────
  type ContentBlock =
    | { type: "text"; text: string }
    | { type: "image"; source: { type: "base64"; media_type: string; data: string } };

  let contentBlocks: ContentBlock[] | undefined;
  const savedAttachments: Array<{
    id: string;
    filename: string;
    localPath: string;
    mimeType: string;
    size: number;
  }> = [];

  if (options?.attachments?.length && deps?.attachmentService) {
    contentBlocks = [];

    if (expandedContent.trim()) {
      contentBlocks.push({ type: "text", text: expandedContent });
    } else {
      contentBlocks.push({ type: "text", text: "What is this?" });
    }

    for (const attachment of options.attachments) {
      try {
        const saved = await deps.attachmentService.save(
          convId,
          attachment.filename,
          attachment.mimeType,
          attachment.base64Data,
        );
        savedAttachments.push(saved.meta);

        if (deps.attachmentService.isImage(attachment.mimeType)) {
          contentBlocks.push({
            type: "image",
            source: {
              type: "base64",
              media_type: attachment.mimeType,
              data: attachment.base64Data,
            },
          });
        } else {
          const textContent = Buffer.from(attachment.base64Data, "base64").toString("utf-8");
          contentBlocks.push({
            type: "text",
            text: `<file name="${attachment.filename}">\n${textContent}\n</file>`,
          });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to save attachment";
        yield { type: "error" as const, message };
        logError(err, `Attachment save failed: ${message}`);
      }
    }

    if (contentBlocks.length === 0) {
      contentBlocks = undefined;
    }
  }

  // ── Save user turn ────────────────────────────────────────────
  const userTimestamp = new Date().toISOString();
  const userTurn: TranscriptTurn = {
    type: "turn",
    role: "user",
    content,
    timestamp: userTimestamp,
    turnNumber,
    attachments: savedAttachments.length > 0 ? savedAttachments : undefined,
  };

  await this.conversationManager.appendTurn(convId, userTurn);

  // Fire-and-forget search indexing
  if (deps?.conversationSearchService) {
    deps.conversationSearchService
      .indexTurn(convId, turnNumber, "user", content)
      .catch(() => {});
  }

  // Touch idle timer
  deps?.idleTimerManager?.touch(convId);

  // Yield a _effects event so the adapter knows about side effects
  // (conversation creation, user turn for broadcast)
  yield {
    type: "start" as const,
    _effects: {
      conversationId: convId,
      conversationCreated,
      userTurn: toTurn(userTurn),
    },
  };

  // ── Stream response ───────────────────────────────────────────
  let assistantContent = "";
  let thinkingText = "";
  let usage: { input: number; output: number } | undefined;
  let cost: number | undefined;

  const conversation = await this.conversationManager.get(convId);
  const modelOverride = options?.model || conversation?.model || undefined;

  if (options?.model && options.model !== conversation?.model) {
    await this.conversationManager.setModel(convId, options.model);
  }

  // Response timer for interim status
  const responseTimer = new ResponseTimer({
    sendTyping: async () => {},
    sendInterim: async (message) => {
      // Can't yield from inside callback — timer messages are handled by adapter
    },
  });
  responseTimer.start();

  try {
    const messageContent = contentBlocks || expandedContent;
    let firstToken = true;

    for await (const event of sessionManager.streamMessage(messageContent, {
      model: modelOverride,
      reasoning: options?.reasoning,
    })) {
      switch (event.type) {
        case "text_delta":
          if (firstToken) {
            responseTimer.cancel();
            firstToken = false;
          }
          assistantContent += event.text;
          yield { type: "text_delta" as const, text: event.text };
          break;
        case "thinking_delta":
          thinkingText += event.text;
          yield { type: "thinking_delta" as const, text: event.text };
          break;
        case "thinking_end":
          yield { type: "thinking_end" as const };
          break;
        case "done":
          usage = event.usage;
          cost = event.cost;
          yield { type: "done" as const, cost: event.cost, usage: event.usage };
          break;
        case "error":
          yield { type: "error" as const, message: event.message };
          break;
      }
    }

    // ── Save assistant turn ───────────────────────────────────────
    const assistantTurn: TranscriptTurn = {
      type: "turn",
      role: "assistant",
      content: assistantContent,
      timestamp: new Date().toISOString(),
      turnNumber,
      thinkingText: thinkingText || undefined,
      usage,
      cost,
    };

    await this.conversationManager.appendTurn(convId, assistantTurn);

    // Search indexing
    if (deps?.conversationSearchService && assistantContent) {
      deps.conversationSearchService
        .indexTurn(convId, turnNumber, "assistant", assistantContent)
        .catch(() => {});
    }

    // Persist SDK session ID
    const sdkSid = sessionManager.getSessionId();
    if (sdkSid) {
      this.conversationManager
        .getConversationDb()
        .updateSdkSessionId(convId, sdkSid);
    }

    // Touch idle timer
    deps?.idleTimerManager?.touch(convId);

    // Trigger naming at turn 5
    if (turnNumber === 5) {
      this.triggerNaming(convId).catch(() => {});
    }

    // Post-response hooks
    if (deps?.postResponseHooks) {
      deps.postResponseHooks
        .run(convId, content.trim().toLowerCase(), assistantContent)
        .catch(() => {});
    }

    // Emit App events for structural live updates
    this.app.emit("chat:done", convId, cost, usage);
  } catch (err) {
    responseTimer.cancel();
    const message = err instanceof Error ? err.message : "Unknown error";
    logError(err, "Error in streamMessage");
    yield { type: "error" as const, message };
  } finally {
    responseTimer.cancel();
  }
}

/**
 * Handle /model slash command.
 * Returns a generator of ChatEvents (text response to show the user).
 */
async *handleModelCommand(
  conversationId: string | null,
  modelArg?: string,
): AsyncGenerator<ChatEvent> {
  const models = loadModels();

  if (!modelArg) {
    const conversation = conversationId
      ? await this.conversationManager.get(conversationId)
      : null;
    const currentModel = conversation?.model || models.sonnet;
    const modelName = currentModel.includes("opus")
      ? "Opus"
      : currentModel.includes("haiku")
        ? "Haiku"
        : "Sonnet";

    yield { type: "start" };
    yield {
      type: "text_delta",
      text: `Current model: ${modelName}\n\nAvailable: /model opus, /model sonnet, /model haiku`,
    };
    yield { type: "done" };
    return;
  }

  const modelMap: Record<string, string> = {
    opus: models.opus,
    sonnet: models.sonnet,
    haiku: models.haiku,
  };

  const newModelId = modelMap[modelArg];
  if (!newModelId) {
    yield { type: "start" };
    yield { type: "text_delta", text: `Unknown model "${modelArg}". Available: opus, sonnet, haiku` };
    yield { type: "done" };
    return;
  }

  if (!conversationId) {
    yield { type: "start" };
    yield { type: "text_delta", text: "No active conversation. Send a message first to start one." };
    yield { type: "done" };
    return;
  }

  await this.conversationManager.setModel(conversationId, newModelId);

  // Invalidate cached session — model change requires fresh SDK session
  this.sessionRegistry.remove(conversationId);
  this.conversationManager
    .getConversationDb()
    .updateSdkSessionId(conversationId, null);

  const modelName = modelArg.charAt(0).toUpperCase() + modelArg.slice(1);
  yield { type: "start" };
  yield { type: "text_delta", text: `Switched to ${modelName}.` };
  yield { type: "done" };
}

/**
 * Handle /new slash command — creates conversation with welcome message.
 */
async newConversationWithWelcome(): Promise<ConversationSwitchResult> {
  const conversation = await this.app.conversations.create();

  const confirmationTurn: Turn = {
    role: "assistant",
    content: "Starting fresh! How can I help?",
    timestamp: new Date().toISOString(),
    turnNumber: 0,
  };

  return {
    conversation: toConversationMeta(conversation),
    turns: [confirmationTurn],
    hasMore: false,
  };
}

// ─── Private helpers ──────────────────────────────────────────────

private async triggerNaming(conversationId: string): Promise<void> {
  const conv = await this.conversationManager.get(conversationId);
  if (conv?.title) return;

  if (!this.namingService) {
    this.namingService = new NamingService();
  }

  const turns = await this.conversationManager.getRecentTurns(conversationId, 10);
  const result = await this.namingService.generateName(turns);
  await this.conversationManager.setTitle(conversationId, result.title);
  await this.conversationManager.setTopics(conversationId, result.topics);

  // Emit event so adapter can broadcast
  this.app.emit("conversation:updated", conversationId);
}
```

- [ ] **Step 3: Create barrel export**

Create `src/chat/index.ts`:

```typescript
export { AppChatService } from "./chat-service.js";
export { expandSkillCommand } from "./skill-expander.js";
export type {
  ChatEvent,
  ConnectResult,
  ConversationSwitchResult,
  LoadMoreResult,
  ChatMessageOptions,
  ChatServiceDeps,
} from "./types.js";
```

- [ ] **Step 4: Run TypeScript compilation**

Run: `cd packages/dashboard && npx tsc --noEmit`
Expected: Clean compile. Fix any type errors (likely around `TranscriptTurn` import, `NamingService` export names, or `ResponseTimer` constructor shape).

- [ ] **Step 5: Run tests**

Run: `cd packages/dashboard && npx vitest run 2>&1 | tail -20`
Expected: All 619 tests pass (no behavior change yet — chat-handler.ts still has its own implementation)

- [ ] **Step 6: Commit**

```bash
git add packages/dashboard/src/chat/
git commit -m "feat(m6.10-s3): add sendMessage streaming to AppChatService"
```

---

## Task 5: Slim chat-handler.ts to Thin WS Adapter

**Files:**
- Modify: `src/ws/chat-handler.ts` (major rewrite — < 200 lines)
- Modify: `src/index.ts` (update wiring)

This is the integration task — replacing the business logic in `chat-handler.ts` with calls to `app.chat.*`. The adapter retains per-connection state, auth gate, hatching, message routing, and send().

**Important:** This task changes behavior paths. Run tests after EACH sub-step.

- [ ] **Step 1: Replace conversation management handlers**

Replace `handleConnect`, `handleNewConversation`, `handleSwitchConversation`, `handleRenameConversation`, `handleLoadMoreTurns`, `handleDeleteConversation`, `handleSetModel` with calls to `app.chat.*`. Also remove `queueAbbreviationForCurrent`, `deleteIfEmpty`, `toConversationMeta`, `toTurn` — these now live in ChatService.

The adapter's message handler becomes a thin switch that delegates:

```typescript
// Example for handleConnect:
if (msg.type === "connect") {
  if (msg.conversationId && !isValidConversationId(msg.conversationId)) {
    send({ type: "error", message: "Invalid conversation ID" });
    return;
  }
  try {
    const result = await app.chat.connect(msg.conversationId);
    currentConversationId = result.conversation?.id ?? null;
    // ... update local state, send result
  } catch (err) {
    send({ type: "error", message: err instanceof Error ? err.message : "Error" });
  }
  return;
}
```

- [ ] **Step 2: Replace handleChatMessage with ChatService.sendMessage**

The adapter iterates the ChatEvent generator and sends each event:

```typescript
// Slash commands
const textContent = msg.content.trim().toLowerCase();

if (textContent === "/new") {
  // Queue abbreviation, delete empty, create new via app.chat
  if (currentConversationId) {
    await app.chat.deleteIfEmpty(currentConversationId);
    if (fastify.abbreviationQueue) {
      fastify.abbreviationQueue.enqueue(currentConversationId);
    }
  }
  const result = await app.chat.newConversationWithWelcome();
  currentConversationId = result.conversation.id;
  currentTurnNumber = 0;
  sessionManager = await app.sessionRegistry.getOrCreate(result.conversation.id);
  connectionRegistry.switchConversation(socket, result.conversation.id);
  send({ type: "conversation_loaded", ...result });
  send({ type: "conversation_created", conversation: result.conversation });
  connectionRegistry.broadcastToAll(
    { type: "conversation_created", conversation: result.conversation },
    socket,
  );
  return;
}

const modelMatch = textContent.match(/^\/model(?:\s+(\w+))?$/);
if (modelMatch) {
  for await (const event of app.chat.handleModelCommand(currentConversationId, modelMatch[1])) {
    send(chatEventToServerMessage(event));
  }
  // If model changed, broadcast + clear session
  if (modelMatch[1] && currentConversationId) {
    const models = loadModels();
    const newModelId = { opus: models.opus, sonnet: models.sonnet, haiku: models.haiku }[modelMatch[1]];
    if (newModelId) {
      sessionManager = null;
      connectionRegistry.broadcastToConversation(currentConversationId, {
        type: "conversation_model_changed",
        conversationId: currentConversationId,
        model: newModelId,
      });
    }
  }
  return;
}

// Normal message
isStreaming = true;
currentTurnNumber++;
try {
  for await (const event of app.chat.sendMessage(
    currentConversationId,
    msg.content,
    currentTurnNumber,
    { reasoning: msg.reasoning, model: msg.model, attachments: msg.attachments, context: msg.context },
  )) {
    // Handle _effects from start event
    if (event.type === "start" && event._effects) {
      const effects = event._effects;
      currentConversationId = effects.conversationId;
      if (effects.conversationCreated) {
        connectionRegistry.switchConversation(socket, effects.conversationId);
        send({ type: "conversation_created", conversation: effects.conversationCreated });
        connectionRegistry.broadcastToAll(
          { type: "conversation_created", conversation: effects.conversationCreated },
          socket,
        );
      }
      // Broadcast user turn to other tabs
      connectionRegistry.broadcastToConversation(
        effects.conversationId,
        { type: "conversation_updated", conversationId: effects.conversationId, turn: effects.userTurn },
        socket,
      );
    }
    send(chatEventToServerMessage(event));
  }
} catch (err) {
  send({ type: "error", message: err instanceof Error ? err.message : "Unknown error" });
} finally {
  isStreaming = false;
}
```

- [ ] **Step 3: Remove module-level singletons**

Remove from chat-handler.ts:
- `export const sessionRegistry` (line 94) — use `fastify.app!.sessionRegistry`
- `let idleTimerManager` (line 88) — move to index.ts or App
- `let namingService` (line 91) — now inside ChatService
- `let attachmentService` (line 97) — pass to ChatService via deps

Keep:
- `export const connectionRegistry` — stays as adapter-layer singleton (will clean up in Task 6)

- [ ] **Step 4: Add chatEventToServerMessage helper**

```typescript
function chatEventToServerMessage(event: ChatEvent): ServerMessage {
  switch (event.type) {
    case "start": return { type: "start" };
    case "text_delta": return { type: "text_delta", content: event.text };
    case "thinking_delta": return { type: "thinking_delta", content: event.text };
    case "thinking_end": return { type: "thinking_end" };
    case "done": return { type: "done", cost: event.cost, usage: event.usage };
    case "error": return { type: "error", message: event.message };
    case "interim_status": return { type: "interim_status", message: event.message };
  }
}
```

- [ ] **Step 5: Wire ChatService deps in index.ts**

In `src/index.ts`, after `server.app = app`, add:

```typescript
// Wire ChatService runtime deps
app.chat.setDeps({
  abbreviationQueue: app.abbreviationQueue,
  idleTimerManager: null, // Lazily created on first WS connection
  attachmentService: new AttachmentService(agentDir),
  conversationSearchService: app.conversationSearchService,
  postResponseHooks: app.postResponseHooks,
  log: (msg) => console.log(msg),
  logError: (err, msg) => console.error(msg, err),
});
```

- [ ] **Step 6: Verify chat-handler.ts line count**

Run: `wc -l packages/dashboard/src/ws/chat-handler.ts`
Expected: < 200 lines. If over, identify remaining business logic to extract.

- [ ] **Step 7: Run TypeScript compilation**

Run: `cd packages/dashboard && npx tsc --noEmit`
Expected: Clean compile

- [ ] **Step 8: Run full test suite**

Run: `cd packages/dashboard && npx vitest run 2>&1 | tail -30`
Expected: All 619 tests pass

- [ ] **Step 9: Commit**

```bash
git add packages/dashboard/src/ws/chat-handler.ts packages/dashboard/src/index.ts packages/dashboard/src/chat/
git commit -m "feat(m6.10-s3): slim chat-handler to thin WS adapter, delegate to AppChatService"
```

---

## Task 6: Consolidate Module Singletons

**Files:**
- Modify: `src/ws/chat-handler.ts`
- Modify: `src/index.ts`
- Modify: `src/app.ts` (if connectionRegistry creation moves)

- [ ] **Step 1: Move connectionRegistry creation to index.ts**

Currently `connectionRegistry` is a module singleton in `chat-handler.ts` (line 85) imported by `index.ts`. Move creation to `index.ts`:

In `index.ts`:
```typescript
import { ConnectionRegistry } from "./ws/connection-registry.js";

const connectionRegistry = new ConnectionRegistry();
const app = await App.create({ agentDir, connectionRegistry });
```

In `chat-handler.ts`, change `registerChatWebSocket` to accept `connectionRegistry` as a parameter instead of using the module singleton:
```typescript
export async function registerChatWebSocket(
  fastify: FastifyInstance,
  connectionRegistry: ConnectionRegistry,
): Promise<void> {
```

Update `server.ts` to pass it through.

- [ ] **Step 2: Remove stale sessionRegistry export from chat-handler.ts**

If `sessionRegistry` is still exported from chat-handler.ts, remove it. All consumers should use `app.sessionRegistry`.

- [ ] **Step 3: Run tests**

Run: `cd packages/dashboard && npx vitest run 2>&1 | tail -20`
Expected: All 619 tests pass

- [ ] **Step 4: Commit**

```bash
git add packages/dashboard/src/ws/chat-handler.ts packages/dashboard/src/index.ts packages/dashboard/src/server.ts
git commit -m "refactor(m6.10-s3): consolidate module singletons, connectionRegistry created in index.ts"
```

---

## Task 7: Integration Tests for ChatService

**Files:**
- Create: `tests/integration/chat-service.test.ts`
- Modify: `tests/integration/app-harness.ts` (add ChatService)

- [ ] **Step 1: Add AppChatService to AppHarness**

In `app-harness.ts`, add:

```typescript
import { AppChatService } from "../../src/chat/chat-service.js";

// In class properties:
readonly chat: AppChatService;

// In constructor, after service namespaces:
this.chat = new AppChatService(this.emitter as any);
```

Note: `AppChatService` takes an `App` but AppHarness has a `HarnessEmitter`. The constructor accesses `app.conversationManager`, `app.sessionRegistry`, `app.conversations`, `app.agentDir`. The harness will need to provide these. Adapt the `HarnessEmitter` or wrap AppChatService construction to pass the harness as a duck-typed App.

- [ ] **Step 2: Write ChatService integration tests**

Create `tests/integration/chat-service.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { AppHarness } from "./app-harness.js";

describe("ChatService Integration", () => {
  let harness: AppHarness;

  beforeEach(async () => {
    harness = await AppHarness.create();
  });

  afterEach(async () => {
    await harness.shutdown();
  });

  describe("connect()", () => {
    it("returns empty state when no conversations exist", async () => {
      const result = await harness.chat.connect();
      expect(result.conversation).toBeNull();
      expect(result.turns).toEqual([]);
      expect(result.hasMore).toBe(false);
      expect(result.allConversations).toEqual([]);
    });

    it("returns current conversation when one exists", async () => {
      const conv = await harness.conversations.create();
      const result = await harness.chat.connect();
      expect(result.conversation?.id).toBe(conv.id);
    });

    it("returns specific conversation when ID provided", async () => {
      const conv1 = await harness.conversations.create();
      const conv2 = await harness.conversations.create();
      const result = await harness.chat.connect(conv1.id);
      expect(result.conversation?.id).toBe(conv1.id);
    });

    it("throws for nonexistent conversation", async () => {
      await expect(
        harness.chat.connect("conv-NONEXISTENT0000000000000000"),
      ).rejects.toThrow("Conversation not found");
    });
  });

  describe("newConversation()", () => {
    it("creates a new conversation", async () => {
      const result = await harness.chat.newConversation();
      expect(result.conversation.id).toMatch(/^conv-/);
      expect(result.turns).toEqual([]);
      expect(result.hasMore).toBe(false);
    });

    it("emits conversation:created event", async () => {
      const events: any[] = [];
      harness.emitter.on("conversation:created", (conv) => events.push(conv));

      await harness.chat.newConversation();

      expect(events).toHaveLength(1);
    });
  });

  describe("switchConversation()", () => {
    it("loads existing conversation", async () => {
      const conv = await harness.conversations.create();
      const result = await harness.chat.switchConversation(conv.id);
      expect(result.conversation.id).toBe(conv.id);
    });

    it("throws for nonexistent conversation", async () => {
      await expect(
        harness.chat.switchConversation("conv-NONEXISTENT0000000000000000"),
      ).rejects.toThrow("Conversation not found");
    });
  });

  describe("deleteConversation()", () => {
    it("deletes conversation and emits event", async () => {
      const events: string[] = [];
      harness.emitter.on("conversation:deleted", (id) => events.push(id));

      const conv = await harness.conversations.create();
      await harness.chat.deleteConversation(conv.id);

      expect(events).toHaveLength(1);
      expect(events[0]).toBe(conv.id);
    });

    it("throws for nonexistent conversation", async () => {
      await expect(
        harness.chat.deleteConversation("conv-NONEXISTENT0000000000000000"),
      ).rejects.toThrow("Conversation not found");
    });
  });

  describe("deleteIfEmpty()", () => {
    it("deletes conversation with 0 turns", async () => {
      const conv = await harness.conversations.create();
      await harness.chat.deleteIfEmpty(conv.id);

      const check = await harness.conversationManager.get(conv.id);
      expect(check).toBeNull();
    });
  });

  describe("renameConversation()", () => {
    it("renames and truncates to 100 chars", async () => {
      const conv = await harness.conversations.create();
      const longTitle = "A".repeat(200);
      const result = await harness.chat.renameConversation(conv.id, longTitle);
      expect(result.length).toBe(100);
    });
  });

  describe("isValidConversationId()", () => {
    it("validates correctly", async () => {
      const { isValidConversationId } = await import(
        "../../src/chat/chat-service.js"
      );
      expect(isValidConversationId("conv-ABCDEFGHIJ1234567890123456")).toBe(true);
      expect(isValidConversationId("bad-id")).toBe(false);
      expect(isValidConversationId("")).toBe(false);
    });
  });
});
```

- [ ] **Step 3: Run new tests**

Run: `cd packages/dashboard && npx vitest run tests/integration/chat-service.test.ts -v`
Expected: All tests pass

- [ ] **Step 4: Run full test suite**

Run: `cd packages/dashboard && npx vitest run 2>&1 | tail -20`
Expected: All tests pass (619 + new chat-service tests)

- [ ] **Step 5: Commit**

```bash
git add packages/dashboard/tests/integration/
git commit -m "test(m6.10-s3): add ChatService integration tests"
```

---

## Task 8: Full Verification + External Review

**Files:** None (verification only)

- [ ] **Step 1: Run full test suite**

Run: `cd packages/dashboard && npx vitest run 2>&1`
Expected: All tests pass (619 + new), 0 failures

- [ ] **Step 2: TypeScript clean compile**

Run: `cd packages/dashboard && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Verify chat-handler.ts line count**

Run: `wc -l packages/dashboard/src/ws/chat-handler.ts`
Expected: < 200 lines

- [ ] **Step 4: Verify chat-service.ts is comprehensive**

Run: `wc -l packages/dashboard/src/chat/chat-service.ts`
Verify it contains the bulk of the extracted logic.

- [ ] **Step 5: Verify no module singletons leak**

Run: `grep -n "^export const " packages/dashboard/src/ws/chat-handler.ts`
Expected: Only `connectionRegistry` if not yet moved, or nothing.

- [ ] **Step 6: Browser verification** (if dashboard is running)

1. Open dashboard in browser
2. Send a message → verify streaming works
3. Switch conversations → verify history loads
4. Create new conversation → verify sidebar updates
5. Delete conversation → verify removal
6. Try /model command → verify model switching
7. Try /new command → verify fresh conversation

- [ ] **Step 7: Dispatch external reviewer**

Provide:
- Spec: `docs/superpowers/specs/2026-03-16-headless-app-design.md` (§S3)
- Plan: this file
- Diff: `git diff master...HEAD`
- Test results from Step 1

External reviewer writes `review.md` and `test-report.md` in this sprint directory.

- [ ] **Step 8: Notify CTO**

"Sprint complete. Run `/trip-review` when ready."
