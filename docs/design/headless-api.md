# Headless App API Reference

> For sprint QA agents, external reviewers, and automated testing.
>
> The headless App lets you drive the full dashboard application — chat,
> tasks, conversations, debug introspection — without a browser, HTTP server,
> or real Claude API key. All state mutations emit typed events that tests can
> assert on directly.

---

## Quick Start

```typescript
import { AppHarness } from "packages/dashboard/tests/integration/app-harness.js";
import { installMockSession } from "packages/dashboard/tests/integration/mock-session.js";

const harness = await AppHarness.create();
installMockSession(harness, { response: "Hello from mock agent" });

const conv = await harness.conversations.create();
const events: string[] = [];
for await (const event of harness.chat.sendMessage(conv.id, "Hi", 0)) {
  events.push(event.type);
}
// events = ["start", "text_delta", "done"]

await harness.shutdown();
```

---

## Service Namespaces

The `App` class (and `AppHarness`) exposes services as named namespaces. All
mutations go through these namespaces so typed events fire automatically.
**Never mutate the underlying managers directly** in tests.

### app.chat

`AppChatService` — conversation and message operations. Stateless: takes
explicit IDs, returns typed results or async generators. No WebSocket knowledge.

```typescript
// Load conversation state (returns current or specified conversation + turns)
chat.connect(conversationId?: string | null): Promise<ConnectResult>

// Create a new blank conversation
chat.newConversation(): Promise<ConversationSwitchResult>

// Create a new conversation and inject a "Starting fresh!" assistant turn
chat.newConversationWithWelcome(): Promise<ConversationSwitchResult>

// Switch to an existing conversation (makes it current)
chat.switchConversation(conversationId: string): Promise<ConversationSwitchResult>

// Rename a conversation (truncates at 100 chars)
chat.renameConversation(conversationId: string, title: string): Promise<string>

// Load older turns (pagination, 50 per page)
chat.loadMoreTurns(conversationId: string, before: string): Promise<LoadMoreResult>

// Delete a conversation with optional cleanup callbacks
chat.deleteConversation(conversationId: string, cleanup?: {
  cancelAbbreviation?: (convId: string) => void;
  clearIdleTimer?: (convId: string) => void;
  deleteAttachments?: (convId: string) => void;
  removeSearchEmbeddings?: (convId: string) => void;
}): Promise<void>

// Change the model for a conversation (invalidates the cached SDK session)
chat.setModel(conversationId: string, model: string): Promise<void>

// Delete conversation only if it has zero turns
chat.deleteIfEmpty(conversationId: string): Promise<void>

// Handle /model slash command — returns async generator of ChatEvents
chat.handleModelCommand(conversationId: string | null, modelArg?: string): AsyncGenerator<ChatEvent>

// Send a message and stream the response — core method
// First yielded event is always "start" with _effects side-effect metadata
chat.sendMessage(
  conversationId: string | null,
  content: string,
  turnNumber: number,
  options?: ChatMessageOptions,
): AsyncGenerator<ChatEvent & { _effects?: StartEffects }>

// Wire external service dependencies (call once from adapter/test setup)
chat.setDeps(deps: ChatServiceDeps): void
```

**`ChatEvent` union:**

| `type` | Extra fields | Meaning |
|--------|-------------|---------|
| `"start"` | `_effects?: StartEffects` | Streaming started; side effects available |
| `"text_delta"` | `text: string` | Incremental response text |
| `"thinking_delta"` | `text: string` | Extended-thinking increment |
| `"thinking_end"` | — | Extended thinking finished |
| `"done"` | `cost?: number`, `usage?: {input,output}` | Stream complete |
| `"error"` | `message: string` | Fatal error, no response saved |

**`StartEffects`** (on the `"start"` event `_effects` field):

```typescript
interface StartEffects {
  conversationId: string;       // resolved convId (may be auto-created)
  userTurn: Turn;               // the saved user turn (for broadcast)
  conversationCreated?: ConversationMeta; // set if conversation was auto-created
}
```

