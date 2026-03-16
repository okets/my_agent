# M6.11 Headless App — Design Spec

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
- **Success criterion:** All integration tests pass. Existing 476 tests still pass.

**Why first:** These tests define the contract. Every subsequent sprint is verified against them.

### S2: Extract App Class

**Goal:** Move service ownership from Fastify decorators to `App` class. `index.ts` becomes: create App → create Fastify → wire adapter → listen.

**Scope:**
- Create `src/app.ts` with `App.create()` factory
- Move all service instantiation and wiring from `index.ts:main()` into `App.create()`
- App exposes service namespaces (`.tasks`, `.conversations`, `.chat`, etc.)
- App exposes `EventEmitter` interface
- Break the three broadcast coupling points (channels, notifications, state publisher) — replace with `app.emit()`
- Move `sessionRegistry` and `connectionRegistry` from module singletons to App-owned (connectionRegistry stays in adapter since it's transport-specific; sessionRegistry moves to App since it's business state)
- `index.ts` becomes ~50 lines: create App, create Fastify adapter, listen
- **Success criterion:** S1 integration tests pass on App directly. Existing 476 tests pass. Dashboard works identically in browser.

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
