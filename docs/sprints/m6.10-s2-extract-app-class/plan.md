# M6.10-S2: Extract App Class + Live Update Guarantee

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move all service ownership from `index.ts` (1029 lines) into an `App` class. Every mutation emits an event. StatePublisher subscribes to events instead of being called imperatively. `index.ts` shrinks to ~50 lines.

**Architecture:** App class extends EventEmitter, owns all services, and exposes service namespaces (`.tasks`, `.conversations`, `.calendar`, `.memory`, `.channels`, `.notifications`). Namespaces delegate reads and add event emission on mutations. StatePublisher subscribes to App events and debounces snapshot broadcasts. Fastify adapter creates App, wires WebSocket/REST on top.

**Tech Stack:** TypeScript, Node.js EventEmitter, Fastify, existing service classes (TaskManager, ConversationManager, etc.)

**Design Spec:** `docs/superpowers/specs/2026-03-16-headless-app-design.md`

**Baseline:** 608 tests (67 files, 2 skipped) — must pass at every commit.

---

## File Structure

### New Files
- `packages/dashboard/src/app.ts` — App class, factory, shutdown, service namespaces, event emission
- `packages/dashboard/src/app-events.ts` — Typed event map, event name constants

### Modified Files
- `packages/dashboard/src/index.ts` — shrink from 1029 to ~50 lines
- `packages/dashboard/src/server.ts` — add `app` decorator, remove individual service decorators
- `packages/dashboard/src/state/state-publisher.ts` — subscribe to App events instead of imperative calls
- `packages/dashboard/src/ws/chat-handler.ts` — remove module-level sessionRegistry/connectionRegistry exports, accept from adapter
- `packages/dashboard/src/channels/message-handler.ts` — remove statePublisher dep, mutations go through App
- `packages/dashboard/src/routes/tasks.ts` — mutations via `fastify.app.tasks.*`
- `packages/dashboard/src/routes/calendar.ts` — mutations via `fastify.app.calendar.*`
- `packages/dashboard/src/routes/memory.ts` — mutations via `fastify.app.memory.*`
- `packages/dashboard/src/routes/debug.ts` — use `fastify.app.publishMemoryState()`
- `packages/dashboard/tests/integration/app-harness.ts` — wrap App instead of hand-wiring

### Unchanged
- All service classes (TaskManager, ConversationManager, etc.)
- `public/` frontend
- REST response shapes and WebSocket message format
- All 575 existing unit tests

---

## Task 1: App Event Types

**Files:**
- Create: `packages/dashboard/src/app-events.ts`

- [ ] **Step 1: Create typed event map**

```typescript
// packages/dashboard/src/app-events.ts

import type { Task } from "@my-agent/core";
import type { Conversation } from "./conversations/types.js";

/**
 * Typed event map for the App EventEmitter.
 * Every mutation emits one of these events.
 * StatePublisher and adapters subscribe to these.
 */
export interface AppEventMap {
  // Task mutations
  "task:created": [task: Task];
  "task:updated": [task: Task];
  "task:deleted": [taskId: string];

  // Conversation mutations
  "conversation:created": [conversation: Conversation];
  "conversation:updated": [conversationId: string];
  "conversation:deleted": [conversationId: string];

  // Notification events (forwarded from NotificationService)
  "notification:created": [notification: unknown];

  // Calendar mutations
  "calendar:changed": [];

  // Memory state changes
  "memory:changed": [];

  // Channel events (forwarded from TransportManager)
  "channel:status_changed": [transportId: string, status: unknown];
  "channel:qr_code": [transportId: string, qrDataUrl: string];
  "channel:pairing_code": [transportId: string, pairingCode: string];
  "channel:paired": [transportId: string];

  // Skills
  "skills:changed": [];
}

export type AppEvent = keyof AppEventMap;
```

- [ ] **Step 2: Commit**

```bash
git add packages/dashboard/src/app-events.ts
git commit -m "feat(m6.10-s2): add typed App event map"
```

---

## Task 2: App Class Skeleton

**Files:**
- Create: `packages/dashboard/src/app.ts`
- Reference: `packages/dashboard/src/index.ts` (current initialization logic)

- [ ] **Step 1: Create App class with EventEmitter and service properties**

Create `src/app.ts` with:
- `App` class extending `EventEmitter`
- All service properties that `index.ts` currently owns (taskManager, conversationManager, notificationService, transportManager, memoryDb, syncService, searchService, pluginRegistry, calendarScheduler, workLoopScheduler, abbreviationQueue, taskProcessor, taskScheduler, taskExecutor, logStorage, conversationSearchService, taskSearchService, conversationInitiator, postResponseHooks, healthMonitor)
- `sessionRegistry` as App-owned (moved from chat-handler.ts module singleton)
- `AppOptions` interface with the same config that `main()` currently uses
- `App.create(options: AppOptions): Promise<App>` static factory (body empty for now — just store options)
- `app.shutdown(): Promise<void>` method (body empty for now)
- `readonly agentDir: string`
- `readonly isHatched: boolean`

