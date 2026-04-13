/**
 * Conversation initiator reply routing — regression test
 *
 * Regression test for the bug fixed before S6 — agent-initiated conversations
 * must set externalParty and channel so replies route back.
 *
 * Updated in S2: SessionFactory → ChatServiceLike (S1 architectural change).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  ConversationInitiator,
  type ChatServiceLike,
  type TransportManagerLike,
} from "../../src/agent/conversation-initiator.js";
import type { ChatEvent, SystemMessageOptions } from "../../src/chat/types.js";
import { ConversationManager } from "../../src/conversations/manager.js";
import { mkdtempSync, rmSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("Conversation Initiator Reply Routing", () => {
  let agentDir: string;
  let conversationManager: ConversationManager;
  let chatService: ChatServiceLike & {
    calls: Array<{
      conversationId: string;
      prompt: string;
      turnNumber: number;
      options?: SystemMessageOptions;
    }>;
  };
  let channelManager: TransportManagerLike;
  let initiator: ConversationInitiator;

  const OWNER_JID = "41433650172129@lid";
  const TRANSPORT_ID = "whatsapp_main";

  beforeEach(() => {
    agentDir = mkdtempSync(join(tmpdir(), "ci-routing-"));
    mkdirSync(join(agentDir, "conversations"), { recursive: true });
    conversationManager = new ConversationManager(agentDir);

    const calls: typeof chatService.calls = [];
    chatService = {
      calls,
      async *sendSystemMessage(
        conversationId: string,
        prompt: string,
        turnNumber: number,
        options?: SystemMessageOptions,
      ): AsyncGenerator<ChatEvent> {
        calls.push({ conversationId, prompt, turnNumber, options });
        yield { type: "start" };
        yield { type: "text_delta", text: "Hello, I have news for you." };
        yield { type: "done" };
      },
    };

    channelManager = {
      send: vi.fn(async () => {}),
      getTransportConfig: vi.fn((id: string) => {
        if (id === TRANSPORT_ID) return { ownerJid: OWNER_JID };
        return undefined;
      }),
      getTransportInfos: vi.fn(() => [
        {
          id: TRANSPORT_ID,
          plugin: "baileys",
          statusDetail: { connected: true },
        },
      ]),
    };

    initiator = new ConversationInitiator({
      conversationManager,
      chatService,
      channelManager,
      getOutboundChannel: () => "whatsapp",
    });
  });

  afterEach(() => {
    conversationManager.close();
    rmSync(agentDir, { recursive: true, force: true });
  });

  it("initiate() sets externalParty to the owner JID", async () => {
    const conv = await initiator.initiate({
      firstTurnPrompt: "[SYSTEM: Test alert]",
    });

    expect(conv.externalParty).toBe(OWNER_JID);
  });

  it("initiate() passes channel option to sendSystemMessage", async () => {
    await initiator.initiate({
      firstTurnPrompt: "[SYSTEM: Test alert]",
    });

    expect(chatService.calls).toHaveLength(1);
    expect(chatService.calls[0].options?.channel).toBe(TRANSPORT_ID);
  });

  it("getByExternalParty finds the initiated conversation for reply matching", async () => {
    const conv = await initiator.initiate();

    const found = await conversationManager.getByExternalParty(OWNER_JID);
    expect(found).not.toBeNull();
    expect(found!.id).toBe(conv.id);
  });

  it("alert() injects into active conversation via sendSystemMessage", async () => {
    // Create a conversation with a user message on the same channel
    const conv = await conversationManager.create({
      externalParty: OWNER_JID,
    });
    await conversationManager.appendTurn(conv.id, {
      type: "turn",
      role: "user",
      content: "Hello!",
      timestamp: new Date().toISOString(),
      turnNumber: 1,
      channel: TRANSPORT_ID,
    });

    const alerted = await initiator.alert("Test notification to user");
    expect(alerted).toMatchObject({ status: "delivered" });

    // sendSystemMessage was called with the conversation and channel
    expect(chatService.calls.length).toBeGreaterThanOrEqual(1);
    const lastCall = chatService.calls[chatService.calls.length - 1];
    expect(lastCall.conversationId).toBe(conv.id);
  });

  it("web channel: initiate() does NOT set externalParty", async () => {
    const webInitiator = new ConversationInitiator({
      conversationManager,
      chatService,
      channelManager,
      getOutboundChannel: () => "web",
    });

    const conv = await webInitiator.initiate();
    expect(conv.externalParty).toBeNull();
  });
});
