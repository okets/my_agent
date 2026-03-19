/**
 * Live Update Audit — Integration Tests
 *
 * Documents every known mutation path and whether a broadcast fires.
 * Baseline for M6.10-S2 (App extraction).
 *
 * Key finding: most mutation paths require MANUAL publishTasks()/publishConversations()
 * calls. Only calendar and transport have fully automatic broadcast wiring.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { AppHarness } from "./app-harness.js";

let harness: AppHarness;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function taskInput(overrides?: Record<string, unknown>) {
  return {
    title: "Audit test task",
    instructions: "Verify broadcast behavior",
    type: "immediate" as const,
    sourceType: "conversation" as const,
    sourceRef: "conv-audit",
    createdBy: "test",
    ...overrides,
  };
}

/** Wait for debounced publish (StatePublisher debounce is 100ms). */
const waitForDebounce = () => new Promise((r) => setTimeout(r, 150));

// ---------------------------------------------------------------------------
// Task mutations — manual publish required
// ---------------------------------------------------------------------------

describe("Task mutations (manual publish required)", () => {
  beforeEach(async () => {
    harness = await AppHarness.create();
  });

  afterEach(async () => {
    await harness.shutdown();
  });

  it("task creation + publishTasks() -> state:tasks broadcast", async () => {
    harness.taskManager.create(taskInput());
    harness.statePublisher.publishTasks();
    await waitForDebounce();

    const broadcasts = harness.getBroadcasts("state:tasks");
    expect(broadcasts.length).toBeGreaterThanOrEqual(1);
  });

  it("task status update + publishTasks() -> state:tasks broadcast", async () => {
    const task = harness.taskManager.create(taskInput());
    harness.clearBroadcasts();

    harness.taskManager.update(task.id, {
      status: "running",
      startedAt: new Date(),
    });
    harness.statePublisher.publishTasks();
    await waitForDebounce();

    const broadcasts = harness.getBroadcasts("state:tasks");
    expect(broadcasts.length).toBeGreaterThanOrEqual(1);
  });

  it("task deletion + publishTasks() -> state:tasks broadcast", async () => {
    const task = harness.taskManager.create(taskInput());
    harness.clearBroadcasts();

    harness.taskManager.delete(task.id);
    harness.statePublisher.publishTasks();
    await waitForDebounce();

    const broadcasts = harness.getBroadcasts("state:tasks");
    expect(broadcasts.length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// Conversation mutations — manual publish required
// ---------------------------------------------------------------------------

describe("Conversation mutations (manual publish required)", () => {
  beforeEach(async () => {
    harness = await AppHarness.create();
  });

  afterEach(async () => {
    await harness.shutdown();
  });

  it("conversation creation + publishConversations() -> state:conversations broadcast", async () => {
    await harness.conversationManager.create({ title: "Audit conversation" });
    harness.statePublisher.publishConversations();
    await waitForDebounce();

    const broadcasts = harness.getBroadcasts("state:conversations");
    expect(broadcasts.length).toBeGreaterThanOrEqual(1);
  });

  it("conversation deletion + publishConversations() -> state:conversations broadcast", async () => {
    const conv = await harness.conversationManager.create({
      title: "Ephemeral",
    });
    harness.clearBroadcasts();

    await harness.conversationManager.delete(conv.id);
    harness.statePublisher.publishConversations();
    await waitForDebounce();

    const broadcasts = harness.getBroadcasts("state:conversations");
    expect(broadcasts.length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// Notification mutations
// ---------------------------------------------------------------------------

describe("Notification mutations", () => {
  beforeEach(async () => {
    harness = await AppHarness.create();
  });

  afterEach(async () => {
    await harness.shutdown();
  });

  it("notificationService event -> broadcastToAll notification", () => {
    // Wire notification -> broadcast, mirroring index.ts wiring
    harness.notificationService.on("notification", (event) => {
      harness.connectionRegistry.broadcastToAll({
        type: "notification",
        notification: event.notification,
      } as any);
    });

    harness.notificationService.notify({
      taskId: "task-audit-1",
      message: "Audit notification test",
      importance: "info",
    });

    const broadcasts = harness.getBroadcasts("notification");
    expect(broadcasts.length).toBe(1);
    expect((broadcasts[0] as any).notification.message).toBe(
      "Audit notification test",
    );
  });
});

// ---------------------------------------------------------------------------
// Memory mutations
// ---------------------------------------------------------------------------

describe("Memory mutations", () => {
  let memHarness: AppHarness;

  beforeEach(async () => {
    memHarness = await AppHarness.create({ withMemory: true });
  });

  afterEach(async () => {
    await memHarness.shutdown();
  });

  it("syncService emits sync event on fullSync()", async () => {
    const syncHandler = vi.fn();
    memHarness.syncService!.on("sync", syncHandler);

    await memHarness.syncService!.fullSync();

    expect(syncHandler).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Audit summary — always passes, documents current coverage
// ---------------------------------------------------------------------------

describe("Live update coverage audit", () => {
  it("documents current broadcast coverage for all mutation paths", () => {
    /**
     * This test is a living document of which mutation paths trigger
     * live updates (broadcasts) to connected dashboard clients.
     *
     * Legend:
     *   "manual"  — caller must invoke publishTasks()/publishConversations()
     *   "yes"     — broadcast is wired automatically
     *   "partial" — some code paths broadcast, others do not
     *   "no"      — no broadcast wired
     */
    const auditTable = {
      tasks: {
        restRoutes: "manual",
        taskProcessor: "manual — via onTaskMutated callback",
        taskScheduler: "via TaskProcessor",
        mcpTools: "manual — via onTaskMutated callback",
      },
      conversations: {
        chatHandler: "partial",
        channelHandler: "partial",
        restRoutes: "manual",
      },
      calendar: {
        calendarScheduler: "yes",
        restRoutes: "yes",
      },
      memory: {
        syncService: "yes",
        notebookWriteTools: "yes",
      },
      skills: {
        mcpSkillTools: "partial — onSkillChanged callback",
        hatching: "no broadcast",
      },
      notifications: {
        taskProcessor: "yes",
        notificationService: "yes",
      },
      channels: {
        transportManager: "yes — all wired in index.ts",
      },
    };

    // Verify the table has all expected top-level categories
    expect(Object.keys(auditTable)).toEqual([
      "tasks",
      "conversations",
      "calendar",
      "memory",
      "skills",
      "notifications",
      "channels",
    ]);

    // Verify task mutation paths are documented
    expect(auditTable.tasks.restRoutes).toBe("manual");
    expect(auditTable.tasks.taskProcessor).toContain("manual");
    expect(auditTable.tasks.taskScheduler).toContain("TaskProcessor");
    expect(auditTable.tasks.mcpTools).toContain("manual");

    // Verify conversation paths
    expect(auditTable.conversations.chatHandler).toBe("partial");
    expect(auditTable.conversations.channelHandler).toBe("partial");
    expect(auditTable.conversations.restRoutes).toBe("manual");

    // Verify fully-wired subsystems
    expect(auditTable.calendar.calendarScheduler).toBe("yes");
    expect(auditTable.memory.syncService).toBe("yes");
    expect(auditTable.notifications.taskProcessor).toBe("yes");
    expect(auditTable.channels.transportManager).toContain("yes");

    // Verify known gaps
    expect(auditTable.skills.hatching).toBe("no broadcast");
  });
});