Key shape:
```typescript
import { EventEmitter } from "node:events";
import type { AppEventMap } from "./app-events.js";

export interface AppOptions {
  agentDir: string;
}

export class App extends EventEmitter {
  readonly agentDir: string;
  readonly isHatched: boolean;

  // Service instances (set during create)
  readonly taskManager: TaskManager | null = null;
  readonly conversationManager: ConversationManager;
  readonly notificationService: NotificationService | null = null;
  // ... all other services

  // Session registry (moved from chat-handler module singleton)
  readonly sessionRegistry: SessionRegistry;

  private constructor(agentDir: string) {
    super();
    this.agentDir = agentDir;
    // ...
  }

  static async create(options: AppOptions): Promise<App> {
    // Empty for now — Task 3 fills this in
    const app = new App(options.agentDir);
    return app;
  }

  async shutdown(): Promise<void> {
    // Empty for now — Task 3 fills this in
  }

  // Typed emit helper
  override emit<K extends keyof AppEventMap>(
    event: K,
    ...args: AppEventMap[K]
  ): boolean {
    return super.emit(event, ...args);
  }

  override on<K extends keyof AppEventMap>(
    event: K,
    listener: (...args: AppEventMap[K]) => void,
  ): this {
    return super.on(event, listener as (...args: any[]) => void);
  }
}
```

- [ ] **Step 2: Write a basic test for App creation**

Create a quick smoke test at the bottom of an existing integration test or as a standalone:

```bash
cd packages/dashboard && npx vitest run tests/integration/app-harness.test.ts 2>/dev/null || echo "No existing test — will add in Task 8"
```

- [ ] **Step 3: Verify existing tests still pass**

```bash
cd packages/dashboard && npx vitest run --reporter=verbose 2>&1 | tail -20
```
Expected: 608 tests pass, 0 fail.

- [ ] **Step 4: Commit**

```bash
git add packages/dashboard/src/app.ts
git commit -m "feat(m6.10-s2): App class skeleton with typed EventEmitter"
```

---

## Task 3: Move Service Instantiation into App.create()

**Files:**
- Modify: `packages/dashboard/src/app.ts`
- Reference: `packages/dashboard/src/index.ts:86-862` (the full `main()` function)

This is the largest task. Move ALL service creation from `index.ts:main()` into `App.create()`, preserving the exact initialization order.

- [ ] **Step 1: Study index.ts initialization order**

Read `packages/dashboard/src/index.ts` carefully. The initialization order is:
1. `findAgentDir()`, `isHatched()`
2. `resolveAuth()` (if hatched)
3. `initPromptBuilder()` (if hatched)
4. `ConversationManager` + startup cleanup
5. `AbbreviationQueue` (if hatched + API key)
6. `TransportManager` + plugins + message handler (if hatched)
7. `TaskManager`, `TaskLogStorage`, `TaskExecutor`, `TaskProcessor`, `TaskScheduler` (if hatched)
8. `NotificationService` + event wiring (if hatched)
9. `PostResponseHooks` (if hatched)
10. `CalendarScheduler` (if hatched + config)
11. `ConversationInitiator` (if hatched + transport)
12. `WorkLoopScheduler` (if hatched)
13. `StatePublisher` (if hatched)
14. Memory system: `initNotebook`, `PluginRegistry`, `MemoryDb`, `SyncService`, `SearchService` (if hatched)
15. `ConversationSearchDB`, `ConversationSearchService`
16. `initMcpServers()` (if searchService exists)
17. `checkSkillsHealth()`
18. `TaskSearchService`
19. Task-tools MCP server + skill MCP server
20. `HealthMonitor`

- [ ] **Step 2: Move initialization into App.create()**

Copy the initialization logic from `index.ts:main()` into `App.create()`. The App constructor should take `agentDir` and perform all initialization. Key rules:

- **Preserve exact order** — services depend on each other
- **All `let` variables become App properties** — `taskManager`, `conversationManager`, etc.
- **Lazy references stay lazy** — e.g., `get mcpServers() { return getSharedMcpServers() }` — keep this pattern
- **Do NOT change any service constructors** — just move the instantiation
- **sessionRegistry**: Create in App constructor instead of importing from chat-handler.ts

Import `SessionRegistry` from `../agent/session-registry.js`:
```typescript
import { SessionRegistry } from "./agent/session-registry.js";

// In constructor:
this.sessionRegistry = new SessionRegistry(5);
```

- [ ] **Step 3: Move shutdown logic into App.shutdown()**

Copy the shutdown logic from `index.ts:964-1019` into `app.shutdown()`:
```typescript
async shutdown(): Promise<void> {
  if (this.workLoopScheduler) await this.workLoopScheduler.stop();
  if (this.taskScheduler) this.taskScheduler.stop();
  if (this.calendarScheduler) this.calendarScheduler.stop();
  if (this.transportManager) await this.transportManager.disconnectAll();
  if (this.abbreviationQueue) await this.abbreviationQueue.drain();
  if (this.healthMonitor) this.healthMonitor.stop();
  if (this.syncService) this.syncService.stopWatching();
  if (this.memoryDb) this.memoryDb.close();
  this.conversationManager.close();
}
```

- [ ] **Step 4: Verify existing tests still pass**

```bash
cd packages/dashboard && npx vitest run --reporter=verbose 2>&1 | tail -20
```

Note: At this point, `index.ts` still has its own initialization. We haven't wired the App yet — that's Task 7. This task just gets App.create() working.

- [ ] **Step 5: Commit**

```bash
git add packages/dashboard/src/app.ts
git commit -m "feat(m6.10-s2): move service instantiation into App.create()"
```

---

## Task 4: Service Namespaces with Event Emission

**Files:**
- Modify: `packages/dashboard/src/app.ts`

Add service namespace objects that wrap underlying managers and emit events on mutations. These are the **only** way external code should mutate state.

- [ ] **Step 1: Add TaskService namespace**

