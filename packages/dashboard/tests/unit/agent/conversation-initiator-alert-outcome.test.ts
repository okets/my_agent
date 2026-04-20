import { describe, it, expect, vi } from "vitest";
import { ConversationInitiator } from "../../../src/agent/conversation-initiator.js";
import type { ChatEvent } from "../../../src/chat/types.js";

function makeConversation(id = "conv-1") {
  return { id, turnCount: 0 };
}

function makeInitiator(
  sendSystemMessageImpl: () => AsyncGenerator<ChatEvent>,
) {
  const mockManager = {
    getCurrent: vi.fn(async () => makeConversation()),
    getLastUserTurn: vi.fn(async () => null),
  };
  const mockChat = {
    sendSystemMessage: vi.fn(() => sendSystemMessageImpl()),
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
  yield { type: "error", message: "oops" };
}

async function* happyGenerator(): AsyncGenerator<ChatEvent> {
  yield { type: "start" };
  yield { type: "text_delta", text: "Hello user" };
  yield { type: "done" };
}

describe("ConversationInitiator.alert() — outcome observation", () => {
  it("returns skipped_busy when sendSystemMessage yields no events (session busy)", async () => {
    const ci = makeInitiator(emptyGenerator);
    const result = await ci.alert("Test prompt");
    expect(result.status).toBe("skipped_busy");
  });

  it("returns send_failed with reason when sendSystemMessage yields an error event", async () => {
    const ci = makeInitiator(errorGenerator);
    const result = await ci.alert("Test prompt");
    expect(result.status).toBe("send_failed");
    if (result.status === "send_failed") {
      expect(result.reason).toBe("oops");
    }
  });

  it("returns delivered when sendSystemMessage yields start + text_delta + done", async () => {
    const ci = makeInitiator(happyGenerator);
    const result = await ci.alert("Test prompt");
    expect(result.status).toBe("delivered");
  });
});
