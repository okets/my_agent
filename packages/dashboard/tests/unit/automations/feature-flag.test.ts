/**
 * M9.4-S4.2 Task 13 — PROACTIVE_DELIVERY_AS_ACTION_REQUEST routing flag.
 *
 * Default ON. When set to "0", alert/initiate route through sendSystemMessage
 * (S4.1 behaviour), bypassing the action-request principle. Only the routing
 * is flag-gated; formatNotification always emits the new prompt body.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ConversationInitiator } from "../../../src/agent/conversation-initiator.js";
import type { ChatEvent } from "../../../src/chat/types.js";

function makeInitiator() {
  const calls: { method: "sendSystemMessage" | "sendActionRequest" }[] = [];
  const mockManager = {
    getCurrent: vi.fn(async () => ({ id: "conv-1", turnCount: 0 })),
    getLastUserTurn: vi.fn(async () => null),
    create: vi.fn(async () => ({ id: "conv-new", turnCount: 0 })),
  };
  const mockChat = {
    async *sendSystemMessage(): AsyncGenerator<ChatEvent> {
      calls.push({ method: "sendSystemMessage" });
      yield { type: "start" };
      yield { type: "text_delta", text: "ok" };
      yield { type: "done" };
    },
    async *sendActionRequest(): AsyncGenerator<ChatEvent> {
      calls.push({ method: "sendActionRequest" });
      yield { type: "start" };
      yield { type: "text_delta", text: "ok" };
      yield { type: "done" };
    },
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
  return { ci, calls };
}

describe("PROACTIVE_DELIVERY_AS_ACTION_REQUEST flag", () => {
  let originalEnv: string | undefined;

  beforeEach(() => {
    originalEnv = process.env.PROACTIVE_DELIVERY_AS_ACTION_REQUEST;
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.PROACTIVE_DELIVERY_AS_ACTION_REQUEST;
    } else {
      process.env.PROACTIVE_DELIVERY_AS_ACTION_REQUEST = originalEnv;
    }
  });

  it("default (unset) → alert routes through sendActionRequest", async () => {
    delete process.env.PROACTIVE_DELIVERY_AS_ACTION_REQUEST;
    const { ci, calls } = makeInitiator();
    await ci.alert("Test prompt");
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("sendActionRequest");
  });

  it("set to '1' explicitly → still routes through sendActionRequest", async () => {
    process.env.PROACTIVE_DELIVERY_AS_ACTION_REQUEST = "1";
    const { ci, calls } = makeInitiator();
    await ci.alert("Test prompt");
    expect(calls[0].method).toBe("sendActionRequest");
  });

  it("set to 'true' → still routes through sendActionRequest (any non-'0' enables)", async () => {
    process.env.PROACTIVE_DELIVERY_AS_ACTION_REQUEST = "true";
    const { ci, calls } = makeInitiator();
    await ci.alert("Test prompt");
    expect(calls[0].method).toBe("sendActionRequest");
  });

  it("set to '0' (rollback) → alert routes through sendSystemMessage", async () => {
    process.env.PROACTIVE_DELIVERY_AS_ACTION_REQUEST = "0";
    const { ci, calls } = makeInitiator();
    await ci.alert("Test prompt");
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("sendSystemMessage");
  });

  it("set to '0' → initiate also routes through sendSystemMessage", async () => {
    process.env.PROACTIVE_DELIVERY_AS_ACTION_REQUEST = "0";
    const { ci, calls } = makeInitiator();
    await ci.initiate({ firstTurnPrompt: "hello" });
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("sendSystemMessage");
  });

  it("default → initiate routes through sendActionRequest", async () => {
    delete process.env.PROACTIVE_DELIVERY_AS_ACTION_REQUEST;
    const { ci, calls } = makeInitiator();
    await ci.initiate({ firstTurnPrompt: "hello" });
    expect(calls[0].method).toBe("sendActionRequest");
  });
});