```typescript
export class TaskService {
  constructor(
    private manager: TaskManager,
    private app: App,
  ) {}

  // Read-through (no events needed)
  list() { return this.manager.list(); }
  get(id: string) { return this.manager.get(id); }
  getRunningTasksForConversation(convId: string) {
    return this.manager.getRunningTasksForConversation(convId);
  }

  // Mutations (emit events)
  async create(input: Parameters<TaskManager["create"]>[0]): Promise<Task> {
    const task = await this.manager.create(input);
    this.app.emit("task:created", task);
    return task;
  }

  update(id: string, patch: Parameters<TaskManager["update"]>[1]): Task {
    const task = this.manager.update(id, patch);
    this.app.emit("task:updated", task);
    return task;
  }

  delete(id: string): void {
    this.manager.delete(id);
    this.app.emit("task:deleted", id);
  }

  linkTaskToConversation(taskId: string, conversationId: string): void {
    this.manager.linkTaskToConversation(taskId, conversationId);
    // Linking changes task state — emit updated
    const task = this.manager.get(taskId);
    if (task) this.app.emit("task:updated", task);
  }
}
```

- [ ] **Step 2: Add ConversationService namespace**

```typescript
export class ConversationService {
  constructor(
    private manager: ConversationManager,
    private app: App,
  ) {}

  // Read-through
  list(opts?: Parameters<ConversationManager["list"]>[0]) {
    return this.manager.list(opts);
  }
  get(id: string) { return this.manager.get(id); }
  getDb() { return this.manager.getDb(); }
  getConversationDb() { return this.manager.getConversationDb(); }

  // Mutations
  async create(opts?: Parameters<ConversationManager["create"]>[0]) {
    const conv = await this.manager.create(opts);
    this.app.emit("conversation:created", conv);
    return conv;
  }

  async delete(id: string) {
    await this.manager.delete(id);
    this.app.emit("conversation:deleted", id);
  }

  async makeCurrent(id: string) {
    await this.manager.makeCurrent(id);
    this.app.emit("conversation:updated", id);
  }

  async pin(id: string) {
    await this.manager.pin(id);
    this.app.emit("conversation:updated", id);
  }

  async unpin(id: string) {
    await this.manager.unpin(id);
    this.app.emit("conversation:updated", id);
  }

  // Delegate other methods that don't need events
  // (transcript operations, addTurn, etc. — these are read/write
  // within an existing conversation, not state mutations)
  get onConversationInactive() { return this.manager.onConversationInactive; }
  set onConversationInactive(cb) { this.manager.onConversationInactive = cb; }
}
```

Important: ConversationManager has many methods (addTurn, getTranscript, etc.). Only wrap mutation methods that change the conversation list state. Internal transcript operations don't need events — they're within an already-tracked conversation.

- [ ] **Step 3: Add CalendarService namespace**

```typescript
export class CalendarService {
  constructor(private app: App) {}

  // Calendar mutations go through the caldav client
  // Just emit a generic "changed" event after any mutation
  emitChanged(): void {
    this.app.emit("calendar:changed");
  }
}
```

Calendar is different — mutations go through the CalDAV client directly in routes. The namespace just provides the emit method. Routes call `app.calendar.emitChanged()` after mutations.

- [ ] **Step 4: Add MemoryService namespace**

```typescript
export class MemoryService {
  constructor(private app: App) {}

  emitChanged(): void {
    this.app.emit("memory:changed");
  }
}
```

Memory mutations (plugin activation, sync, etc.) are complex multi-step operations. The namespace provides emit, routes call it after completing the operation.

- [ ] **Step 5: Wire namespaces in App**

In `App.create()`, after services are initialized:
```typescript
app.tasks = new TaskService(app.taskManager!, app);
app.conversations = new ConversationService(app.conversationManager, app);
app.calendar = new CalendarService(app);
app.memory = new MemoryService(app);
```

- [ ] **Step 6: Wire forwarded events**

In `App.create()`, subscribe to existing service events and re-emit as App events:

```typescript
// Forward NotificationService events
if (app.notificationService) {
  app.notificationService.on("notification", (event) => {
    app.emit("notification:created", event.notification);
  });
}

// Forward TransportManager events
if (app.transportManager) {
  app.transportManager.onStatusChange((transportId, status) => {
    app.emit("channel:status_changed", transportId, status);
  });
  app.transportManager.onQrCode((transportId, qrDataUrl) => {
    app.emit("channel:qr_code", transportId, qrDataUrl);
  });
  app.transportManager.onPairingCode((transportId, pairingCode) => {
    app.emit("channel:pairing_code", transportId, pairingCode);
  });
  app.transportManager.onPaired((transportId) => {
    app.emit("channel:paired", transportId);
  });
}

// Forward SyncService events
if (app.syncService) {
  app.syncService.on("sync", () => {
    app.emit("memory:changed");
  });
}
```

**Important:** These forwarded events REPLACE the direct `connectionRegistry.broadcastToAll()` calls currently in `index.ts:232-265` (channels) and `index.ts:337-364` (notifications). Those coupling points are now broken — business events flow through App, not directly to WebSocket.

- [ ] **Step 6b: Wire TaskProcessor's onTaskMutated through App events**

The `TaskProcessor` constructor currently receives `onTaskMutated: () => server.statePublisher?.publishTasks()`. This is a mutation path that bypasses App events. In `App.create()`, wire it through the App:

```typescript
taskProcessor = new TaskProcessor({
  // ...
  onTaskMutated: () => app.emit("task:updated", null as any),
  // ...
});
```

