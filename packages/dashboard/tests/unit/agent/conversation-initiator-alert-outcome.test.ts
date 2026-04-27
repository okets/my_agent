import { describe, it, expect, vi } from "vitest";
import { ConversationInitiator } from "../../../src/agent/conversation-initiator.js";
import type { ChatEvent } from "../../../src/chat/types.js";

function makeConversation(id = "conv-1") {
  return { id, turnCount: 0 };
}

function makeInitiator(
  chatGenerator: () => AsyncGenerator<ChatEvent>,
) {
  const mockManager = {
    getCurrent: vi.fn(async () => makeConversation()),
    getLastUserTurn: vi.fn(async () => null),
  };
  // M9.4-S4.2: alert() routes through sendActionRequest (web + same-channel
  // paths) and sendSystemMessage is reserved for genuine system events.
  // Mock both so the interface is satisfied; assertions check which one was
  // actually called.
  const mockChat = {
    sendSystemMessage: vi.fn(() => chatGenerator()),
    sendActionRequest: vi.fn(() => chatGenerator()),
  };
  const mockChannel = {
    send: vi.fn(async () => {}),
    getTransportConfig: vi.fn(() => undefined),
    getTransportInfos: vi.fn(() => []),
  };

  const ci = new ConversationInitiator({
    conversationManager: mockManager as any,
    chatService: mockChat as any,
    channelManager: mockChannel as any,
    getOutboundChannel: () => "web",
  });
  return { ci, mockChat };
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
  it("returns skipped_busy when chat yields no events (session busy)", async () => {
    const { ci } = makeInitiator(emptyGenerator);
    const result = await ci.alert("Test prompt");
    expect(result.status).toBe("skipped_busy");
  });

  it("returns send_failed with reason when chat yields an error event", async () => {
    const { ci } = makeInitiator(errorGenerator);
    const result = await ci.alert("Test prompt");
    expect(result.status).toBe("send_failed");
    if (result.status === "send_failed") {
      expect(result.reason).toBe("oops");
    }
  });

  it("returns delivered when chat yields start + text_delta + done", async () => {
    const { ci } = makeInitiator(happyGenerator);
    const result = await ci.alert("Test prompt");
    expect(result.status).toBe("delivered");
  });

  // M9.4-S4.2 — alert() routes through sendActionRequest, NOT sendSystemMessage
  it("alert() routes through sendActionRequest (action-request principle)", async () => {
    const { ci, mockChat } = makeInitiator(happyGenerator);
    await ci.alert("Test prompt");
    expect(mockChat.sendActionRequest).toHaveBeenCalledTimes(1);
    expect(mockChat.sendSystemMessage).not.toHaveBeenCalled();
  });

  it("alert() does NOT pre-wrap the prompt in [SYSTEM:]", async () => {
    const { ci, mockChat } = makeInitiator(happyGenerator);
    await ci.alert("Brief delivery time. Deliverable: …");
    const promptArg = mockChat.sendActionRequest.mock.calls[0][1] as string;
    expect(promptArg).toBe("Brief delivery time. Deliverable: …");
    expect(promptArg).not.toMatch(/^\[SYSTEM:/);
  });
});
