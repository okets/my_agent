# M6.10 Headless App — Design Spec

> **Status:** Draft
> **Author:** CTO + Claude
> **Date:** 2026-03-16
> **Depends on:** M6.8 (skills architecture), M6.7 (two-agent refactor)

---

## Summary

Extract a headless `App` class from the dashboard so the application can be driven programmatically — by agents, tests, or future interfaces — without HTTP or WebSocket transport. The web dashboard becomes a thin adapter over the App. Business behavior gets integration tests for the first time.

---

## Core Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | **`App` class in `packages/dashboard/src/app.ts`** — no new package | Avoid overengineering. A new package is warranted only when there's a real second consumer (mobile backend). Until then, one class in the existing package. |
| 2 | **Tests first, then extract** | Write App-level integration tests against the current code (via thin wrapper), then extract. Tests prove no degradation. Refactoring without tests is guessing. |
| 3 | **EventEmitter for all output** | App emits events (`text_delta`, `task_updated`, `conversation_created`, `state:tasks`, etc.). Adapters subscribe. No direct broadcast calls inside business logic. |
| 4 | **App owns registries** | `connectionRegistry` and `sessionRegistry` move from module-level singletons to App-owned instances. Multiple App instances can coexist (critical for parallel tests). |
| 5 | **Fastify adapter is thin** | Routes do `app.tasks.list()`, not business logic. WS handler subscribes to App events and forwards as JSON. No logic in the adapter layer. |
| 6 | **Existing 476 tests must pass throughout** | Service-level tests are the safety net. They must stay green at every commit. Any red is a stop-the-line event. |
| 7 | **Chat handler decomposition** | The 900-line `chat-handler.ts` splits into App-owned chat logic (streaming state machine, skill expansion, conversation switching) and a WS transport adapter. The streaming state machine is the highest-risk extraction. |
| 8 | **Mutations go through App, live updates are structural** | Every state mutation goes through an App method. Every App method emits an event after mutating. Adapters subscribe to events and push to clients. No route or service can mutate state without triggering a live update — it's architecturally impossible, not a convention to remember. StatePublisher becomes a subscriber of App events, not a manually-called service. |

---

## Architecture

### Before (current)

```
index.ts (930 lines of imperative wiring)
    │
    ▼
Fastify server (holds all services as decorators)
    │
    ├── REST routes ──► fastify.taskManager.list()
    ├── WS handler  ──► sessionRegistry / connectionRegistry (module singletons)
    └── Events      ──► connectionRegistry.broadcastToAll() (hardwired)
```

**Problem:** You can't use the app without starting a Fastify server. Agents test via HTTP. Tests need ports. No integration tests exist for business flows.

### After

```
                    ┌──────────────────────┐
                    │         App          │
                    │                      │
                    │  .chat               │
                    │  .tasks              │
                    │  .conversations      │
                    │  .calendar           │
                    │  .memory             │
                    │  .channels           │
                    │  .notifications      │
                    │  .workLoop           │
                    │                      │
                    │  .on(event, handler) │
                    │  .create(options)    │
                    │  .shutdown()         │
                    └──────────┬───────────┘
                               │
                    events & method calls
                               │
              ┌────────────────┼────────────────┐
              │                │                │
        ┌─────┴─────┐   ┌─────┴─────┐   ┌─────┴─────┐
        │  Fastify   │   │   Agent   │   │  Future   │
        │  adapter   │   │  / test   │   │  mobile   │
        │            │   │  driver   │   │  adapter  │
        │ REST + WS  │   │           │   │           │
        │ → browser  │   │ direct    │   │           │
        └────────────┘   └───────────┘   └───────────┘
```

### App class shape

```typescript
interface App extends EventEmitter {
  // Service namespaces
  readonly chat: ChatService;
  readonly tasks: TaskService;
  readonly conversations: ConversationService;
  readonly calendar: CalendarService;
  readonly memory: MemoryService;
  readonly channels: ChannelService;
  readonly notifications: NotificationService;
  readonly workLoop: WorkLoopService;

  // Lifecycle
  static create(options: AppOptions): Promise<App>;
  shutdown(): Promise<void>;

  // State
  readonly isHatched: boolean;
  readonly agentDir: string;
}

interface AppOptions {
  agentDir: string;
  // Optional overrides for testing
  skipCalendar?: boolean;
  skipChannels?: boolean;
  skipWorkLoop?: boolean;
}
```

### Event contract

App emits the same event types currently sent over WebSocket, plus lifecycle events:

```typescript
// Chat streaming
app.on('chat:text_delta', (conversationId, content) => {})
app.on('chat:thinking_delta', (conversationId, content) => {})
app.on('chat:done', (conversationId, { cost, usage }) => {})
app.on('chat:error', (conversationId, error) => {})

// State snapshots (same as current WS state: messages)
app.on('state:tasks', (tasks: TaskSnapshot[]) => {})
app.on('state:conversations', (conversations: ConversationMeta[]) => {})
app.on('state:calendar', (events: CalendarEventSnapshot[]) => {})
app.on('state:memory', (stats: MemoryStats) => {})

// Entity events
app.on('conversation:created', (conversation) => {})
app.on('conversation:updated', (conversationId, turn) => {})
app.on('task:updated', (task) => {})
app.on('notification:created', (notification) => {})

// Channel events
app.on('channel:status_changed', (channelId, status) => {})
app.on('channel:paired', (channelId) => {})
```

