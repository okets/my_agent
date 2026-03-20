/**
 * Agent Task Scenario Integration Tests
 *
 * Verifies that QA agents can manage tasks headlessly without HTTP routes.
 * Tests task creation, updates, deletion, and full lifecycle flows through
 * the AppTaskService event emission system.
 *
 * M6.10-S4: Sprint 4 (Headless App) extraction.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { AppHarness } from "./app-harness.js";

describe("Agent Task Scenario", () => {
  let harness: AppHarness;

  beforeEach(async () => {
    harness = await AppHarness.create();
  });

  afterEach(async () => {
    await harness.shutdown();
  });

  it("creates task and receives events headlessly", async () => {
    const events: any[] = [];
    harness.emitter.on("task:created", (task: any) =>
      events.push({ type: "created", task }),
    );

    const task = harness.tasks.create({
      type: "immediate",
      sourceType: "manual",
      createdBy: "agent",
      title: "Test task from agent",
      instructions: "Do something useful",
    });

    expect(task.id).toBeTruthy();
    expect(task.title).toBe("Test task from agent");
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("created");
    expect(events[0].task.id).toBe(task.id);
  });

  it("updates task status and receives event", async () => {
    const events: any[] = [];
    harness.emitter.on("task:updated", (task: any) => events.push(task));

    const task = harness.tasks.create({
      type: "immediate",
      sourceType: "manual",
      createdBy: "agent",
      title: "Status test",
      instructions: "Test status transitions",
    });

    harness.tasks.update(task.id, { status: "running" });
    expect(events).toHaveLength(1);
    expect(events[0].status).toBe("running");

    const found = harness.tasks.findById(task.id);
    expect(found?.status).toBe("running");
  });

  it("deletes task and receives event", async () => {
    const deletedIds: string[] = [];
    harness.emitter.on("task:deleted", (id: string) => deletedIds.push(id));

    const task = harness.tasks.create({
      type: "immediate",
      sourceType: "manual",
      createdBy: "agent",
      title: "Delete test",
      instructions: "To be deleted",
    });

    harness.tasks.delete(task.id);
    expect(deletedIds).toEqual([task.id]);

    // Soft delete: task still exists but with deleted status
    const deleted = harness.tasks.findById(task.id);
    expect(deleted).not.toBeNull();
    expect(deleted?.status).toBe("deleted");
    expect(deleted?.deletedAt).toBeInstanceOf(Date);
  });

  it("task lifecycle: create → run → complete (full scenario)", async () => {
    const allEvents: Array<{ type: string; status?: string }> = [];

    harness.emitter.on("task:created", (task: any) =>
      allEvents.push({ type: "created", status: task.status }),
    );
    harness.emitter.on("task:updated", (task: any) =>
      allEvents.push({ type: "updated", status: task.status }),
    );

    const task = harness.tasks.create({
      type: "immediate",
      sourceType: "manual",
      createdBy: "agent",
      title: "Full lifecycle",
      instructions: "Agent-driven lifecycle test",
    });

    harness.tasks.update(task.id, { status: "running" });
    harness.tasks.update(task.id, { status: "completed" });

    expect(allEvents.map((e) => e.type)).toEqual([
      "created",
      "updated",
      "updated",
    ]);
    expect(allEvents[1].status).toBe("running");
    expect(allEvents[2].status).toBe("completed");
  });
});
