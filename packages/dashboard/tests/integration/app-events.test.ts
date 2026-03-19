/**
 * App Event Emission Tests — Live Update Guarantee
 *
 * Verifies that every state mutation through App service namespaces
 * emits the correct typed event. This is the structural proof that
 * live updates can't regress — mutations that bypass events are
 * architecturally impossible.
 *
 * M6.10-S2: Design spec §Live Update Guarantee
 */

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
    it("emits task:created on create", () => {
      const events: any[] = [];
      harness.emitter.on("task:created", (task) => events.push(task));

      const task = harness.tasks.create({
        title: "Test task",
        instructions: "Do the thing",
        type: "immediate",
        sourceType: "web",
        createdBy: "user",
      });

      expect(events).toHaveLength(1);
      expect(events[0].id).toBe(task.id);
      expect(events[0].title).toBe("Test task");
    });

    it("emits task:updated on update", () => {
      const events: any[] = [];
      harness.emitter.on("task:updated", (task) => events.push(task));

      const task = harness.tasks.create({
        title: "Test task",
        instructions: "Do it",
        type: "immediate",
        sourceType: "web",
        createdBy: "user",
      });

      harness.tasks.update(task.id, {
        status: "completed",
        completedAt: new Date(),
      });

      expect(events).toHaveLength(1);
      expect(events[0].status).toBe("completed");
    });

    it("emits task:deleted on delete", () => {
      const events: string[] = [];
      harness.emitter.on("task:deleted", (id) => events.push(id));

      const task = harness.tasks.create({
        title: "Test task",
        instructions: "Do it",
        type: "immediate",
        sourceType: "web",
        createdBy: "user",
      });

      harness.tasks.delete(task.id);

      expect(events).toHaveLength(1);
      expect(events[0]).toBe(task.id);
    });

    it("emits task:updated on linkTaskToConversation", async () => {
      const events: any[] = [];
      harness.emitter.on("task:updated", (task) => events.push(task));

      const task = harness.tasks.create({
        title: "Test task",
        instructions: "Link me",
        type: "immediate",
        sourceType: "web",
        createdBy: "user",
      });

      const conv = await harness.conversationManager.create();
      harness.tasks.linkTaskToConversation(task.id, conv.id);

      expect(events).toHaveLength(1);
    });
  });

  describe("Conversation mutations", () => {
    it("emits conversation:created on create", async () => {
      const events: any[] = [];
      harness.emitter.on("conversation:created", (conv) => events.push(conv));

      const conv = await harness.conversations.create();

      expect(events).toHaveLength(1);
      expect(events[0].id).toBe(conv.id);
    });

    it("emits conversation:deleted on delete", async () => {
      const events: string[] = [];
      harness.emitter.on("conversation:deleted", (id) => events.push(id));

      const conv = await harness.conversations.create();
      await harness.conversations.delete(conv.id);

      expect(events).toHaveLength(1);
      expect(events[0]).toBe(conv.id);
    });

    it("emits conversation:updated on makeCurrent", async () => {
      const events: string[] = [];
      harness.emitter.on("conversation:updated", (id) => events.push(id));

      const conv = await harness.conversations.create();
      await harness.conversations.makeCurrent(conv.id);

      expect(events).toHaveLength(1);
      expect(events[0]).toBe(conv.id);
    });
  });

  describe("Calendar and memory events", () => {
    it("emits calendar:changed on emitChanged", () => {
      const events: any[] = [];
      harness.emitter.on("calendar:changed", () => events.push(true));

      harness.calendar.emitChanged();

      expect(events).toHaveLength(1);
    });

    it("emits memory:changed on emitChanged", () => {
      const events: any[] = [];
      harness.emitter.on("memory:changed", () => events.push(true));

      harness.memory.emitChanged();

      expect(events).toHaveLength(1);
    });
  });

  describe("Structural guarantee — audit", () => {
    it("every task mutation emits an event", () => {
      const events: string[] = [];
      harness.emitter.on("task:created", () => events.push("created"));
      harness.emitter.on("task:updated", () => events.push("updated"));
      harness.emitter.on("task:deleted", () => events.push("deleted"));

      // Create
      const task = harness.tasks.create({
        title: "Audit task",
        instructions: "Verify",
        type: "immediate",
        sourceType: "web",
        createdBy: "user",
      });
      expect(events).toContain("created");

      // Update
      harness.tasks.update(task.id, {
        status: "running",
        startedAt: new Date(),
      });
      expect(events).toContain("updated");

      // Delete
      harness.tasks.delete(task.id);
      expect(events).toContain("deleted");

      expect(events).toEqual(["created", "updated", "deleted"]);
    });

    it("every conversation mutation emits an event", async () => {
      const events: string[] = [];
      harness.emitter.on("conversation:created", () =>
        events.push("created"),
      );
      harness.emitter.on("conversation:updated", () =>
        events.push("updated"),
      );
      harness.emitter.on("conversation:deleted", () =>
        events.push("deleted"),
      );

      const conv = await harness.conversations.create();
      await harness.conversations.makeCurrent(conv.id);
      await harness.conversations.delete(conv.id);

      expect(events).toEqual(["created", "updated", "deleted"]);
    });
  });
});