**`ChatMessageOptions`:**

```typescript
interface ChatMessageOptions {
  reasoning?: boolean;          // enable extended thinking
  model?: string;               // override model for this message
  attachments?: Array<{
    filename: string;
    base64Data: string;
    mimeType: string;
  }>;
  context?: {
    type: string;               // e.g. "task"
    title: string;
    file?: string;
    taskId?: string;
  } | null;
}
```

---

### app.tasks

`AppTaskService` — task CRUD. All mutations emit App events.

```typescript
// List tasks with optional filter
tasks.list(filter?: TaskFilter): Task[]

// Find a single task by ID (returns undefined if not found)
tasks.findById(id: string): Task | undefined

// Get running tasks for a conversation
tasks.getRunningTasksForConversation(convId: string): Task[]

// Get all tasks linked to a conversation
tasks.getTasksForConversation(convId: string): Task[]

// Create a task — emits "task:created"
tasks.create(input: CreateTaskInput): Task

// Update a task — emits "task:updated"
tasks.update(id: string, changes: TaskUpdateChanges): void

// Delete a task — emits "task:deleted"
tasks.delete(id: string): void

// Link a task to a conversation — emits "task:updated"
tasks.linkTaskToConversation(taskId: string, conversationId: string): void
```

---

### app.conversations

`AppConversationService` — conversation lifecycle. All mutations emit App events.

```typescript
// List conversations with optional options
conversations.list(opts?: ListOptions): Promise<Conversation[]>

// Get a single conversation by ID
conversations.get(id: string): Promise<Conversation | null>

// Create a new conversation — emits "conversation:created"
conversations.create(opts?: CreateOptions): Promise<Conversation>

// Delete a conversation — emits "conversation:deleted"
conversations.delete(id: string): Promise<void>

// Make a conversation current (updates last-active timestamp) — emits "conversation:updated"
conversations.makeCurrent(id: string): Promise<void>

// Unpin a conversation — emits "conversation:updated"
conversations.unpin(id: string): Promise<void>

// Access the underlying databases directly (for advanced use)
conversations.getDb(): Database
conversations.getConversationDb(): ConversationDb
conversations.close(): void

// Callback invoked when the active conversation becomes inactive (used by AbbreviationQueue)
conversations.onConversationInactive: ((oldConvId: string) => void) | undefined
```

---

### app.debug

`AppDebugService` — read-only brain introspection. No side effects.

```typescript
// Agent hatching/auth/model status
debug.brainStatus(): Promise<BrainStatus>

// Recursive listing of all files under .my_agent/brain/
debug.brainFiles(): Promise<BrainFiles>

// Assembled system prompt with per-component character counts
debug.systemPrompt(): Promise<SystemPromptResult>

// Inventory of framework and user skills
debug.skills(): Promise<SkillInventory>
```

**Return types:**

```typescript
interface BrainStatus {
  hatched: boolean;
  authSource: string | null;  // "file" | "env" | "none"
  authType: string | null;    // "api_key" | "oauth" | "none"
  model: string;
  brainDir: string;
}

interface BrainFiles {
  root: string;               // absolute path to brain dir
  files: FileEntry[];         // sorted by path
}

interface FileEntry {
  path: string;               // relative to brain root
  size: number;               // bytes
  modified: string;           // ISO 8601
}

interface SkillInventory {
  framework: SkillEntry[];
  user: SkillEntry[];
}

interface SkillEntry {
  name: string;
  path: string;
  description?: string;       // first non-heading line of SKILL.md
}

interface SystemPromptResult {
  systemPrompt: string;
  components: {
    personality: { source: string; chars: number } | null;
    identity: { source: string; chars: number } | null;
    contacts: { source: string; chars: number } | null;
    preferences: { source: string; chars: number } | null;
    notebooks: Record<string, { chars: number }>;
    skills: { framework: number; user: number };
  };
  totalChars: number;
}
```

---

### app.memory

`AppMemoryService` — signal-only; no read methods.

