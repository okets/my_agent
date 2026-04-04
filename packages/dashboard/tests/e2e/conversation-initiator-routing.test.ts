/**
 * Task 10: Conversation initiator reply routing — regression test
 *
 * Regression test for the bug fixed before S6 — agent-initiated conversations
 * must set externalParty and channel so replies route back.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  ConversationInitiator,
  type SessionFactory,
  type TransportManagerLike,
} from "../../src/agent/conversation-initiator.js";
import { ConversationManager } from "../../src/conversations/manager.js";
import { mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("Conversation Initiator Reply Routing", () => {
  let agentDir: string;
  let conversationManager: ConversationManager;
  let sessionFactory: SessionFactory;
  let channelManager: TransportManagerLike;
  let initiator: ConversationInitiator;

  const OWNER_JID = "41433650172129@lid";
  const TRANSPORT_ID = "whatsapp_main";

  beforeEach(() => {
    agentDir = mkdtempSync(join(tmpdir(), "ci-routing-"));
    conversationManager = new ConversationManager(agentDir);

    sessionFactory = {
      async *injectSystemTurn(_convId: string, _prompt: string) {
        yield { type: "text", text: "Hey, here is an update!" };
      },
      async *streamNewConversation(_convId: string, _prompt?: string) {
        yield { type: "text", text: "Hello, I have news for you." };
      },
      isStreaming(_convId: string): boolean {
        return false;
      },
      async queueNotification(
        _convId: string,
        _prompt: string,
      ): Promise<void> {},
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
      sessionFactory,
      channelManager,
      getOutboundChannel: () => "whatsapp",
    });
  });

  afterEach(() => {
    conversationManager.getConversationDb().close();
  });

  it("initiate() sets externalParty to the owner JID", async () => {
    const conv = await initiator.initiate({
      firstTurnPrompt: "[SYSTEM: Test alert]",
    });

    expect(conv.externalParty).toBe(OWNER_JID);
  });

  it("initiate() sets channel on the assistant turn", async () => {
    const conv = await initiator.initiate({
      firstTurnPrompt: "[SYSTEM: Test alert]",
    });

    const turns = await conversationManager.getRecentTurns(conv.id, 5);
    const assistantTurns = turns.filter((t) => t.role === "assistant");
    expect(assistantTurns.length).toBeGreaterThanOrEqual(1);
    expect(assistantTurns[0].channel).toBe(TRANSPORT_ID);
  });

  it("getByExternalParty finds the initiated conversation for reply matching", async () => {
    const conv = await initiator.initiate();

    const found = await conversationManager.getByExternalParty(OWNER_JID);
    expect(found).not.toBeNull();
    expect(found!.id).toBe(conv.id);
  });

  it("alert() injects into active conversation and sets channel on reply turn", async () => {
    // First create a conversation with a user message to make it "active"
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
    // Set lastUserMessageAt to make it active
    conversationManager
      .getConversationDb()
      .getDb()
      .prepare("UPDATE conversations SET last_user_message_at = ? WHERE id = ?")
      .run(new Date().toISOString(), conv.id);

    const alerted = await initiator.alert("Test notification to user");
    expect(alerted).toBe(true);

    // Verify the assistant turn has channel set
    const turns = await conversationManager.getRecentTurns(conv.id, 5);
    const assistantTurns = turns.filter((t) => t.role === "assistant");
    expect(assistantTurns.length).toBeGreaterThanOrEqual(1);
    expect(assistantTurns[0].channel).toBe(TRANSPORT_ID);
  });

  it("web channel: initiate() does NOT set externalParty", async () => {
    // Override to use web channel
    const webInitiator = new ConversationInitiator({
      conversationManager,
      sessionFactory,
      channelManager,
      getOutboundChannel: () => "web",
    });

    const conv = await webInitiator.initiate();
    expect(conv.externalParty).toBeNull();
  });
});
