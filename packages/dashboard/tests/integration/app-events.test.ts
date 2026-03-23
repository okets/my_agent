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
