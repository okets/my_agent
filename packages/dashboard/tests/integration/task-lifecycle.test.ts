/**
 * Task Lifecycle Integration Tests
 *
 * Validates task CRUD, status transitions, soft-delete, callbacks,
 * notifications, and task-conversation linking through the AppHarness.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { AppHarness } from "./app-harness.js";
import type { NotificationEvent } from "@my-agent/core";

let harness: AppHarness;

beforeEach(async () => {
  harness = await AppHarness.create();
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Task Lifecycle", () => {
  it("creates an immediate task with pending status", () => {
    const task = harness.taskManager.create(immediateTaskInput());

    expect(task.id).toMatch(/^task-/);
    expect(task.status).toBe("pending");
    expect(task.type).toBe("immediate");
    expect(task.sourceType).toBe("conversation");
    expect(task.sourceRef).toBe("conv-abc");
    expect(task.title).toBe("Test task");
    expect(task.instructions).toBe("Do the thing");
    expect(task.created).toBeInstanceOf(Date);
    expect(task.startedAt).toBeUndefined();
    expect(task.completedAt).toBeUndefined();
    expect(task.deletedAt).toBeUndefined();
  });

  it("creates a scheduled task with scheduledFor date", () => {
    const scheduledFor = new Date("2026-04-01T09:00:00Z");

    const task = harness.taskManager.create(
      immediateTaskInput({
        type: "scheduled",
        sourceType: "calendar",
        scheduledFor,
      }),
    );

    expect(task.type).toBe("scheduled");
    expect(task.sourceType).toBe("calendar");
    expect(task.scheduledFor).toBeInstanceOf(Date);
    expect(task.scheduledFor!.toISOString()).toBe("2026-04-01T09:00:00.000Z");
    expect(task.status).toBe("pending");
  });

  it("updates task status through lifecycle transitions", () => {
    const task = harness.taskManager.create(immediateTaskInput());
    expect(task.status).toBe("pending");

    // pending -> running
    const startedAt = new Date();
    harness.taskManager.update(task.id, { status: "running", startedAt });

    const running = harness.taskManager.findById(task.id)!;
    expect(running.status).toBe("running");
    expect(running.startedAt).toBeInstanceOf(Date);
    expect(running.startedAt!.toISOString()).toBe(startedAt.toISOString());

    // running -> completed
    const completedAt = new Date();
    harness.taskManager.update(task.id, { status: "completed", completedAt });

    const completed = harness.taskManager.findById(task.id)!;
    expect(completed.status).toBe("completed");
    expect(completed.completedAt).toBeInstanceOf(Date);
    expect(completed.completedAt!.toISOString()).toBe(
      completedAt.toISOString(),
    );
    // startedAt should still be set from the previous update
    expect(completed.startedAt).toBeInstanceOf(Date);
  });

  it("soft-deletes a task", () => {
    const task = harness.taskManager.create(immediateTaskInput());

    harness.taskManager.delete(task.id);

    // Task still exists in DB
    const deleted = harness.taskManager.findById(task.id)!;
    expect(deleted).not.toBeNull();
    expect(deleted.status).toBe("deleted");
    expect(deleted.deletedAt).toBeInstanceOf(Date);

    // Not in active list (default excludes deleted)
    const activeList = harness.taskManager.list();
    expect(activeList.find((t) => t.id === task.id)).toBeUndefined();

    // Appears when includeDeleted is set
    const allList = harness.taskManager.list({ includeDeleted: true });
    expect(allList.find((t) => t.id === task.id)).toBeDefined();
  });

  it("fires onTaskCreated callback", () => {
    const callback = vi.fn();
    harness.taskManager.onTaskCreated = callback;

    const task = harness.taskManager.create(immediateTaskInput());

    expect(callback).toHaveBeenCalledOnce();
    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({ id: task.id, title: "Test task" }),
    );
  });

  it("emits notification when NotificationService is used", () => {
    const handler = vi.fn();
    harness.notificationService.on("notification", handler);

    const notification = harness.notificationService.notify({
      taskId: "task-123",
      message: "Task completed successfully",
      importance: "info",
    });

    expect(handler).toHaveBeenCalledOnce();

    const event: NotificationEvent = handler.mock.calls[0][0];
    expect(event.type).toBe("notification:created");
    expect(event.notification.id).toBe(notification.id);
    expect((event.notification as any).message).toBe(
      "Task completed successfully",
    );
    expect((event.notification as any).taskId).toBe("task-123");
  });

  it("links tasks to conversations via junction table", () => {
    const task1 = harness.taskManager.create(immediateTaskInput());
    const task2 = harness.taskManager.create(
      immediateTaskInput({ title: "Second task" }),
    );
    const conversationId = "conv-xyz";

    // Link both tasks to the same conversation
    harness.taskManager.linkTaskToConversation(task1.id, conversationId);
    harness.taskManager.linkTaskToConversation(task2.id, conversationId);

    const linked = harness.taskManager.getTasksForConversation(conversationId);
    expect(linked).toHaveLength(2);

    const linkedIds = linked.map((l) => l.taskId);
    expect(linkedIds).toContain(task1.id);
    expect(linkedIds).toContain(task2.id);

    // Each link has a linkedAt date
    for (const link of linked) {
      expect(link.linkedAt).toBeInstanceOf(Date);
    }

    // Idempotent: linking again does not duplicate
    harness.taskManager.linkTaskToConversation(task1.id, conversationId);
    const afterDuplicate =
      harness.taskManager.getTasksForConversation(conversationId);
    expect(afterDuplicate).toHaveLength(2);
  });
});