```typescript
// Emit "memory:changed" after any memory state mutation
memory.emitChanged(): void
```

---

### app.calendar

`AppCalendarService` — signal-only; no read methods.

```typescript
// Emit "calendar:changed" after any CalDAV mutation
calendar.emitChanged(): void
```

---

## Events (AppEventMap)

Subscribe via `app.on(event, listener)` or `harness.emitter.on(event, listener)`.

| Event | Payload | When emitted |
|-------|---------|--------------|
| `"task:created"` | `task: Task` | `tasks.create()` |
| `"task:updated"` | `task: Task` | `tasks.update()`, `tasks.linkTaskToConversation()` |
| `"task:deleted"` | `taskId: string` | `tasks.delete()` |
| `"conversation:created"` | `conversation: Conversation` | `conversations.create()` |
| `"conversation:updated"` | `conversationId: string` | `conversations.makeCurrent()`, `conversations.unpin()` |
| `"conversation:deleted"` | `conversationId: string` | `conversations.delete()` |
| `"notification:created"` | `notification: AnyNotification` | NotificationService fires |
| `"calendar:changed"` | _(none)_ | `calendar.emitChanged()` or CalendarScheduler |
| `"memory:changed"` | _(none)_ | `memory.emitChanged()`, SyncService sync, health change |
| `"channel:status_changed"` | `transportId: string, status: TransportStatus` | Transport connects/disconnects |
| `"channel:qr_code"` | `transportId: string, qrDataUrl: string` | WhatsApp QR ready |
| `"channel:pairing_code"` | `transportId: string, pairingCode: string` | WhatsApp phone-pair code ready |
| `"channel:paired"` | `transportId: string` | WhatsApp paired successfully |
| `"skills:changed"` | _(none)_ | Skill file created or modified |
| `"chat:start"` | `conversationId: string` | `sendMessage()` streaming starts |
| `"chat:text_delta"` | `conversationId: string, text: string` | Text chunk streamed |
| `"chat:thinking_delta"` | `conversationId: string, text: string` | Thinking chunk streamed |
| `"chat:thinking_end"` | `conversationId: string` | Extended thinking finished |
| `"chat:done"` | `conversationId: string, cost?: number, usage?: {input,output}` | Stream complete |
| `"chat:error"` | `conversationId: string, message: string` | Stream error |

---

## Common QA Patterns

### Send a message and verify response

```typescript
import { AppHarness } from "./app-harness.js";
import { installMockSession } from "./mock-session.js";

const harness = await AppHarness.create();
installMockSession(harness, { response: "Hello, world!" });

const conv = await harness.conversations.create();
const chunks: string[] = [];

for await (const event of harness.chat.sendMessage(conv.id, "Hello", 0)) {
  if (event.type === "text_delta") chunks.push(event.text);
}

assert.strictEqual(chunks.join(""), "Hello, world!");
await harness.shutdown();
```

### Verify live-update events fire

```typescript
const harness = await AppHarness.create();
installMockSession(harness, { response: "Pong" });

const emittedEvents: string[] = [];
harness.emitter.on("chat:start", () => emittedEvents.push("chat:start"));
harness.emitter.on("chat:done", () => emittedEvents.push("chat:done"));

const conv = await harness.conversations.create();

// Drain the generator (events fire through App.emit during iteration)
for await (const _ of harness.chat.sendMessage(conv.id, "Ping", 0)) {}

// Note: chat:* events are emitted by the WS adapter layer in production.
// In tests, subscribe to the emitter directly and assert on ChatEvent types
// yielded by sendMessage() — both approaches work.
assert.deepStrictEqual(emittedEvents.includes("chat:done"), true);
await harness.shutdown();
```

### Inspect system prompt

```typescript
const harness = await AppHarness.create();

const result = await harness.debug.systemPrompt();
console.log(`Total chars: ${result.totalChars}`);
console.log(`Skills: ${result.components.skills.framework} framework, ${result.components.skills.user} user`);

await harness.shutdown();
```