Alternatively, if TaskProcessor calls `taskManager.update()` internally, the TaskService namespace will already emit the event. Verify by checking TaskProcessor's code — if it mutates via `taskManager`, the namespace handles it. If it calls `onTaskMutated` as an ADDITIONAL signal (e.g., after task execution completes), then wire it as above.

- [ ] **Step 6c: Wire index.ts memory publish paths through App events**

Three `publishMemory()` calls in current `index.ts` (lines 560, 701, 937):
- **Line 560** (`ollamaPlugin.onDegraded`) → In App.create(), wire: `onDegraded: () => app.emit("memory:changed")`
- **Line 701** (`syncService.on("sync")`) → Already covered by Step 6 SyncService forwarding
- **Line 937** (`healthMonitor health_changed`) → In App.create(), after health monitor recovery/degradation: `app.emit("memory:changed")`

- [ ] **Step 7: Verify existing tests still pass**

```bash
cd packages/dashboard && npx vitest run --reporter=verbose 2>&1 | tail -20
```

- [ ] **Step 8: Commit**

```bash
git add packages/dashboard/src/app.ts
git commit -m "feat(m6.10-s2): service namespaces with event emission on mutations"
```

---

## Task 5: Convert StatePublisher to App Event Subscriber

**Files:**
- Modify: `packages/dashboard/src/state/state-publisher.ts`
- Modify: `packages/dashboard/src/app.ts` (wire subscription)

- [ ] **Step 1: Add App subscription method to StatePublisher**

Add a new constructor option and method:

```typescript
export interface StatePublisherOptions {
  connectionRegistry: ConnectionRegistry;
  taskManager: TaskManager | null;
  conversationManager: ConversationManager | null;
  getCalendarClient: (() => ReturnType<typeof createCalDAVClient> | null) | null;
}

// Add to class:
/**
 * Subscribe to App events for automatic state publishing.
 * Replaces all imperative publishX() calls.
 */
subscribeToApp(app: import("../app.js").App): void {
  // Task events → debounced task snapshot
  app.on("task:created", () => this.publishTasks());
  app.on("task:updated", () => this.publishTasks());
  app.on("task:deleted", () => this.publishTasks());

  // Conversation events → debounced conversation snapshot
  app.on("conversation:created", () => this.publishConversations());
  app.on("conversation:updated", () => this.publishConversations());
  app.on("conversation:deleted", () => this.publishConversations());

  // Calendar events → debounced calendar snapshot
  app.on("calendar:changed", () => this.publishCalendar());

  // Memory events → debounced memory snapshot
  app.on("memory:changed", () => this.publishMemory());

  // Skills events → broadcast skills changed
  app.on("skills:changed", () => {
    this.registry.broadcastToAll({
      type: "state:skills",
      timestamp: Date.now(),
    });
  });
}
```

Note: The existing `publishTasks()`, `publishCalendar()`, `publishConversations()`, `publishMemory()` methods stay unchanged — they still do debounced broadcasting internally. The only change is HOW they get triggered (events instead of imperative calls).

- [ ] **Step 2: Wire subscription in App.create()**

In `app.ts`, after StatePublisher is created:
```typescript
if (app.statePublisher) {
  app.statePublisher.subscribeToApp(app);
}
```

- [ ] **Step 3: Verify existing tests still pass**

```bash
cd packages/dashboard && npx vitest run --reporter=verbose 2>&1 | tail -20
```

At this point, both imperative calls AND event subscriptions are active (double-firing). This is safe because StatePublisher debounces. The imperative calls will be removed in Task 6.

- [ ] **Step 4: Commit**

```bash
git add packages/dashboard/src/state/state-publisher.ts packages/dashboard/src/app.ts
git commit -m "feat(m6.10-s2): StatePublisher subscribes to App events"
```

---

## Task 6: Update Routes to Use App Mutation Methods

**Files:**
- Modify: `packages/dashboard/src/server.ts`
- Modify: `packages/dashboard/src/routes/tasks.ts`
- Modify: `packages/dashboard/src/routes/calendar.ts`
- Modify: `packages/dashboard/src/routes/memory.ts`
- Modify: `packages/dashboard/src/routes/debug.ts`
- Modify: `packages/dashboard/src/ws/chat-handler.ts`
- Modify: `packages/dashboard/src/channels/message-handler.ts`

### Sub-task 6a: Add App decorator to Fastify

- [ ] **Step 1: Add app to Fastify type augmentation**

In `server.ts`, add to the FastifyInstance augmentation:
```typescript
declare module "fastify" {
  interface FastifyInstance {
    app: import("./app.js").App | null;
    // ... keep all existing decorators for now
  }
}
```

And in `createServer()`:
```typescript
fastify.decorate("app", null);
```

- [ ] **Step 2: Commit**

```bash
git add packages/dashboard/src/server.ts
git commit -m "feat(m6.10-s2): add app decorator to Fastify"
```

### Sub-task 6b: Update task routes

- [ ] **Step 3: Replace task mutations with App methods**

In `routes/tasks.ts`, change mutation patterns:

**Before (4 locations):**
```typescript
const task = await fastify.taskManager!.create(input);
fastify.statePublisher?.publishTasks();
```

**After:**
```typescript
const task = await fastify.app!.tasks.create(input);
// No publishTasks() — event subscription handles it
```

Apply to all 4 mutation endpoints:
1. POST `/api/tasks` (create) — line ~295-302
2. PATCH `/api/tasks/:id` (update status) — lines ~330-346
3. POST `/api/tasks/:id/complete` — lines ~370-383
4. DELETE `/api/tasks/:id` — lines ~410-417

