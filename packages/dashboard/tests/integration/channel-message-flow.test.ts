/**
 * Channel Message Flow — Integration Tests
 *
 * Uses AppHarness to wire up real services and verifies ChannelMessageHandler
 * instantiation and external message routing. The full owner message flow
 * requires an Agent SDK session, so these tests cover only:
 *
 * 1. Handler instantiation with channel bindings
 * 2. Unknown sender messages don't create owner conversations
 */

import fs from "node:fs";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { AppHarness } from "./app-harness.js";
import { ChannelMessageHandler } from "../../src/channels/message-handler.js";
import { installMockSession } from "./mock-session.js";
import type { ChannelBinding, IncomingMessage } from "@my-agent/core";

// -------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------

function makeIncomingMessage(
  from: string,
  content: string,
  channelId: string,
): IncomingMessage {
  return {
    id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    from,
    content,
    timestamp: new Date(),
    channelId,
  };
}

const TEST_TRANSPORT_ID = "whatsapp-test";

const TEST_BINDINGS: ChannelBinding[] = [
  {
    id: "whatsapp-test_binding",
    transport: TEST_TRANSPORT_ID,
    ownerIdentity: "15550001234",
    ownerJid: "15550001234@s.whatsapp.net",
  },
];

// -------------------------------------------------------------------
// Tests
// -------------------------------------------------------------------

describe("Channel Message Flow (integration)", () => {
  let harness: AppHarness;

  beforeEach(async () => {
    harness = await AppHarness.create();

    // Write minimal config.yaml required by ConfigWriter
    fs.writeFileSync(
      path.join(harness.agentDir, "config.yaml"),
      "channels: {}\ntransports: {}\n",
    );
  });

  afterEach(async () => {
    await harness.shutdown();
  });

  it("creates ChannelMessageHandler with channel bindings", () => {
    const handler = new ChannelMessageHandler(
      {
        conversationManager: harness.conversationManager,
        connectionRegistry: harness.connectionRegistry,
        sendViaTransport: async () => {},
        sendTypingIndicator: async () => {},
        agentDir: harness.agentDir,
        app: { conversations: harness.conversations, chat: harness.chat, emit: () => {} } as any,
      },
      TEST_BINDINGS,
    );

    expect(handler).toBeDefined();
    expect(handler).toBeInstanceOf(ChannelMessageHandler);
  });

  it("unknown sender messages don't create conversations", async () => {
    const handler = new ChannelMessageHandler(
      {
        conversationManager: harness.conversationManager,
        connectionRegistry: harness.connectionRegistry,
        sendViaTransport: async () => {},
        sendTypingIndicator: async () => {},
        agentDir: harness.agentDir,
        app: { conversations: harness.conversations, chat: harness.chat, emit: () => {} } as any,
      },
      TEST_BINDINGS,
    );

    // Send a message from an identity NOT in the channel bindings
    const unknownSender = "19995559999@s.whatsapp.net";
    const msg = makeIncomingMessage(
      unknownSender,
      "Hello from an unknown number",
      TEST_TRANSPORT_ID,
    );

    await handler.handleMessages(TEST_TRANSPORT_ID, [msg]);

    // Verify no conversation was created for this external party
    const conversations = await harness.conversationManager.list();
    const matchingConvs = conversations.filter(
      (c) => c.externalParty === unknownSender,
    );
    expect(matchingConvs).toHaveLength(0);
  });
});