---

## Live Update Guarantee

### The Problem Today

Live updates are opt-in. After mutating state, the developer must remember to call `statePublisher.publishTasks()` or `connectionRegistry.broadcastToAll()`. Forget it, and the UI is stale until the next page load. This has caused bugs repeatedly — new features ship without live update wiring, existing mutations get refactored and lose their publish call.

### The Structural Fix

**Mutations only happen through App methods. App methods always emit.**

```typescript
// App.tasks — the ONLY way to mutate tasks
class TaskService {
  async create(input: CreateTaskInput): Promise<Task> {
    const task = await this.taskManager.create(input);
    this.app.emit('task:created', task);       // always fires
    return task;
  }

  async update(id: string, patch: TaskPatch): Promise<Task> {
    const task = await this.taskManager.update(id, patch);
    this.app.emit('task:updated', task);       // always fires
    return task;
  }

  async delete(id: string): Promise<void> {
    await this.taskManager.delete(id);
    this.app.emit('task:deleted', id);         // always fires
  }
}
```

No route, no agent, no test can update a task without the event firing. The event is in the mutation path, not a separate step someone has to remember.

### StatePublisher Becomes a Subscriber

Today, StatePublisher is called imperatively:

```typescript
// Current: caller must remember to publish
taskManager.update(id, patch);
statePublisher.publishTasks();  // forget this → stale UI
```

After extraction, StatePublisher subscribes to App events and debounces snapshots:

```typescript
// Adapter wiring (once, at startup)
app.on('task:created',  () => debouncedPublish('tasks'));
app.on('task:updated',  () => debouncedPublish('tasks'));
app.on('task:deleted',  () => debouncedPublish('tasks'));
app.on('conversation:created', () => debouncedPublish('conversations'));
app.on('conversation:updated', () => debouncedPublish('conversations'));
// ... every entity type
```

New entity types get live updates by adding one `app.emit()` call in the App method. The adapter picks it up automatically.

### What This Means for New Features

Before (convention — breaks silently):
1. Add route
2. Call service method
3. **Remember** to call `statePublisher.publishX()` ← easy to forget