For each: replace `fastify.taskManager!.xxx()` + `fastify.statePublisher?.publishTasks()` with `fastify.app!.tasks.xxx()`.

For **read** operations (GET /api/tasks, GET /api/tasks/:id), you can use either `fastify.app!.tasks.list()` or `fastify.taskManager!.list()`. Prefer `fastify.app!.tasks.list()` for consistency.

- [ ] **Step 4: Verify tests pass**

```bash
cd packages/dashboard && npx vitest run --reporter=verbose 2>&1 | tail -20
```

- [ ] **Step 5: Commit**

```bash
git add packages/dashboard/src/routes/tasks.ts
git commit -m "feat(m6.10-s2): task routes use App mutation methods"
```

### Sub-task 6c: Update calendar routes

- [ ] **Step 6: Replace calendar mutations**

In `routes/calendar.ts`, at the 3 mutation endpoints (create, update, delete):

**Before:**
```typescript
await client.createEvent(calendarId, eventInput);
fastify.statePublisher?.publishCalendar();
```

**After:**
```typescript
await client.createEvent(calendarId, eventInput);
fastify.app!.calendar.emitChanged();
// No publishCalendar() — event subscription handles it
```

Apply to all 3 endpoints (~lines 412, 490, 551).

- [ ] **Step 7: Commit**

```bash
git add packages/dashboard/src/routes/calendar.ts
git commit -m "feat(m6.10-s2): calendar routes use App event emission"
```

### Sub-task 6d: Update memory routes

- [ ] **Step 8: Replace memory mutations**

In `routes/memory.ts`, at all 5 locations where `publishMemory()` is called:

**Before:**
```typescript
await pluginRegistry.setActive(pluginId);
fastify.statePublisher?.publishMemory();
```

**After:**
```typescript
await pluginRegistry.setActive(pluginId);
fastify.app!.memory.emitChanged();
// No publishMemory() — event subscription handles it
```

Apply to all 5 locations (~lines 43, 246, 289, 435, 489).

- [ ] **Step 9: Update debug route**

In `routes/debug.ts` (~line 1103), the `publishMemory()` is a manual trigger endpoint. Replace:
```typescript
// Before
statePublisher.publishMemory();

// After — this is an admin endpoint, just emit the event
fastify.app!.memory.emitChanged();
```

- [ ] **Step 10: Commit**

```bash
git add packages/dashboard/src/routes/memory.ts packages/dashboard/src/routes/debug.ts
git commit -m "feat(m6.10-s2): memory routes use App event emission"
```

### Sub-task 6e: Update chat-handler conversation mutations

- [ ] **Step 11: Pass App to chat-handler**

