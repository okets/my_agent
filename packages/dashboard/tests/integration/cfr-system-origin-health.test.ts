import { describe, it, expect } from "vitest";
import { AckDelivery } from "@my-agent/core";
import type { CapabilityFailure } from "@my-agent/core";

function makeSystemFailure(component = "scheduler"): CapabilityFailure {
  return {
    id: "cfr-sys-1",
    capabilityType: "audio-to-text",
    capabilityName: "stt-deepgram",
    symptom: "execution-error",
    detail: "test",
    detectedAt: new Date().toISOString(),
    triggeringInput: {
      origin: {
        kind: "system",
        component,
      },
    },
  } as unknown as CapabilityFailure;
}

describe("AckDelivery — system-origin ring buffer", () => {
  it("system-origin deliver appends to ring buffer", async () => {
    const delivery = new AckDelivery(
      { send: async () => {} } as any,
      { broadcastToConversation: () => {} } as any,
    );
    await delivery.deliver(makeSystemFailure(), "in-progress");
    const events = delivery.getSystemEvents();
    expect(events).toHaveLength(1);
    expect(events[0].component).toBe("scheduler");
    expect(events[0].capabilityType).toBe("audio-to-text");
  });

  it("ring buffer caps at 100 events (oldest evicted)", async () => {
    const delivery = new AckDelivery(
      { send: async () => {} } as any,
      { broadcastToConversation: () => {} } as any,
    );
    for (let i = 0; i < 105; i++) {
      await delivery.deliver(makeSystemFailure(`component-${i}`), "in-progress");
    }
    const events = delivery.getSystemEvents();
    expect(events).toHaveLength(100);
    expect(events[0].component).toBe("component-104"); // most recent first
    expect(events[99].component).toBe("component-5"); // oldest still in buffer (0-4 evicted)
  });

  it("getSystemEvents returns most-recent-first order", async () => {
    const delivery = new AckDelivery(
      { send: async () => {} } as any,
      { broadcastToConversation: () => {} } as any,
    );
    await delivery.deliver(makeSystemFailure("comp-A"), "in-progress");
    await delivery.deliver(makeSystemFailure("comp-B"), "in-progress");
    const events = delivery.getSystemEvents();
    expect(events[0].component).toBe("comp-B");
    expect(events[1].component).toBe("comp-A");
  });

  it("conversation-origin and automation-origin acks do NOT appear in system events", async () => {
    const convFailure: CapabilityFailure = {
      id: "cfr-conv-1",
      capabilityType: "audio-to-text",
      symptom: "execution-error",
      detail: "test",
      detectedAt: new Date().toISOString(),
      triggeringInput: {
        origin: {
          kind: "conversation",
          channel: { transportId: "dashboard", sender: "user", replyTo: undefined },
          conversationId: "conv-1",
        },
      },
    } as unknown as CapabilityFailure;

    const delivery = new AckDelivery(
      { send: async () => {} } as any,
      { broadcastToConversation: () => {} } as any,
    );
    await delivery.deliver(convFailure, "hold on");
    expect(delivery.getSystemEvents()).toHaveLength(0);
  });
});
