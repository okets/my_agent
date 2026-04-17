/**
 * Tests for AckDelivery (M9.6-S6).
 *
 * - WhatsApp-originated failure → TransportManager.send() called with the
 *   conversation's `sender` and `replyTo`, not the preferred outbound.
 * - Dashboard-originated failure → ConnectionRegistry.broadcastToConversation
 *   called with the conversation id and a system-message payload.
 * - Transport errors are caught (delivery is non-throwing).
 */

import { describe, it, expect, vi } from "vitest";
import { AckDelivery } from "../../src/capabilities/ack-delivery.js";
import type {
  TransportManagerLike,
  ConnectionRegistryLike,
} from "../../src/capabilities/ack-delivery.js";
import type { CapabilityFailure, ChannelContext } from "../../src/capabilities/cfr-types.js";
import { conversationOrigin } from "../../src/capabilities/cfr-helpers.js";

function makeFailure(channel: ChannelContext): CapabilityFailure {
  return {
    id: "f-1",
    capabilityType: "audio-to-text",
    symptom: "execution-error",
    triggeringInput: {
      origin: conversationOrigin(channel, "conv-A", 1),
    },
    attemptNumber: 1,
    previousAttempts: [],
    detectedAt: "2026-04-15T00:00:00.000Z",
  };
}

describe("AckDelivery", () => {
  it("routes WhatsApp-originated ack through TransportManager with correct sender + replyTo", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const broadcast = vi.fn();
    const transportManager: TransportManagerLike = { send };
    const connectionRegistry: ConnectionRegistryLike = {
      broadcastToConversation: broadcast,
    };
    const ack = new AckDelivery(transportManager, connectionRegistry);

    const failure = makeFailure({
      transportId: "whatsapp",
      channelId: "whatsapp",
      sender: "+1234567890",
      replyTo: "msg-orig-1",
    });

    await ack.deliver(failure, "hold on — voice transcription isn't working right, fixing now.");

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith("whatsapp", "+1234567890", {
      content: "hold on — voice transcription isn't working right, fixing now.",
      replyTo: "msg-orig-1",
    });
    expect(broadcast).not.toHaveBeenCalled();
  });

  it("routes dashboard-originated ack through ConnectionRegistry broadcast", async () => {
    const send = vi.fn();
    const broadcast = vi.fn();
    const transportManager: TransportManagerLike = { send };
    const connectionRegistry: ConnectionRegistryLike = {
      broadcastToConversation: broadcast,
    };
    const ack = new AckDelivery(transportManager, connectionRegistry);

    const failure = makeFailure({
      transportId: "dashboard",
      channelId: "dashboard",
      sender: "user",
    });

    await ack.deliver(failure, "still fixing — second attempt.");

    expect(send).not.toHaveBeenCalled();
    expect(broadcast).toHaveBeenCalledTimes(1);
    const [convId, payload] = broadcast.mock.calls[0];
    expect(convId).toBe("conv-A");
    expect(payload).toMatchObject({
      type: "capability_ack",
      conversationId: "conv-A",
      content: "still fixing — second attempt.",
    });
  });

  it("does not throw when TransportManager.send rejects — delivery is best-effort", async () => {
    const send = vi.fn().mockRejectedValue(new Error("transport disconnected"));
    const broadcast = vi.fn();
    const ack = new AckDelivery(
      { send } as TransportManagerLike,
      { broadcastToConversation: broadcast } as ConnectionRegistryLike,
    );

    const failure = makeFailure({
      transportId: "whatsapp",
      channelId: "whatsapp",
      sender: "+1234567890",
    });

    await expect(ack.deliver(failure, "text")).resolves.toBeUndefined();
    expect(send).toHaveBeenCalledTimes(1);
  });
});