The chat-handler currently imports `connectionRegistry` and `sessionRegistry` as module singletons. For S2:
- `sessionRegistry`: should come from App. Modify `registerChatWebSocket(fastify)` to get it from `fastify.app!.sessionRegistry`.
- `connectionRegistry`: stays as module singleton for now (it's transport-layer, full extraction is S3).
- Conversation mutations (5 locations) should use `fastify.app!.conversations.*`.

In `chat-handler.ts`, at the top where the module singletons are:
```typescript
// BEFORE:
export const sessionRegistry = new SessionRegistry(5);

// AFTER:
// sessionRegistry is now owned by App — accessed via fastify.app.sessionRegistry
// Keep the export for backward compat during transition, but make it a getter
// that reads from the App instance (set during registerChatWebSocket)
let _sessionRegistry: SessionRegistry | null = null;
export function getSessionRegistry(): SessionRegistry {
  if (!_sessionRegistry) throw new Error("sessionRegistry not initialized");
  return _sessionRegistry;
}
```

In `registerChatWebSocket(fastify)`:
```typescript
_sessionRegistry = fastify.app!.sessionRegistry;
```

- [ ] **Step 12: Replace conversation mutations in chat-handler**

At all 5 `publishConversations()` call sites in chat-handler.ts:

**Line ~629 (new conversation on connect):**
```typescript
// Before:
const conv = await conversationManager.create();
fastify.statePublisher?.publishConversations();

// After:
const conv = await fastify.app!.conversations.create();
// publishConversations removed — event handles it
```

**Line ~660 (switch conversation):**
```typescript
// Before:
await conversationManager.makeCurrent(conversationId);
fastify.statePublisher?.publishConversations();

// After:
await fastify.app!.conversations.makeCurrent(conversationId);
```

**Line ~798 (delete conversation):**
```typescript
// Before:
await conversationManager.delete(conversationId);
fastify.statePublisher?.publishConversations();

// After:
await fastify.app!.conversations.delete(conversationId);
```

**Line ~903 (/new slash command):**
```typescript
// Before:
const conv = await conversationManager.create();
fastify.statePublisher?.publishConversations();

// After:
const conv = await fastify.app!.conversations.create();
```

**Line ~1027 (new conversation on message):**
```typescript
// Before:
const conv = await conversationManager.create();
fastify.statePublisher?.publishConversations();

// After:
const conv = await fastify.app!.conversations.create();
```

**Important:** The `connectionRegistry.broadcastToAll({ type: "conversation_created" })` calls that PRECEDE some of these publish calls should STAY — they're point-to-point WS messages (not state snapshots). Only remove the `publishConversations()` calls.

- [ ] **Step 13: Verify tests pass**

```bash
cd packages/dashboard && npx vitest run --reporter=verbose 2>&1 | tail -20
```

- [ ] **Step 14: Commit**

```bash
git add packages/dashboard/src/ws/chat-handler.ts
git commit -m "feat(m6.10-s2): chat-handler uses App for conversation mutations + sessionRegistry"
```

### Sub-task 6f: Update message-handler

- [ ] **Step 15: Replace conversation mutations in message-handler**

In `channels/message-handler.ts`, the `statePublisher` dep in the constructor options can be removed. The 3 `publishConversations()` calls (~lines 365, 443, 472) are replaced by using App conversation methods.

The message-handler currently receives deps via constructor. Add `app` to deps:
```typescript
interface MessageHandlerDeps {
  app: App;  // NEW
  conversationManager: ConversationManager;
  sessionRegistry: SessionRegistry;
  connectionRegistry: ConnectionRegistry;
  // ... rest stay
  // REMOVE: statePublisher
}
```

Replace mutation calls:
```typescript
// Before:
const conv = await this.deps.conversationManager.create({...});
this.deps.statePublisher?.publishConversations();

// After:
const conv = await this.deps.app.conversations.create({...});
```

- [ ] **Step 16: Commit**

```bash
git add packages/dashboard/src/channels/message-handler.ts
git commit -m "feat(m6.10-s2): message-handler uses App for conversation mutations"
```

---

## Task 7: Break Coupling Points + Slim index.ts

**Files:**
- Modify: `packages/dashboard/src/index.ts` (major rewrite)
- Modify: `packages/dashboard/src/app.ts` (channel event wiring)
- Modify: `packages/dashboard/src/server.ts` (remove individual decorators)

- [ ] **Step 1: Rewrite index.ts**

Replace the 1029-line `index.ts` with ~50 lines:

```typescript
import { App } from "./app.js";
import { createServer } from "./server.js";
import { findAgentDir } from "@my-agent/core";
import { connectionRegistry } from "./ws/chat-handler.js";

// Clear CLAUDECODE env var for nested claude processes
delete process.env.CLAUDECODE;

process.on("unhandledRejection", (reason) => {
  const msg = reason instanceof Error ? reason.message : String(reason ?? "unknown");
  console.error(`[Server] Unhandled rejection: ${msg}`);
  if (reason instanceof Error && reason.stack) {
    console.error(`[Server] Stack: ${reason.stack}`);
  }
});

async function main() {
  const agentDir = findAgentDir();

  // Create headless App (owns all services)
  const app = await App.create({ agentDir });

  // Create Fastify adapter (HTTP + WebSocket transport)
  const port = parseInt(process.env.PORT ?? "4321", 10);
  const server = await createServer({ agentDir });

  // Wire App to Fastify
  server.app = app;

  // Wire backward-compat decorators (routes still use fastify.taskManager etc.)
  server.isHatched = app.isHatched;
  server.conversationManager = app.conversationManager;
  server.taskManager = app.taskManager;
  server.logStorage = app.logStorage;
  server.taskProcessor = app.taskProcessor;
  server.taskScheduler = app.taskScheduler;
  server.calendarScheduler = app.calendarScheduler;
  server.notificationService = app.notificationService;
  server.statePublisher = app.statePublisher;
  server.memoryDb = app.memoryDb;
  server.syncService = app.syncService;
  server.searchService = app.searchService;
  server.pluginRegistry = app.pluginRegistry;
  server.conversationSearchService = app.conversationSearchService;
  server.workLoopScheduler = app.workLoopScheduler;
  server.conversationInitiator = app.conversationInitiator;
  server.postResponseHooks = app.postResponseHooks;
  server.taskSearchService = app.taskSearchService;
  server.abbreviationQueue = app.abbreviationQueue;
  server.transportManager = app.transportManager;
  server.channelMessageHandler = app.channelMessageHandler;

  // Wire channel events to WS broadcasts (adapter layer)
  app.on("channel:status_changed", (transportId, status) => {
    connectionRegistry.broadcastToAll({
      type: "transport_status_changed",
      transportId,
      status,
    });
  });
  app.on("channel:qr_code", (transportId, qrDataUrl) => {
    connectionRegistry.broadcastToAll({
      type: "transport_qr_code",
      transportId,
      qrDataUrl,
    });
  });
  app.on("channel:pairing_code", (transportId, pairingCode) => {
    connectionRegistry.broadcastToAll({
      type: "transport_pairing_code",
      transportId,
      pairingCode,
    });
  });
  app.on("channel:paired", (transportId) => {
    connectionRegistry.broadcastToAll({
      type: "transport_paired",
      transportId,
    });
  });

  // Wire notification events to WS broadcasts (adapter layer)
  app.on("notification:created", (notification) => {
    connectionRegistry.broadcastToAll({
      type: "notification",
      notification: {
        id: notification.id,
        type: notification.type,
        taskId: notification.taskId,
        created: notification.created.toISOString(),
        status: notification.status,
        // Spread type-specific fields
        ...(notification.type === "notify" && {
          message: notification.message,
          importance: notification.importance,
        }),
        ...(notification.type === "request_input" && {
          question: notification.question,
          options: notification.options,
          response: notification.response,
          respondedAt: notification.respondedAt?.toISOString(),
        }),
        ...(notification.type === "escalate" && {
          problem: notification.problem,
          severity: notification.severity,
        }),
      },
    });
  });

  try {
    await server.listen({ port, host: "0.0.0.0" });
    console.log(`\nDashboard running at http://localhost:${port}`);
    console.log("Press Ctrl+C to stop\n");
  } catch (err) {
    console.error("Failed to start server:", err);
    process.exit(1);
  }

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    console.log(`\n${signal} received, shutting down gracefully...`);
    try {
      await app.shutdown();
      await server.close();
      console.log("Server closed.");
      process.exit(0);
    } catch (err) {
      console.error("Error during shutdown:", err);
      process.exit(1);
    }
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
```

Note: This is ~100 lines, not 50. The backward-compat decorator wiring adds lines. The channel/notification event → WS broadcast wiring belongs in the adapter layer (index.ts), not in App. This is correct — App emits business events, the adapter translates them to transport-specific broadcasts.

- [ ] **Step 2: Remove stale imports from index.ts**

Delete all the import lines that are now in app.ts. The index.ts should only import `App`, `createServer`, `findAgentDir`, and `connectionRegistry`.

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd packages/dashboard && npx tsc --noEmit 2>&1 | head -30
```