After (structural — can't break):
1. Add App method that calls service + emits event
2. Add route that calls App method
3. Live update happens automatically

### Audit: Current State Mutations

Every mutation path must go through the App after extraction. Known mutation points to migrate:

| Entity | Mutation Sources | Live Update Today? |
|--------|------------------|--------------------|
| Tasks | REST routes, TaskProcessor, TaskScheduler, MCP tools | Partial — `onTaskMutated` callback, but not all paths |
| Conversations | Chat handler, channel handler, REST routes | Partial — some paths broadcast, some don't |
| Calendar | CalendarScheduler, REST routes | Yes — via cache invalidation + publish |
| Memory | SyncService, notebook write tools | Yes — SyncService emits `sync` event |
| Skills | MCP skill tools, hatching | Partial — `onSkillChanged` callback, but only in skill-server |
| Notifications | TaskProcessor, NotificationService | Yes — NotificationService emits events |
| Channels | TransportManager status changes | Yes — all wired in index.ts |

The "Partial" entries are the ones that have caused stale UI bugs. After extraction, all entries become "Yes — structural."

---

## Coupling Points to Break

Three places where business logic currently calls directly into WebSocket transport:

| # | Location | Current | After |
|---|----------|---------|-------|
| 1 | `index.ts:232-265` | Channel events → `connectionRegistry.broadcastToAll()` | Channel events → `app.emit('channel:*')` |
| 2 | `index.ts:337-363` | Notification events → `connectionRegistry.broadcastToAll()` | Notification events → `app.emit('notification:created')` |
| 3 | `StatePublisher` constructor | Takes `connectionRegistry` directly | Takes `app` (or an `emit` function), publishes via events |

**Additionally:**

| # | Location | Current | After |
|---|----------|---------|-------|
| 4 | `chat-handler.ts` | Imports `connectionRegistry`, `sessionRegistry` as module singletons | Receives from App via adapter wiring |
| 5 | `session-manager.ts` | Module-level `initPromptBuilder()`, `initMcpServers()`, `getSharedMcpServers()` | App owns prompt builder and MCP server pool as instance state |

---

## What Stays The Same

- **Every service class** — ConversationManager, TaskManager, SessionManager, etc. Internal APIs unchanged.
- **REST response shapes** — same JSON, same status codes.
- **WebSocket message format** — same `protocol.ts` types.
- **All 476 existing tests** — they test services, not transport.
- **`public/` frontend** — completely untouched.

---

## Sprint Breakdown

### S1: Business Layer Integration Tests

**Goal:** Capture current business behavior in tests that drive services directly. These become the regression safety net for all subsequent sprints.

**Scope:**
- Create `tests/integration/` directory
- Write a thin `AppHarness` that instantiates services the way `index.ts` does today (without Fastify)
- Write integration tests for core business flows:
  - Conversation lifecycle: create → send message → receive streaming response → verify transcript persisted
  - Task lifecycle: create task → execute → verify status transitions → verify notification emitted
  - Channel message flow: simulate inbound → verify conversation created → verify response routed back
  - Memory sync: write notebook file → verify indexed → verify searchable
  - State publishing: mutate task → verify state snapshot emitted
  - **Live update audit:** for every entity in the audit table, mutate via each known path → verify event fires. These tests become the structural proof that live updates can't regress.
- **Success criterion:** All integration tests pass. Existing 476 tests still pass.

**Why first:** These tests define the contract. Every subsequent sprint is verified against them. The live update audit tests specifically will catch any mutation path that bypasses the App after S2.

### S2: Extract App Class + Live Update Guarantee

**Goal:** Move service ownership from Fastify decorators to `App` class. All mutations go through App methods that emit events. Live updates become structural. `index.ts` becomes: create App → create Fastify → wire adapter → listen.

**Scope:**
- Create `src/app.ts` with `App.create()` factory
- Move all service instantiation and wiring from `index.ts:main()` into `App.create()`
- App exposes service namespaces (`.tasks`, `.conversations`, `.chat`, etc.)
- App exposes `EventEmitter` interface
- **Every App service method that mutates state emits an event after the mutation** — this is the live update guarantee
- Break the three broadcast coupling points (channels, notifications, state publisher) — replace with `app.emit()`
- **StatePublisher becomes a subscriber** of App events with debounced snapshot publishing, not a manually-called service
- Audit all mutation paths (see Live Update Guarantee table) and route through App methods — no direct service calls from routes
- Move `sessionRegistry` and `connectionRegistry` from module singletons to App-owned (connectionRegistry stays in adapter since it's transport-specific; sessionRegistry moves to App since it's business state)
- `index.ts` becomes ~50 lines: create App, create Fastify adapter, listen
- **Success criterion:** S1 integration tests pass on App directly. Existing 476 tests pass. Dashboard works identically in browser. Every mutation in the audit table emits an event (verified by integration test that subscribes to events and asserts they fire).

### S3: Chat Handler Decomposition

**Goal:** Split `chat-handler.ts` into App-owned chat logic and a thin WS transport adapter.

**Scope:**
- Extract `ChatService` from `chat-handler.ts`:
  - Conversation switching logic
  - Skill command expansion
  - Message validation and preprocessing
  - Streaming orchestration (start → deltas → done)
  - Auth/hatching flow coordination
- WS adapter becomes: parse JSON → call `app.chat.*` → subscribe to events → send JSON
- `ChatService` emits events, WS adapter forwards them
- **Success criterion:** S1 integration tests pass. Existing tests pass. Chat works identically in browser. Chat-handler.ts < 200 lines.

### S4: Agent-Driven Verification

**Goal:** Prove the headless App works for its intended purpose — agents driving the application directly.

**Scope:**
- Write agent-style test scenarios that exercise the App without any transport:
  - QA scenario: create conversation → send message → wait for idle → assert response quality
  - Debug scenario: inspect system prompt → verify components → check cache state
  - Task scenario: create task → monitor execution → verify completion notification
- Verify the Debug/Admin API can be reimplemented as direct App method calls (no HTTP roundtrip)
- Document the headless App API for agent consumers
- **Success criterion:** Agent scenarios pass. All prior tests pass. Debug API works both via HTTP (existing) and direct App calls (new).

---

## Testing Strategy

| Layer | When | What it proves |
|-------|------|----------------|
| **Service unit tests** (476 existing) | Every commit | Individual services work correctly |
| **App integration tests** (S1, new) | Every commit | Business flows work end-to-end without transport |
| **Transport contract tests** (S2, new) | Every commit | Fastify adapter faithfully maps App events to HTTP/WS |
| **Agent-driven E2E** (S4, new) | Per-sprint | Headless App serves its intended consumers |

**Regression rule:** All tests from all layers must pass at every sprint boundary. Any failure blocks the sprint review.

---

## Risk Register

| Risk | Severity | Mitigation |
|------|----------|------------|
| Chat handler streaming state machine breaks during decomposition | Medium | S1 integration tests capture exact streaming behavior before extraction. S3 is a dedicated sprint for this alone. |
| Module singleton removal breaks import order | Low | TypeScript compiler catches missing references. Tests catch runtime failures. |
| App initialization order matters (many services depend on others) | Low | `App.create()` preserves exact same initialization order as current `index.ts:main()`. |
| Performance regression from EventEmitter indirection | Negligible | EventEmitter is synchronous in Node.js. No measurable overhead for the message volumes involved. |

---

## Non-Goals

- **No new UI.** The frontend is completely untouched.
- **No mobile backend.** That's a future milestone that consumes the App class.
- **No API changes.** REST endpoints and WebSocket messages stay identical.
- **No new features.** This is purely structural. The application does exactly what it does today.

---

*Created: 2026-03-16*
*Part of: my_agent framework*