### Test task lifecycle

```typescript
const harness = await AppHarness.create();
const createdTasks: string[] = [];

harness.emitter.on("task:created", (task) => createdTasks.push(task.id));
harness.emitter.on("task:updated", (task) => { /* assert status */ });
harness.emitter.on("task:deleted", (id) => { /* verify id */ });

const task = harness.tasks.create({
  title: "Test task",
  instructions: "Do something",
  conversationId: null,
});

harness.tasks.update(task.id, { status: "in_progress" });
harness.tasks.delete(task.id);

assert.strictEqual(createdTasks[0], task.id);
await harness.shutdown();
```

### Check broadcast messages

```typescript
const harness = await AppHarness.create();

// StatePublisher wires to harness.connectionRegistry.broadcastToAll
// All broadcasts are captured in harness.broadcasts[]

const task = harness.tasks.create({ title: "Watch me", instructions: "..." });
harness.statePublisher.subscribeToApp(harness.emitter as any);
harness.tasks.update(task.id, { status: "completed" });

// harness.clearBroadcasts() to reset between test cases
const taskBroadcasts = harness.getBroadcasts("task_updated");
assert.ok(taskBroadcasts.length > 0);
await harness.shutdown();
```

### Test error simulation

```typescript
const harness = await AppHarness.create();
installMockSession(harness, { error: "Simulated API failure" });

const conv = await harness.conversations.create();
let errorMessage = "";

for await (const event of harness.chat.sendMessage(conv.id, "Hello", 0)) {
  if (event.type === "error") errorMessage = event.message;
}

assert.strictEqual(errorMessage, "Simulated API failure");
await harness.shutdown();
```

---

## AppHarness

`AppHarness` is a lightweight App-compatible test fixture. It initializes the
full service layer — conversations, tasks, debug, chat — but skips production
subsystems that are unnecessary or harmful in tests:

- No Fastify HTTP server
- No CalDAV / calendar scheduler
- No WhatsApp / Baileys transport
- No embeddings plugins (Ollama)
- No work loop scheduler
- No MCP servers
- No SystemPromptBuilder / session manager

### Creating a harness

```typescript
// Minimal harness (most tests)
const harness = await AppHarness.create();

// With memory subsystem (MemoryDb + SyncService + SearchService)
const harness = await AppHarness.create({ withMemory: true });
```

`AppHarness.create()` creates a temporary directory under `os.tmpdir()` with
the minimal agent structure needed (`brain/AGENTS.md`, `runtime/`, `tasks/logs/`).

### Harness properties

```typescript
harness.agentDir           // absolute path to the temp agent directory
harness.conversationManager
harness.taskManager
harness.logStorage
harness.notificationService
harness.connectionRegistry
harness.statePublisher
harness.broadcasts         // CapturedBroadcast[] — all broadcastToAll() calls
harness.emitter            // HarnessEmitter — typed AppEventMap event emitter
harness.tasks              // AppTaskService
harness.conversations      // AppConversationService
harness.calendar           // AppCalendarService
harness.memory             // AppMemoryService
harness.chat               // AppChatService
harness.debug              // AppDebugService
harness.sessionRegistry    // SessionRegistry
harness.memoryDb           // MemoryDb | null (only with withMemory: true)
harness.syncService        // SyncService | null
harness.searchService      // SearchService | null
```

### Harness methods

```typescript
// Clear broadcast capture between test cases
harness.clearBroadcasts(): void

// Filter broadcasts by type
harness.getBroadcasts(type: string): CapturedBroadcast[]

// Graceful shutdown — closes databases, removes temp directory
harness.shutdown(): Promise<void>
```

### Important: chat service wiring

`AppChatService.sendMessage()` requires `setDeps()` to be called before use.
`installMockSession()` does this automatically. If you use a real session or
write custom test setup, call `setDeps()` manually:

```typescript
harness.chat.setDeps({
  log: () => {},
  logError: () => {},
  abbreviationQueue: null,
  idleTimerManager: null,
  attachmentService: null,
  conversationSearchService: null,
  postResponseHooks: null,
});
```

---

## Mock Sessions

`installMockSession()` replaces the real Claude API with a configurable mock,
enabling full `sendMessage()` flows without an API key or network.

```typescript
import { installMockSession } from "./mock-session.js";

installMockSession(harness, options?: MockSessionOptions)
```

**`MockSessionOptions`:**

```typescript
interface MockSessionOptions {
  /** Text the mock agent responds with (default: "Mock response") */
  response?: string;

  /** Custom StreamEvent sequence — overrides response text completely */
  events?: StreamEvent[];

  /** Simulated cost in USD (appears in "done" event) */
  cost?: number;

  /** Simulated token usage */
  usage?: { input: number; output: number };

  /** If set, yield an error event instead of a response */
  error?: string;
}
```

**What `installMockSession()` does:**

1. Overrides `harness.sessionRegistry.getOrCreate()` to return a
   `MockSessionManager` instead of making real Claude API calls.
2. Calls `harness.chat.setDeps()` with no-op log functions and null optional
   services, so `sendMessage()` runs without external dependencies.

**Default mock stream sequence** (when `response` is set):

```
{ type: "session_init", sessionId: "mock-session-<convId>" }
{ type: "text_delta", text: <response> }
{ type: "done", cost: undefined, usage: undefined }
```

**Error simulation:**

```
{ type: "error", message: <error string> }
{ type: "done" }
```

---

## Migration from HTTP

If your tests or agents currently call the Debug/Admin HTTP API, use this
table to migrate to headless calls. The headless approach is faster (no HTTP
round-trip), works without a running server, and gives you typed return values.

| HTTP route | Headless equivalent |
|------------|---------------------|
| `GET /api/debug/brain/status` | `await app.debug.brainStatus()` |
| `GET /api/debug/brain/prompt` | `await app.debug.systemPrompt()` |
| `GET /api/debug/brain/files` | `await app.debug.brainFiles()` |
| `GET /api/debug/brain/skills` | `await app.debug.skills()` |
| `GET /api/conversations` | `await app.conversations.list()` |
| `GET /api/conversations/:id` | `await app.conversations.get(id)` |
| `POST /api/conversations` | `await app.conversations.create()` |
| `DELETE /api/conversations/:id` | `await app.conversations.delete(id)` |
| `GET /api/tasks` | `app.tasks.list()` |
| `GET /api/tasks/:id` | `app.tasks.findById(id)` |
| `POST /api/tasks` | `app.tasks.create(input)` |
| `PATCH /api/tasks/:id` | `app.tasks.update(id, changes)` |
| `DELETE /api/tasks/:id` | `app.tasks.delete(id)` |
| WebSocket `connect` message | `await app.chat.connect(conversationId)` |
| WebSocket `message` send | `for await (const e of app.chat.sendMessage(...))` |
| WebSocket `new_conversation` | `await app.chat.newConversation()` |
| WebSocket `switch_conversation` | `await app.chat.switchConversation(id)` |
| WebSocket `load_more` | `await app.chat.loadMoreTurns(id, before)` |
| WebSocket `rename_conversation` | `await app.chat.renameConversation(id, title)` |
| WebSocket `delete_conversation` | `await app.chat.deleteConversation(id)` |
| WebSocket `set_model` | `await app.chat.setModel(id, model)` |

**Example migration:**

```typescript
// Before (HTTP)
const res = await fetch("http://localhost:4321/api/debug/brain/status");
const status = await res.json();

// After (headless)
const status = await app.debug.brainStatus();
// status.hatched, status.model, etc. — fully typed
```

---

*Created: M6.10-S4*
*Source files: `packages/dashboard/src/app.ts`, `app-events.ts`, `chat/chat-service.ts`, `debug/app-debug-service.ts`, `debug/debug-queries.ts`, `tests/integration/app-harness.ts`, `tests/integration/mock-session.ts`*