Fix any type errors.

- [ ] **Step 4: Verify all tests pass**

```bash
cd packages/dashboard && npx vitest run --reporter=verbose 2>&1 | tail -20
```

- [ ] **Step 5: Commit**

```bash
git add packages/dashboard/src/index.ts packages/dashboard/src/app.ts packages/dashboard/src/server.ts
git commit -m "feat(m6.10-s2): slim index.ts — App owns services, adapter wires transport"
```

---

## Task 8: Update AppHarness + Integration Tests

**Files:**
- Modify: `packages/dashboard/tests/integration/app-harness.ts`
- Modify: `packages/dashboard/tests/integration/live-update-audit.test.ts`
- Create: `packages/dashboard/tests/integration/app-events.test.ts`

- [ ] **Step 1: Update AppHarness to use App**

The current `AppHarness` manually wires services (same as old index.ts). Now it should create an `App` instance:

```typescript
import { App } from "../../src/app.js";

export class AppHarness {
  readonly app: App;
  readonly connectionRegistry: ConnectionRegistry;
  readonly broadcasts: CapturedBroadcast[] = [];

  // Expose convenience accessors
  get conversationManager() { return this.app.conversationManager; }
  get taskManager() { return this.app.taskManager; }
  get notificationService() { return this.app.notificationService; }
  get statePublisher() { return this.app.statePublisher; }
  // ... etc

  private constructor(app: App) {
    this.app = app;
    // Wire broadcast capture on the app's statePublisher
    // ...
  }

  static async create(options?: AppHarnessOptions): Promise<AppHarness> {
    // Create temp agentDir, init notebook if needed
    const agentDir = fs.mkdtempSync(...);
    fs.mkdirSync(path.join(agentDir, "brain"), { recursive: true });
    // ... same directory setup as before

    const app = await App.create({ agentDir });
    return new AppHarness(app);
  }

  async shutdown(): Promise<void> {
    await this.app.shutdown();
    fs.rmSync(this.app.agentDir, { recursive: true, force: true });
  }
}
```

**Important:** The broadcast capture mechanism needs to work differently now. Instead of intercepting `connectionRegistry.broadcastToAll`, listen to App events:
```typescript
// Capture all events for assertion
this.app.on("task:created", (task) => this.broadcasts.push({ type: "task:created", task }));
this.app.on("task:updated", (task) => this.broadcasts.push({ type: "task:updated", task }));
// ... all events
```

But the S1 tests check for WS-protocol-style broadcasts (`{ type: "state:tasks", tasks: [...] }`). The existing tests should keep working. Two options:

**Option A:** Keep the old broadcast interception for backward compat, add new event capture alongside.
**Option B:** Update S1 tests to assert on App events instead.

**Choose Option A** for safety — keeps S1 tests green, adds new event assertions separately.

- [ ] **Step 2: Write App event emission tests**

