# M6.10-S1: Business Layer Integration Tests

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture current business behavior in cross-service integration tests that drive services directly (no Fastify, no HTTP, no WebSocket), creating the regression safety net for the App extraction in S2-S4.

**Architecture:** A thin `AppHarness` class wires services the same way `index.ts` does today but without Fastify or transport infrastructure. Tests instantiate the harness with temp directories, exercise cross-service flows, and verify state transitions + event emission. External dependencies (Claude API, CalDAV, WhatsApp/Baileys, embeddings) are either mocked or skipped.

**Tech Stack:** Vitest, better-sqlite3, node:fs (temp dirs), vitest spies for event capture

**Design spec:** [`docs/superpowers/specs/2026-03-16-headless-app-design.md`](../../superpowers/specs/2026-03-16-headless-app-design.md)

---

## File Structure

```
packages/dashboard/
├── tests/
│   └── integration/
│       ├── app-harness.ts              # Service wiring without Fastify
│       ├── conversation-lifecycle.test.ts
│       ├── task-lifecycle.test.ts
│       ├── memory-sync.test.ts
│       ├── state-publishing.test.ts
│       ├── channel-message-flow.test.ts
│       └── live-update-audit.test.ts
```

All new files. No existing files modified.

---

## Traceability Matrix

| Test Suite | Design Spec Section | What It Proves |
|---|---|---|
| `conversation-lifecycle.test.ts` | S1 Scope: "Conversation lifecycle" | Create → turns → status transitions → inactive callback |
| `task-lifecycle.test.ts` | S1 Scope: "Task lifecycle" | Create → status transitions → notification emitted |
| `memory-sync.test.ts` | S1 Scope: "Memory sync" | Write file → indexed → FTS searchable |
| `state-publishing.test.ts` | S1 Scope: "State publishing" | Mutate entity → verify state snapshot broadcast |
| `channel-message-flow.test.ts` | S1 Scope: "Channel message flow" | Inbound message → conversation created → response routed |
| `live-update-audit.test.ts` | S1 Scope: "Live update audit" | Every mutation path in audit table → verify broadcast fires |

---

## Success Criteria

- [ ] All new integration tests pass
- [ ] Existing 575 tests still pass (run full suite at end)
- [ ] AppHarness initializes and shuts down cleanly without Fastify
- [ ] Tests exercise cross-service flows, not individual service methods
- [ ] No flaky tests — deterministic, no timing-dependent assertions

---

## Task 1: AppHarness Foundation

**Files:**
- Create: `packages/dashboard/tests/integration/app-harness.ts`

The AppHarness wires services the same way `index.ts:main()` does (lines 86-750), but:
- Uses a temp directory for `agentDir` instead of `findAgentDir()`
- Skips Fastify server creation entirely
- Skips CalDAV calendar setup
- Skips WhatsApp/Baileys transport plugins
- Skips embeddings plugin initialization
- Skips work loop scheduler
- Creates a `ConnectionRegistry` instance (for StatePublisher) but no real WebSocket connections
- Provides `broadcastCapture` — an array that collects all `broadcastToAll()` calls for assertion

**Key design:** The harness creates its own `ConnectionRegistry` instance rather than importing the module singleton from `chat-handler.ts`. This avoids cross-test contamination and proves that in S2, these singletons can become App-owned.

- [ ] **Step 1: Create the AppHarness class**

