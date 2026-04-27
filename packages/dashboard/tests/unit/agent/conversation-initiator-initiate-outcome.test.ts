/**
 * Tests for `ConversationInitiator.initiate()` delivery-outcome observation
 * — M9.4-S4.1 FU-7. Mirror of conversation-initiator-alert-outcome.test.ts
 * on the fresh-install / channel-switch fallback path.
 *
 * initiate() used to return just a Conversation and never signal whether the
 * model actually streamed a response, causing heartbeat's no_conversation
 * fallback to markDelivered() even when the briefing never reached the brain.
 * Now it returns { conversation, delivery: AlertResult } with the same
 * never-lie semantics as alert().
 */

import { describe, it, expect, vi } from "vitest";
import { ConversationInitiator } from "../../../src/agent/conversation-initiator.js";
import type { ChatEvent } from "../../../src/chat/types.js";

function makeInitiator(
  sendSystemMessageImpl: () => AsyncGenerator<ChatEvent>,
) {
  const mockManager = {
    getCurrent: vi.fn(async () => null),
    getLastUserTurn: vi.fn(async () => null),
    create: vi.fn(async () => ({ id: "conv-new", turnCount: 0 })),
  };
  // M9.4-S4.2: initiate() routes through sendActionRequest. Mock both
  // methods so the ChatServiceLike interface is satisfied and the
  // generator implementation drives both paths uniformly.
  const mockChat = {
    sendSystemMessage: vi.fn(() => sendSystemMessageImpl()),
    sendActionRequest: vi.fn(() => sendSystemMessageImpl()),
  };
  const mockChannel = {
    send: vi.fn(async () => {}),
    getTransportConfig: vi.fn(() => undefined),
    getTransportInfos: vi.fn(() => []),
  };

  return new ConversationInitiator({
    conversationManager: mockManager as any,
    chatService: mockChat as any,
    channelManager: mockChannel as any,
    getOutboundChannel: () => "web",
  });
}

async function* emptyGenerator(): AsyncGenerator<ChatEvent> {
  // yields nothing — session busy path
}

async function* errorGenerator(): AsyncGenerator<ChatEvent> {
  yield { type: "error", message: "model down" };
}

async function* happyGenerator(): AsyncGenerator<ChatEvent> {
  yield { type: "start" };
  yield { type: "text_delta", text: "Hello user" };
  yield { type: "done" };
}

describe("ConversationInitiator.initiate() — delivery-outcome observation", () => {
  it("always returns the created conversation (even on busy/error)", async () => {
    const ci = makeInitiator(emptyGenerator);
    const result = await ci.initiate({ firstTurnPrompt: "[SYSTEM: hello]" });
    expect(result.conversation).toBeDefined();
    expect((result.conversation as { id: string }).id).toBe("conv-new");
  });

  it("returns delivery.status=skipped_busy when sendSystemMessage yields no events", async () => {
    const ci = makeInitiator(emptyGenerator);
    const result = await ci.initiate({ firstTurnPrompt: "[SYSTEM: hello]" });
    expect(result.delivery.status).toBe("skipped_busy");
  });

  it("returns delivery.status=send_failed with reason when sendSystemMessage yields an error event", async () => {
    const ci = makeInitiator(errorGenerator);
    const result = await ci.initiate({ firstTurnPrompt: "[SYSTEM: hello]" });
    expect(result.delivery.status).toBe("send_failed");
    if (result.delivery.status === "send_failed") {
      expect(result.delivery.reason).toBe("model down");
    }
  });

  it("returns delivery.status=delivered when sendSystemMessage yields start + text_delta + done", async () => {
    const ci = makeInitiator(happyGenerator);
    const result = await ci.initiate({ firstTurnPrompt: "[SYSTEM: hello]" });
    expect(result.delivery.status).toBe("delivered");
  });
});