New test file `tests/integration/app-events.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { AppHarness } from "./app-harness.js";

describe("App Event Emission (Live Update Guarantee)", () => {
  let harness: AppHarness;

  beforeEach(async () => {
    harness = await AppHarness.create();
  });

  afterEach(async () => {
    await harness.shutdown();
  });

  describe("Task mutations", () => {
    it("emits task:created on create", async () => {
      const events: any[] = [];
      harness.app.on("task:created", (task) => events.push(task));

      const task = await harness.app.tasks.create({
        title: "Test task",
        instructions: "Do the thing",
        type: "immediate",
      });

      expect(events).toHaveLength(1);
      expect(events[0].id).toBe(task.id);
      expect(events[0].title).toBe("Test task");
    });

    it("emits task:updated on update", async () => {
      const events: any[] = [];
      harness.app.on("task:updated", (task) => events.push(task));

      const task = await harness.app.tasks.create({
        title: "Test task",
        instructions: "Do it",
        type: "immediate",
      });
      harness.app.tasks.update(task.id, { status: "completed", completedAt: new Date() });

      expect(events).toHaveLength(1);
      expect(events[0].status).toBe("completed");
    });

    it("emits task:deleted on delete", async () => {
      const events: string[] = [];
      harness.app.on("task:deleted", (id) => events.push(id));

      const task = await harness.app.tasks.create({
        title: "Test task",
        instructions: "Do it",
        type: "immediate",
      });
      harness.app.tasks.delete(task.id);

      expect(events).toHaveLength(1);
      expect(events[0]).toBe(task.id);
    });
  });

  describe("Conversation mutations", () => {
    it("emits conversation:created on create", async () => {
      const events: any[] = [];
      harness.app.on("conversation:created", (conv) => events.push(conv));

      const conv = await harness.app.conversations.create();

      expect(events).toHaveLength(1);
      expect(events[0].id).toBe(conv.id);
    });

    it("emits conversation:deleted on delete", async () => {
      const events: string[] = [];
      harness.app.on("conversation:deleted", (id) => events.push(id));

      const conv = await harness.app.conversations.create();
      await harness.app.conversations.delete(conv.id);

      expect(events).toHaveLength(1);
      expect(events[0]).toBe(conv.id);
    });

    it("emits conversation:updated on makeCurrent", async () => {
      const events: string[] = [];
      harness.app.on("conversation:updated", (id) => events.push(id));

      const conv = await harness.app.conversations.create();
      await harness.app.conversations.makeCurrent(conv.id);

      expect(events).toHaveLength(1);
      expect(events[0]).toBe(conv.id);
    });
  });

  describe("Structural guarantee", () => {
    it("every task mutation emits an event (audit)", async () => {
      const events: string[] = [];
      harness.app.on("task:created", () => events.push("created"));
      harness.app.on("task:updated", () => events.push("updated"));
      harness.app.on("task:deleted", () => events.push("deleted"));

      // Create
      const task = await harness.app.tasks.create({
        title: "Audit task",
        instructions: "Verify",
        type: "immediate",
      });
      expect(events).toContain("created");

      // Update
      harness.app.tasks.update(task.id, { status: "running", startedAt: new Date() });
      expect(events).toContain("updated");

      // Delete
      harness.app.tasks.delete(task.id);
      expect(events).toContain("deleted");

      expect(events).toEqual(["created", "updated", "deleted"]);
    });

    it("every conversation mutation emits an event (audit)", async () => {
      const events: string[] = [];
      harness.app.on("conversation:created", () => events.push("created"));
      harness.app.on("conversation:updated", () => events.push("updated"));
      harness.app.on("conversation:deleted", () => events.push("deleted"));

      const conv = await harness.app.conversations.create();
      await harness.app.conversations.makeCurrent(conv.id);
      await harness.app.conversations.delete(conv.id);

      expect(events).toEqual(["created", "updated", "deleted"]);
    });
  });
});
```

- [ ] **Step 3: Run new tests**

```bash
cd packages/dashboard && npx vitest run tests/integration/app-events.test.ts --reporter=verbose
```
Expected: All pass.

- [ ] **Step 4: Run full test suite**

```bash
cd packages/dashboard && npx vitest run --reporter=verbose 2>&1 | tail -20
```
Expected: 608+ tests pass (original 608 + new event tests).

- [ ] **Step 5: Commit**

```bash
git add packages/dashboard/tests/integration/
git commit -m "feat(m6.10-s2): update AppHarness to use App + event emission tests"
```

---

## Task 9: Full Verification + External Review

- [ ] **Step 1: TypeScript compilation check**

```bash
cd packages/dashboard && npx tsc --noEmit
```
Expected: 0 errors.

- [ ] **Step 2: Full test suite**

```bash
cd packages/dashboard && npx vitest run --reporter=verbose
```
Expected: All tests pass (608 original + new event tests).

- [ ] **Step 3: Verify no imperative statePublisher calls remain in business code**

```bash
cd packages/dashboard && grep -rn "publishTasks\|publishConversations\|publishCalendar\|publishMemory" src/ --include="*.ts" | grep -v "state-publisher.ts" | grep -v "node_modules"
```
Expected: Only the debug.ts manual trigger endpoint should remain (if kept), and the `subscribeToApp` method in state-publisher.ts. NO calls from routes, chat-handler, message-handler, or index.ts.

- [ ] **Step 4: Verify index.ts is slim**

```bash
wc -l packages/dashboard/src/index.ts
```
Expected: ~100 lines (includes backward-compat decorator wiring).

- [ ] **Step 5: Browser verification**

Start the dashboard and verify in a browser:
```bash
systemctl --user restart nina-dashboard.service
```
Open the dashboard in a browser. Test:
- Create a conversation → should appear in sidebar
- Send a message → should stream response
- Create a task (if possible via UI) → should appear in tasks panel
- Verify live updates work (changes reflect without page reload)

- [ ] **Step 6: Dispatch external reviewer**

Follow `docs/procedures/external-reviewer.md`. Provide:
- Design spec: `docs/superpowers/specs/2026-03-16-headless-app-design.md`
- Sprint plan: `docs/sprints/m6.10-s2-extract-app-class/plan.md`
- `git diff master...HEAD`
- Test results
- File list: `git diff --name-only master...HEAD`

External reviewer writes `review.md` and `test-report.md` in the sprint directory.

- [ ] **Step 7: Notify CTO**

"Sprint complete. Run `/trip-review` when ready."

---

## Risk Mitigation Notes

1. **Initialization order**: `App.create()` MUST preserve the exact same order as current `index.ts:main()`. If tests fail mysteriously, compare the order line by line.

2. **Lazy references**: Several services use lazy getters (e.g., `get mcpServers() { return getSharedMcpServers() }`). These MUST stay lazy — don't eagerly resolve them during init.

3. **Module singletons**: `connectionRegistry` stays as a module singleton in chat-handler.ts for S2. Full extraction to adapter is S3 scope. `sessionRegistry` moves to App.

4. **Double-firing during transition**: Between Task 5 (subscription added) and Task 6 (imperative calls removed), state publishes may fire twice per mutation. This is safe due to debouncing (100ms window). Both triggers resolve to the same snapshot.

5. **Chat-handler complexity**: Chat-handler has 900+ lines and complex streaming state. For S2, only change the 5 conversation mutation call sites. Do NOT touch streaming logic, skill expansion, or message handling. That's S3.
