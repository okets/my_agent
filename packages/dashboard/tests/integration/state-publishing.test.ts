/**
 * State Publishing Integration Tests
 *
 * Validates that StatePublisher correctly broadcasts entity snapshots
 * to connected clients via the ConnectionRegistry, including debounce
 * behavior and notification wiring.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { AppHarness } from "./app-harness.js";

let harness: AppHarness;

beforeEach(async () => {
  harness = await AppHarness.create();
  harness.clearBroadcasts();
});

afterEach(async () => {
  await harness.shutdown();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function immediateTaskInput(overrides?: Record<string, unknown>) {
  return {
    title: "Test task",
    instructions: "Do the thing",
    type: "immediate" as const,
    sourceType: "conversation" as const,
    sourceRef: "conv-abc",
    createdBy: "test",
    ...overrides,
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("State Publishing", () => {
  it("publishes task state snapshot after publishTasks()", async () => {
    const task = harness.taskManager.create(immediateTaskInput());

    harness.statePublisher.publishTasks();
    await delay(150);

    const broadcasts = harness.getBroadcasts("state:tasks");
    expect(broadcasts.length).toBeGreaterThanOrEqual(1);

    const last = broadcasts[broadcasts.length - 1];
    expect(last.type).toBe("state:tasks");
    expect(last.timestamp).toBeTypeOf("number");

    const tasks = last.tasks as Array<{ id: string; title: string }>;
    expect(tasks).toHaveLength(1);
    expect(tasks[0].id).toBe(task.id);
    expect(tasks[0].title).toBe("Test task");
  });

  it("publishes conversation state snapshot after publishConversations()", async () => {
    const conv = await harness.conversationManager.create({
      title: "State test conversation",
    });

    harness.statePublisher.publishConversations();
    await delay(150);

    const broadcasts = harness.getBroadcasts("state:conversations");
    expect(broadcasts.length).toBeGreaterThanOrEqual(1);

    const last = broadcasts[broadcasts.length - 1];
    expect(last.type).toBe("state:conversations");
    expect(last.timestamp).toBeTypeOf("number");

    const conversations = last.conversations as Array<{
      id: string;
      title: string;
    }>;
    expect(conversations.length).toBeGreaterThanOrEqual(1);

    const match = conversations.find((c) => c.id === conv.id);
    expect(match).toBeDefined();
    expect(match!.title).toBe("State test conversation");
  });

  it("debounces rapid mutations into single broadcast", async () => {
    // Create 5 tasks, calling publishTasks() after each one
    const createdIds: string[] = [];
    for (let i = 0; i < 5; i++) {
      const task = harness.taskManager.create(
        immediateTaskInput({ title: `Task ${i + 1}` }),
      );
      createdIds.push(task.id);
      harness.statePublisher.publishTasks();
    }

    // Wait for the debounce to fire
    await delay(200);

    const broadcasts = harness.getBroadcasts("state:tasks");

    // Debounce should collapse rapid calls — fewer than 5 broadcasts
    expect(broadcasts.length).toBeLessThan(5);

    // The final broadcast should contain all 5 tasks
    const last = broadcasts[broadcasts.length - 1];
    const tasks = last.tasks as Array<{ id: string }>;
    expect(tasks).toHaveLength(5);

    const broadcastIds = tasks.map((t) => t.id);
    for (const id of createdIds) {
      expect(broadcastIds).toContain(id);
    }
  });

  it("notification event triggers broadcast when wired", async () => {
    // Wire the notification service to broadcastToAll, mirroring index.ts
    harness.notificationService.on("notification", (event) => {
      const notification = event.notification;
      harness.connectionRegistry.broadcastToAll({
        type: "notification",
        notification: {
          id: notification.id,
          type: notification.type,
          taskId: notification.taskId,
          created: notification.created.toISOString(),
          status: notification.status,
          message: (notification as any).message,
        },
      });
    });

    harness.notificationService.notify({
      taskId: "task-abc",
      message: "Something happened",
      importance: "info",
    });

    const broadcasts = harness.getBroadcasts("notification");
    expect(broadcasts).toHaveLength(1);
    expect(broadcasts[0].type).toBe("notification");

    const payload = (broadcasts[0] as any).notification;
    expect(payload.taskId).toBe("task-abc");
    expect(payload.message).toBe("Something happened");
  });
});