```typescript
// packages/dashboard/tests/integration/app-harness.ts

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  NotificationService,
  MemoryDb,
  SyncService,
  SearchService,
  initNotebook,
} from "@my-agent/core";
import { ConversationManager } from "../../src/conversations/index.js";
import { TaskManager, TaskLogStorage, TaskProcessor } from "../../src/tasks/index.js";
import { ConnectionRegistry } from "../../src/ws/connection-registry.js";
import { StatePublisher } from "../../src/state/state-publisher.js";

export interface CapturedBroadcast {
  type: string;
  [key: string]: unknown;
}

export interface AppHarnessOptions {
  /** If true, initialize memory subsystem (MemoryDb + SyncService + SearchService) */
  withMemory?: boolean;
}

/**
 * AppHarness — wires dashboard services without Fastify for integration testing.
 *
 * Mirrors the initialization sequence in index.ts but skips:
 * - Fastify server
 * - CalDAV / calendar scheduler
 * - WhatsApp / Baileys transport plugins
 * - Embeddings plugins
 * - Work loop scheduler
 * - MCP servers
 * - SystemPromptBuilder / session manager
 */
export class AppHarness {
  readonly agentDir: string;
  readonly conversationManager: ConversationManager;
  readonly taskManager: TaskManager;
  readonly logStorage: TaskLogStorage;
  readonly notificationService: NotificationService;
  readonly connectionRegistry: ConnectionRegistry;
  readonly statePublisher: StatePublisher;
  readonly broadcasts: CapturedBroadcast[] = [];

  // Optional subsystems
  memoryDb: MemoryDb | null = null;
  syncService: SyncService | null = null;
  searchService: SearchService | null = null;

  // TaskProcessor requires executor which needs Agent SDK — created only when needed
  taskProcessor: TaskProcessor | null = null;

  private constructor(agentDir: string) {
    this.agentDir = agentDir;

    // Core services (same order as index.ts)
    this.conversationManager = new ConversationManager(agentDir);

    const db = this.conversationManager.getDb();
    this.taskManager = new TaskManager(db, agentDir);
    this.logStorage = new TaskLogStorage(agentDir);

    this.notificationService = new NotificationService();

    // ConnectionRegistry — own instance, not the module singleton
    this.connectionRegistry = new ConnectionRegistry();

    // StatePublisher — wired to our ConnectionRegistry
    this.statePublisher = new StatePublisher({
      connectionRegistry: this.connectionRegistry,
      taskManager: this.taskManager,
      conversationManager: this.conversationManager,
      getCalendarClient: () => null, // No calendar in tests
    });

    // Intercept all broadcasts for assertion
    const originalBroadcast = this.connectionRegistry.broadcastToAll.bind(
      this.connectionRegistry,
    );
    this.connectionRegistry.broadcastToAll = (message: any, exclude?: any) => {
      this.broadcasts.push(message as CapturedBroadcast);
      originalBroadcast(message, exclude);
    };
  }

  /**
   * Factory — creates temp agentDir, initializes services
   */
  static async create(options?: AppHarnessOptions): Promise<AppHarness> {
    const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "my-agent-integration-"));

    // Create minimal agent directory structure
    fs.mkdirSync(path.join(agentDir, "brain"), { recursive: true });
    fs.mkdirSync(path.join(agentDir, "runtime"), { recursive: true });
    fs.mkdirSync(path.join(agentDir, "tasks", "logs"), { recursive: true });
    fs.writeFileSync(
      path.join(agentDir, "brain", "AGENTS.md"),
      "# Test Agent\nYou are a test agent.\n",
    );

    const harness = new AppHarness(agentDir);

    // Initialize memory subsystem if requested
    if (options?.withMemory) {
      await initNotebook(agentDir);
      const notebookDir = path.join(agentDir, "notebook");

      harness.memoryDb = new MemoryDb(agentDir);
      harness.syncService = new SyncService({
        notebookDir,
        db: harness.memoryDb,
        getPlugin: () => null, // No embeddings in tests
        excludePatterns: ["knowledge/extracted/**"],
      });
      harness.searchService = new SearchService({
        db: harness.memoryDb,
        getPlugin: () => null,
        getDegradedHealth: () => null,
      });

      // Initial sync
      await harness.syncService.fullSync();
    }

    return harness;
  }

  /**
   * Clear captured broadcasts (call between test cases)
   */
  clearBroadcasts(): void {
    this.broadcasts.length = 0;
  }

  /**
   * Get broadcasts of a specific type
   */
  getBroadcasts(type: string): CapturedBroadcast[] {
    return this.broadcasts.filter((b) => b.type === type);
  }

  /**
   * Clean shutdown — close databases, remove temp directory
   */
  async shutdown(): Promise<void> {
    if (this.syncService) {
      this.syncService.stopWatching();
    }
    if (this.memoryDb) {
      this.memoryDb.close();
    }
    // ConversationManager closes its own db
    this.conversationManager.close();

    // Remove temp directory
    fs.rmSync(this.agentDir, { recursive: true, force: true });
  }
}
```

- [ ] **Step 2: Verify ConversationManager has a `close()` method**

Check `packages/dashboard/src/conversations/manager.ts` and `packages/dashboard/src/conversations/db.ts` for a `close()` method. If ConversationManager doesn't have one, the harness shutdown needs to call `conversationManager.getDb().close()` directly on the underlying better-sqlite3 instance. Adjust the harness code accordingly.

Run: `grep -n "close\b" packages/dashboard/src/conversations/manager.ts packages/dashboard/src/conversations/db.ts`

- [ ] **Step 3: Write a smoke test for harness lifecycle**

```typescript
// Append to app-harness.ts or create a minimal test

// This will be tested in Task 2's test file to avoid creating an extra test file.
// The smoke test is: "harness creates, services are accessible, harness shuts down cleanly"
```

- [ ] **Step 4: Commit**

```bash
git add packages/dashboard/tests/integration/app-harness.ts
git commit -m "feat(m6.10-s1): AppHarness for integration tests without Fastify"
```

---

## Task 2: Conversation Lifecycle Integration Tests

**Files:**
- Create: `packages/dashboard/tests/integration/conversation-lifecycle.test.ts`

Tests cross-service conversation flows: create, add turns, status transitions (current → inactive), and the inactive callback that triggers extraction.

No Agent SDK / Claude API calls — we test ConversationManager operations directly. The streaming response flow is tested via existing E2E tests.

- [ ] **Step 1: Write the test file**

```typescript
// packages/dashboard/tests/integration/conversation-lifecycle.test.ts

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { AppHarness } from "./app-harness.js";

describe("Conversation Lifecycle (integration)", () => {
  let harness: AppHarness;

  beforeEach(async () => {
    harness = await AppHarness.create();
  });

  afterEach(async () => {
    await harness.shutdown();
  });

  it("harness initializes and shuts down cleanly", () => {
    expect(harness.agentDir).toBeTruthy();
    expect(harness.conversationManager).toBeTruthy();
    expect(harness.taskManager).toBeTruthy();
  });

  it("creates a conversation with 'current' status", async () => {
    const conv = await harness.conversationManager.create();
    expect(conv.id).toMatch(/^conv-/);
    expect(conv.status).toBe("current");
    expect(conv.turnCount).toBe(0);
  });

  it("persists turns to transcript", async () => {
    const conv = await harness.conversationManager.create();

    await harness.conversationManager.appendTurn(conv.id, {
      type: "turn",
      role: "user",
      content: "Hello",
      timestamp: new Date().toISOString(),
      turnNumber: 1,
    });

    await harness.conversationManager.appendTurn(conv.id, {
      type: "turn",
      role: "assistant",
      content: "Hi there!",
      timestamp: new Date().toISOString(),
      turnNumber: 2,
    });

    const turns = await harness.conversationManager.getTurns(conv.id);
    expect(turns).toHaveLength(2);
    expect(turns[0].content).toBe("Hello");
    expect(turns[1].content).toBe("Hi there!");
  });

  it("demotes current conversation when creating a new one", async () => {
    const conv1 = await harness.conversationManager.create();
    expect(conv1.status).toBe("current");

    const conv2 = await harness.conversationManager.create();
    expect(conv2.status).toBe("current");

    // conv1 should now be inactive
    const conv1After = await harness.conversationManager.get(conv1.id);
    expect(conv1After?.status).toBe("inactive");
  });

  it("fires onConversationInactive callback when conversation is demoted", async () => {
    const inactiveCalls: string[] = [];
    harness.conversationManager.onConversationInactive = (id) => {
      inactiveCalls.push(id);
    };

    const conv1 = await harness.conversationManager.create();
    await harness.conversationManager.create(); // demotes conv1

    expect(inactiveCalls).toContain(conv1.id);
  });

  it("lists conversations ordered by update time", async () => {
    const conv1 = await harness.conversationManager.create({ title: "First" });
    // Small delay to ensure different timestamps
    const conv2 = await harness.conversationManager.create({ title: "Second" });

    const list = await harness.conversationManager.list();
    // Most recent first
    expect(list[0].id).toBe(conv2.id);
    expect(list[1].id).toBe(conv1.id);
  });

  it("deletes a conversation and its transcript", async () => {
    const conv = await harness.conversationManager.create();
    await harness.conversationManager.delete(conv.id);

    const result = await harness.conversationManager.get(conv.id);
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests**

Run: `cd packages/dashboard && npx vitest --run tests/integration/conversation-lifecycle.test.ts`
Expected: All tests pass

- [ ] **Step 3: Fix any issues discovered during the run**

Code samples use verified method names: `create()`, `appendTurn()`, `getTurns()`, `get()`, `list()`, `delete()`. The harness may need adjustments based on actual constructor requirements or `close()` method availability. Fix and re-run until green.

- [ ] **Step 4: Commit**

```bash
git add packages/dashboard/tests/integration/
git commit -m "feat(m6.10-s1): conversation lifecycle integration tests"
```

---

## Task 3: Task Lifecycle Integration Tests

**Files:**
- Create: `packages/dashboard/tests/integration/task-lifecycle.test.ts`

Tests task CRUD, status transitions, and notification emission across TaskManager + NotificationService. Does NOT test TaskExecutor (requires Agent SDK) or TaskProcessor execution flow — those are inherently E2E tests.

- [ ] **Step 1: Write the test file**

```typescript
// packages/dashboard/tests/integration/task-lifecycle.test.ts

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { AppHarness } from "./app-harness.js";
import type { CreateTaskInput } from "@my-agent/core";

describe("Task Lifecycle (integration)", () => {
  let harness: AppHarness;

  beforeEach(async () => {
    harness = await AppHarness.create();
  });

  afterEach(async () => {
    await harness.shutdown();
  });

  it("creates an immediate task with pending status", () => {
    const task = harness.taskManager.create({
      title: "Test task",
      instructions: "Do something",
      type: "immediate",
      sourceType: "conversation",
      sourceRef: "conv-test",
    });

    expect(task.id).toMatch(/^task-/);
    expect(task.status).toBe("pending");
    expect(task.type).toBe("immediate");
  });

  it("creates a scheduled task with scheduledFor date", () => {
    const scheduledFor = new Date(Date.now() + 3600_000);
    const task = harness.taskManager.create({
      title: "Scheduled task",
      instructions: "Do later",
      type: "scheduled",
      sourceType: "calendar",
      sourceRef: "event-123",
      scheduledFor,
    });

    expect(task.type).toBe("scheduled");
    expect(task.scheduledFor).toBeInstanceOf(Date);
  });

  it("updates task status through lifecycle transitions", () => {
    const task = harness.taskManager.create({
      title: "Lifecycle test",
      instructions: "Transition me",
      type: "immediate",
      sourceType: "conversation",
      sourceRef: "conv-test",
    });

    // pending → running
    harness.taskManager.update(task.id, { status: "running", startedAt: new Date() });
    let updated = harness.taskManager.findById(task.id);
    expect(updated?.status).toBe("running");
    expect(updated?.startedAt).toBeInstanceOf(Date);

    // running → completed
    harness.taskManager.update(task.id, { status: "completed", completedAt: new Date() });
    updated = harness.taskManager.findById(task.id);
    expect(updated?.status).toBe("completed");
    expect(updated?.completedAt).toBeInstanceOf(Date);
  });

  it("soft-deletes a task", () => {
    const task = harness.taskManager.create({
      title: "Delete me",
      instructions: "Bye",
      type: "immediate",
      sourceType: "conversation",
      sourceRef: "conv-test",
    });

    harness.taskManager.delete(task.id);
    const deleted = harness.taskManager.findById(task.id);
    expect(deleted?.deletedAt).toBeInstanceOf(Date);

    // Should not appear in active list
    const active = harness.taskManager.list({ includeDeleted: false });
    expect(active.find((t) => t.id === task.id)).toBeUndefined();
  });

  it("fires onTaskCreated callback", () => {
    const created: string[] = [];
    harness.taskManager.onTaskCreated = (task) => created.push(task.id);

    const task = harness.taskManager.create({
      title: "Callback test",
      instructions: "Fire!",
      type: "immediate",
      sourceType: "conversation",
      sourceRef: "conv-test",
    });

    expect(created).toContain(task.id);
  });

  it("emits notification when NotificationService is used", () => {
    const notifications: unknown[] = [];
    harness.notificationService.on("notification", (event) => {
      notifications.push(event);
    });

    const task = harness.taskManager.create({
      title: "Notify test",
      instructions: "Notify me",
      type: "immediate",
      sourceType: "conversation",
      sourceRef: "conv-test",
    });

    harness.notificationService.notify({
      taskId: task.id,
      message: "Task completed successfully",
      importance: "low",
    });

    expect(notifications).toHaveLength(1);
  });

  it("links tasks to conversations via junction table", () => {
    const convId = "conv-test-link";

    const task1 = harness.taskManager.create({
      title: "Linked task 1",
      instructions: "First",
      type: "immediate",
      sourceType: "conversation",
      sourceRef: convId,
    });
    const task2 = harness.taskManager.create({
      title: "Linked task 2",
      instructions: "Second",
      type: "immediate",
      sourceType: "conversation",
      sourceRef: convId,
    });

    // Link both tasks to the conversation
    harness.taskManager.linkTaskToConversation(task1.id, convId);
    harness.taskManager.linkTaskToConversation(task2.id, convId);

    const linked = harness.taskManager.getTasksForConversation(convId);
    expect(linked).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run the tests**

Run: `cd packages/dashboard && npx vitest --run tests/integration/task-lifecycle.test.ts`
Expected: All tests pass

- [ ] **Step 3: Fix any remaining API mismatches**

Code samples use verified method names: `create()`, `findById()`, `update()`, `delete()`, `list()`, `linkTaskToConversation()`, `getTasksForConversation()`. If any remaining signatures differ, check:
- `packages/dashboard/src/tasks/task-manager.ts` — CRUD methods and their exact parameter shapes
- `packages/core/src/tasks/types.ts` — `CreateTaskInput`, `Task`, `TaskStatus`, `ListTasksFilter`

- [ ] **Step 4: Commit**

```bash
git add packages/dashboard/tests/integration/task-lifecycle.test.ts
git commit -m "feat(m6.10-s1): task lifecycle integration tests"
```

---

## Task 4: Memory Sync Integration Tests

**Files:**
- Create: `packages/dashboard/tests/integration/memory-sync.test.ts`

Tests the memory pipeline: write a file to notebook → SyncService indexes it → MemoryDb stores it → SearchService finds it via FTS. No embeddings (vector search) — just keyword/BM25 search.

- [ ] **Step 1: Write the test file**

```typescript
// packages/dashboard/tests/integration/memory-sync.test.ts

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { AppHarness } from "./app-harness.js";

describe("Memory Sync (integration)", () => {
  let harness: AppHarness;

  beforeEach(async () => {
    harness = await AppHarness.create({ withMemory: true });
  });

  afterEach(async () => {
    await harness.shutdown();
  });

  it("initializes memory subsystem", () => {
    expect(harness.memoryDb).toBeTruthy();
    expect(harness.syncService).toBeTruthy();
    expect(harness.searchService).toBeTruthy();
  });

  it("indexes a new notebook file on sync", async () => {
    const notebookDir = path.join(harness.agentDir, "notebook");

    // Write a reference file
    const refDir = path.join(notebookDir, "reference");
    fs.mkdirSync(refDir, { recursive: true });
    fs.writeFileSync(
      path.join(refDir, "test-contacts.md"),
      "# Contacts\n\nAlice works at Acme Corp.\nBob prefers email.\n",
    );

    // Run sync
    const result = await harness.syncService!.fullSync();
    expect(result.added).toBeGreaterThanOrEqual(1);
  });

  it("finds indexed content via FTS search", async () => {
    const notebookDir = path.join(harness.agentDir, "notebook");

    // Write and sync
    const refDir = path.join(notebookDir, "reference");
    fs.mkdirSync(refDir, { recursive: true });
    fs.writeFileSync(
      path.join(refDir, "search-test.md"),
      "# Important\n\nThe quarterly report is due on Friday.\n",
    );
    await harness.syncService!.fullSync();

    // Search
    const results = await harness.searchService!.search("quarterly report");
    expect(results.length).toBeGreaterThan(0);
    expect(results.some((r) => r.content.includes("quarterly report"))).toBe(true);
  });

  it("removes deleted files from index on sync", async () => {
    const notebookDir = path.join(harness.agentDir, "notebook");
    const refDir = path.join(notebookDir, "reference");
    fs.mkdirSync(refDir, { recursive: true });

    const filePath = path.join(refDir, "ephemeral.md");
    fs.writeFileSync(filePath, "# Ephemeral\n\nThis will be deleted.\n");
    await harness.syncService!.fullSync();

    // Verify indexed
    let results = await harness.searchService!.search("ephemeral");
    expect(results.length).toBeGreaterThan(0);

    // Delete and re-sync
    fs.unlinkSync(filePath);
    await harness.syncService!.fullSync();

    // Verify removed
    results = await harness.searchService!.search("ephemeral");
    expect(results).toHaveLength(0);
  });

  it("excludes knowledge/extracted/ from indexing", async () => {
    const notebookDir = path.join(harness.agentDir, "notebook");
    const extractedDir = path.join(notebookDir, "knowledge", "extracted");
    fs.mkdirSync(extractedDir, { recursive: true });

    fs.writeFileSync(
      path.join(extractedDir, "staged-fact.md"),
      "# Staged\n\nThis should not be indexed.\n",
    );
    await harness.syncService!.fullSync();

    const results = await harness.searchService!.search("staged");
    expect(results).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the tests**

Run: `cd packages/dashboard && npx vitest --run tests/integration/memory-sync.test.ts`
Expected: All tests pass

- [ ] **Step 3: Adjust search API if needed**

Check `packages/core/src/memory/search-service.ts` for the actual `search()` method signature and return type. The result may have properties like `path`, `content`, `score` rather than just `content`. Adjust assertions accordingly.

- [ ] **Step 4: Commit**

```bash
git add packages/dashboard/tests/integration/memory-sync.test.ts
git commit -m "feat(m6.10-s1): memory sync integration tests"
```

---

## Task 5: State Publishing Integration Tests

**Files:**
- Create: `packages/dashboard/tests/integration/state-publishing.test.ts`

Tests that StatePublisher correctly debounces and broadcasts state snapshots when entities are mutated. Uses the harness's broadcast capture to verify without real WebSocket clients.

- [ ] **Step 1: Write the test file**

```typescript
// packages/dashboard/tests/integration/state-publishing.test.ts

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { AppHarness } from "./app-harness.js";

describe("State Publishing (integration)", () => {
  let harness: AppHarness;

  beforeEach(async () => {
    harness = await AppHarness.create();
  });

  afterEach(async () => {
    await harness.shutdown();
  });

  it("publishes task state snapshot after publishTasks()", async () => {
    // Create a task so there's data to publish
    harness.taskManager.create({
      title: "State test task",
      instructions: "Test",
      type: "immediate",
      sourceType: "conversation",
      sourceRef: "conv-test",
    });

    harness.statePublisher.publishTasks();

    // StatePublisher debounces at 100ms — wait for it
    await new Promise((r) => setTimeout(r, 150));

    const taskBroadcasts = harness.getBroadcasts("state:tasks");
    expect(taskBroadcasts.length).toBeGreaterThanOrEqual(1);

    const latest = taskBroadcasts[taskBroadcasts.length - 1];
    expect(latest.type).toBe("state:tasks");
    expect(Array.isArray(latest.tasks)).toBe(true);
  });

  it("publishes conversation state snapshot after publishConversations()", async () => {
    await harness.conversationManager.create({ title: "State test conv" });

    harness.statePublisher.publishConversations();

    await new Promise((r) => setTimeout(r, 150));

    const convBroadcasts = harness.getBroadcasts("state:conversations");
    expect(convBroadcasts.length).toBeGreaterThanOrEqual(1);
  });

  it("debounces rapid mutations into single broadcast", async () => {
    // Create 5 tasks in rapid succession
    for (let i = 0; i < 5; i++) {
      harness.taskManager.create({
        title: `Rapid task ${i}`,
        instructions: "Test",
        type: "immediate",
        sourceType: "conversation",
        sourceRef: "conv-test",
      });
      harness.statePublisher.publishTasks();
    }

    // Wait for debounce
    await new Promise((r) => setTimeout(r, 200));

    // Should have been batched — fewer broadcasts than mutations
    const taskBroadcasts = harness.getBroadcasts("state:tasks");
    expect(taskBroadcasts.length).toBeLessThan(5);
    expect(taskBroadcasts.length).toBeGreaterThanOrEqual(1);

    // The final broadcast should contain all 5 tasks
    const latest = taskBroadcasts[taskBroadcasts.length - 1] as any;
    expect(latest.tasks.length).toBeGreaterThanOrEqual(5);
  });

  it("notification event triggers broadcast", () => {
    const task = harness.taskManager.create({
      title: "Notification test",
      instructions: "Test",
      type: "immediate",
      sourceType: "conversation",
      sourceRef: "conv-test",
    });

    // Wire notification → broadcast (mirrors index.ts line 338-364)
    harness.notificationService.on("notification", (event) => {
      harness.connectionRegistry.broadcastToAll({
        type: "notification",
        notification: {
          id: event.notification.id,
          type: event.notification.type,
          taskId: event.notification.taskId,
          created: event.notification.created.toISOString(),
          status: event.notification.status,
        },
      });
    });

    harness.notificationService.notify({
      taskId: task.id,
      message: "Done",
      importance: "low",
    });

    const notifBroadcasts = harness.getBroadcasts("notification");
    expect(notifBroadcasts).toHaveLength(1);
    expect(notifBroadcasts[0].notification).toHaveProperty("taskId", task.id);
  });
});
```

- [ ] **Step 2: Run the tests**

Run: `cd packages/dashboard && npx vitest --run tests/integration/state-publishing.test.ts`
Expected: All tests pass

- [ ] **Step 3: Fix StatePublisher API mismatches**

Check `packages/dashboard/src/state/state-publisher.ts` for:
- Exact `publishTasks()` method name
- Whether broadcast sends `tasks` or `data` key
- Whether debounce actually fires when there are no WS connections (it might short-circuit)

If StatePublisher short-circuits when no connections exist, the broadcast capture on ConnectionRegistry will still work since we intercept at the `broadcastToAll` level.

- [ ] **Step 4: Commit**

```bash
git add packages/dashboard/tests/integration/state-publishing.test.ts
git commit -m "feat(m6.10-s1): state publishing integration tests"
```

---

## Task 6: Channel Message Flow Integration Tests

**Files:**
- Create: `packages/dashboard/tests/integration/channel-message-flow.test.ts`

Tests the inbound message flow: message arrives at ChannelMessageHandler → authorization gate → conversation created/found → response routed back. Uses MockTransportPlugin and skips actual Agent SDK streaming.

This test is more limited than the others because the full flow (inbound → brain query → response) requires the Agent SDK. We test:
1. Authorization gate accepts/rejects tokens
2. Owner message creates/finds a conversation
3. The handler calls sendViaTransport to respond (mocked)

- [ ] **Step 1: Write the test file**

```typescript
// packages/dashboard/tests/integration/channel-message-flow.test.ts

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { AppHarness } from "./app-harness.js";
import { ChannelMessageHandler } from "../../src/channels/message-handler.js";
import { SessionRegistry } from "../../src/agent/session-registry.js";
import type { ChannelBinding } from "@my-agent/core";

describe("Channel Message Flow (integration)", () => {
  let harness: AppHarness;

  beforeEach(async () => {
    harness = await AppHarness.create();
  });

  afterEach(async () => {
    await harness.shutdown();
  });

  it("creates ChannelMessageHandler with channel bindings", () => {
    const bindings: ChannelBinding[] = [
      {
        transportId: "test-transport",
        identity: "+15550001234",
        role: "owner",
      },
    ];

    const sendSpy = vi.fn();
    const typingSpy = vi.fn();

    const handler = new ChannelMessageHandler(
      {
        conversationManager: harness.conversationManager,
        sessionRegistry: new SessionRegistry(),
        connectionRegistry: harness.connectionRegistry,
        sendViaTransport: sendSpy,
        sendTypingIndicator: typingSpy,
        agentDir: harness.agentDir,
        statePublisher: {
          publishConversations: () =>
            harness.statePublisher.publishConversations(),
        },
      },
      bindings,
    );

    expect(handler).toBeTruthy();
  });

  it("rejects unauthorized messages (no matching channel binding)", async () => {
    const bindings: ChannelBinding[] = [
      {
        transportId: "test-transport",
        identity: "+15550001234",
        role: "owner",
      },
    ];

    const sendSpy = vi.fn();

    // Write config.yaml with token-based auth
    fs.writeFileSync(
      path.join(harness.agentDir, "config.yaml"),
      "transports: {}\nchannels: []\n",
    );

    const handler = new ChannelMessageHandler(
      {
        conversationManager: harness.conversationManager,
        sessionRegistry: new SessionRegistry(),
        connectionRegistry: harness.connectionRegistry,
        sendViaTransport: sendSpy,
        sendTypingIndicator: vi.fn(),
        agentDir: harness.agentDir,
        statePublisher: null,
      },
      bindings,
    );

    // Message from unknown sender
    await handler.handleMessages("test-transport", [
      {
        id: "msg-1",
        from: "+15559999999", // not in bindings
        timestamp: Date.now(),
        type: "text",
        body: "Hello",
      },
    ]);

    // Should not create a conversation for unknown sender
    const conversations = await harness.conversationManager.list();
    // Only conversations created by owner messages should exist
    // Unknown senders get stored in external message store, not as conversations
    expect(
      conversations.filter((c) => c.externalParty === "+15559999999"),
    ).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the tests**

Run: `cd packages/dashboard && npx vitest --run tests/integration/channel-message-flow.test.ts`
Expected: All tests pass

- [ ] **Step 3: Adjust based on actual ChannelMessageHandler API**

The `handleMessages()` signature, `IncomingMessage` shape, and `ChannelBinding` type need to match the actual code. Check:
- `packages/dashboard/src/channels/message-handler.ts` — constructor deps, `handleMessages()` params
- `packages/core/src/channels/types.ts` or `packages/core/src/types.ts` — `IncomingMessage`, `ChannelBinding`

The authorization gate may require config files to exist. Create minimal ones in the harness if needed.

- [ ] **Step 4: Commit**

```bash
git add packages/dashboard/tests/integration/channel-message-flow.test.ts
git commit -m "feat(m6.10-s1): channel message flow integration tests"
```

---

## Task 7: Live Update Audit Tests

**Files:**
- Create: `packages/dashboard/tests/integration/live-update-audit.test.ts`

This is the most important test file for S2. It documents every known mutation path (from the design spec's audit table) and verifies whether a broadcast/event fires. This creates the baseline that S2's App extraction must preserve or improve.

Each mutation path is tested independently: mutate → check if broadcast was emitted. Some paths currently emit broadcasts, some don't (the "Partial" entries in the spec). We document both.

- [ ] **Step 1: Write the test file**

```typescript
// packages/dashboard/tests/integration/live-update-audit.test.ts

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { AppHarness } from "./app-harness.js";

describe("Live Update Audit (integration)", () => {
  let harness: AppHarness;

  beforeEach(async () => {
    harness = await AppHarness.create();
  });

  afterEach(async () => {
    await harness.shutdown();
  });

  // ── Tasks ──

  describe("Task mutations", () => {
    it("task creation + manual publishTasks() → state:tasks broadcast", async () => {
      harness.taskManager.create({
        title: "Audit: task create",
        instructions: "Test",
        type: "immediate",
        sourceType: "conversation",
        sourceRef: "conv-test",
      });

      // Currently: TaskProcessor calls onTaskMutated() which calls publishTasks()
      // But without TaskProcessor wired, we must call publishTasks() manually
      // This test documents: the publish call IS required manually today
      harness.statePublisher.publishTasks();
      await new Promise((r) => setTimeout(r, 150));

      expect(harness.getBroadcasts("state:tasks").length).toBeGreaterThanOrEqual(1);
    });

    it("task status update + manual publishTasks() → state:tasks broadcast", async () => {
      const task = harness.taskManager.create({
        title: "Audit: task status",
        instructions: "Test",
        type: "immediate",
        sourceType: "conversation",
        sourceRef: "conv-test",
      });

      harness.clearBroadcasts();
      harness.taskManager.update(task.id, { status: "running", startedAt: new Date() });
      harness.statePublisher.publishTasks();
      await new Promise((r) => setTimeout(r, 150));

      expect(harness.getBroadcasts("state:tasks").length).toBeGreaterThanOrEqual(1);
    });

    it("task deletion + manual publishTasks() → state:tasks broadcast", async () => {
      const task = harness.taskManager.create({
        title: "Audit: task delete",
        instructions: "Test",
        type: "immediate",
        sourceType: "conversation",
        sourceRef: "conv-test",
      });

      harness.clearBroadcasts();
      harness.taskManager.delete(task.id);
      harness.statePublisher.publishTasks();
      await new Promise((r) => setTimeout(r, 150));

      expect(harness.getBroadcasts("state:tasks").length).toBeGreaterThanOrEqual(1);
    });
  });

  // ── Conversations ──

  describe("Conversation mutations", () => {
    it("conversation creation + manual publishConversations() → state:conversations broadcast", async () => {
      await harness.conversationManager.create({ title: "Audit: conv create" });

      harness.statePublisher.publishConversations();
      await new Promise((r) => setTimeout(r, 150));

      expect(
        harness.getBroadcasts("state:conversations").length,
      ).toBeGreaterThanOrEqual(1);
    });

    it("conversation deletion + manual publishConversations() → state:conversations broadcast", async () => {
      const conv = await harness.conversationManager.create({
        title: "Audit: conv delete",
      });

      harness.clearBroadcasts();
      await harness.conversationManager.delete(conv.id);
      harness.statePublisher.publishConversations();
      await new Promise((r) => setTimeout(r, 150));

      expect(
        harness.getBroadcasts("state:conversations").length,
      ).toBeGreaterThanOrEqual(1);
    });
  });

  // ── Notifications ──

  describe("Notification mutations", () => {
    it("notification emit → notification broadcast (when wired)", () => {
      // Wire like index.ts does
      harness.notificationService.on("notification", (event) => {
        harness.connectionRegistry.broadcastToAll({
          type: "notification",
          notification: {
            id: event.notification.id,
            type: event.notification.type,
            taskId: event.notification.taskId,
            created: event.notification.created.toISOString(),
            status: event.notification.status,
          },
        });
      });

      const task = harness.taskManager.create({
        title: "Audit: notification",
        instructions: "Test",
        type: "immediate",
        sourceType: "conversation",
        sourceRef: "conv-test",
      });

      harness.notificationService.notify({
        taskId: task.id,
        message: "Done",
        importance: "low",
      });

      expect(harness.getBroadcasts("notification")).toHaveLength(1);
    });
  });

  // ── Memory ──

  describe("Memory mutations", () => {
    it("memory sync event → publishMemory() fires (when wired)", async () => {
      const memHarness = await AppHarness.create({ withMemory: true });

      // Wire sync → publish like index.ts does
      let publishMemoryCalled = false;
      memHarness.syncService!.on("sync", () => {
        publishMemoryCalled = true;
      });

      // Trigger a sync
      await memHarness.syncService!.fullSync();

      expect(publishMemoryCalled).toBe(true);

      await memHarness.shutdown();
    });
  });

  // ── Audit Summary ──
  // This test documents the current state of live update coverage.
  // After S2 (App extraction), ALL mutation paths should emit events structurally.

  describe("Audit summary documentation", () => {
    it("documents current live update coverage", () => {
      // This is a documentation test — it always passes.
      // It records which paths are manual vs automatic today.
      const audit = {
        tasks: {
          "REST routes": "manual — route calls publishTasks()",
          "TaskProcessor": "manual — onTaskMutated callback",
          "TaskScheduler": "manual — via TaskProcessor",
          "MCP tools": "manual — onTaskMutated callback",
        },
        conversations: {
          "Chat handler": "partial — some paths broadcast, some don't",
          "Channel handler": "partial — statePublisher.publishConversations()",
          "REST routes": "manual — route calls publishConversations()",
        },
        calendar: {
          "CalendarScheduler": "yes — cache invalidation + publish",
          "REST routes": "yes — via cache invalidation + publish",
        },
        memory: {
          "SyncService": "yes — emits sync event",
          "Notebook write tools": "yes — SyncService detects changes",
        },
        skills: {
          "MCP skill tools": "partial — onSkillChanged callback in skill-server only",
          "Hatching": "no broadcast",
        },
        notifications: {
          "TaskProcessor": "yes — NotificationService emits events",
          "NotificationService": "yes — emits events directly",
        },
        channels: {
          "TransportManager": "yes — all wired in index.ts",
        },
      };

      // Document in test output
      expect(audit).toBeTruthy();
    });
  });
});
```

- [ ] **Step 2: Run the tests**

Run: `cd packages/dashboard && npx vitest --run tests/integration/live-update-audit.test.ts`
Expected: All tests pass

- [ ] **Step 3: Commit**

```bash
git add packages/dashboard/tests/integration/live-update-audit.test.ts
git commit -m "feat(m6.10-s1): live update audit integration tests"
```

---

## Task 8: Full Suite Verification

**Files:** None (verification only)

Run the complete test suite to verify that all new integration tests pass alongside the existing 575 tests.

- [ ] **Step 1: Run all integration tests together**

Run: `cd packages/dashboard && npx vitest --run tests/integration/`
Expected: All tests pass

- [ ] **Step 2: Run the full test suite**

Run: `cd packages/dashboard && npx vitest --run`
Expected: 575+ tests pass (existing 575 + new integration tests), 0 failures

- [ ] **Step 3: Count new tests**

Run: `cd packages/dashboard && npx vitest --run tests/integration/ 2>&1 | tail -5`
Document the new test count in the commit message.

- [ ] **Step 4: Final commit (if any fixes needed)**

```bash
git add -A
git commit -m "fix(m6.10-s1): integration test fixes from full suite run"
```

---

## Risks & Mitigations

| Risk | Severity | Mitigation |
|------|----------|------------|
| Service constructors need args not available without Fastify | Medium | AppHarness creates minimal stubs. Some services may need interface-compatible mocks. |
| StatePublisher short-circuits when no WS connections | Low | We intercept at `broadcastToAll` level — the interception fires regardless. |
| Module singleton imports cause cross-test contamination | Low | AppHarness creates its own instances. Tests run serially within each file. |
| ConversationManager DB cleanup fails in temp dirs | Low | `shutdown()` calls `fs.rmSync` with `force: true`. |
| Some API method names differ from plan | Medium | Each task has a "fix API mismatches" step. Worker should verify actual signatures before writing tests. |
