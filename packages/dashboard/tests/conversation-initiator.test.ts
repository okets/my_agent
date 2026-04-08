import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ConversationManager } from "../src/conversations/manager.js";
import type { TranscriptTurn } from "../src/conversations/types.js";
import {
  ConversationInitiator,
  type ChatServiceLike,
  type TransportManagerLike,
} from "../src/agent/conversation-initiator.js";
import type { ChatEvent } from "../src/chat/types.js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

function makeTurn(
  role: "user" | "assistant",
  turnNumber: number,
  options?: { channel?: string; timestamp?: string },
): TranscriptTurn {
  return {
    type: "turn",
    role,
    content: `${role} message`,
    timestamp: options?.timestamp ?? new Date().toISOString(),
    turnNumber,
    channel: options?.channel,
  };
}

// --- Mock factories ---

function createMockChatService(
  response: string = "Good morning!",
): ChatServiceLike & {
  calls: Array<{ conversationId: string; prompt: string; turnNumber: number }>;
} {
  const calls: Array<{
    conversationId: string;
    prompt: string;
    turnNumber: number;
  }> = [];
  return {
    calls,
    async *sendSystemMessage(
      conversationId: string,
      prompt: string,
      turnNumber: number,
    ): AsyncGenerator<ChatEvent> {
      calls.push({ conversationId, prompt, turnNumber });
      yield { type: "start" };
      yield { type: "text_delta", text: response };
      yield { type: "done" };
    },
  };
}

function createMockChannelManager(
  connected: boolean = true,
): TransportManagerLike & {
  sent: Array<{ channelId: string; to: string; content: string }>;
} {
  const sent: Array<{ channelId: string; to: string; content: string }> = [];
  return {
    sent,
    async send(channelId: string, to: string, message: { content: string }) {
      sent.push({ channelId, to, content: message.content });
    },
    getTransportConfig(_id: string) {
      return connected ? { ownerJid: "1234567890@s.whatsapp.net" } : undefined;
    },
    getTransportInfos() {
      return connected
        ? [{ id: "whatsapp", statusDetail: { connected: true } }]
        : [{ id: "whatsapp", statusDetail: { connected: false } }];
    },
  };
}

// --- Task 1: last_user_message_at column ---

describe("Task 1: last_user_message_at column exists", () => {
  let manager: ConversationManager;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "conv-initiator-"));
    fs.mkdirSync(path.join(tmpDir, "conversations"), { recursive: true });
    manager = new ConversationManager(tmpDir);
  });

  afterEach(() => {
    manager.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("conversations table has last_user_message_at column", () => {
    const db = manager.getDb();
    const columns = db
      .prepare("PRAGMA table_info(conversations)")
      .all() as Array<{ name: string }>;
    const hasColumn = columns.some((c) => c.name === "last_user_message_at");
    expect(hasColumn).toBe(true);
  });
});

// --- Task 2: lastUserMessageAt tracking ---

describe("Task 2: lastUserMessageAt tracking in appendTurn()", () => {
  let manager: ConversationManager;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "conv-initiator-"));
    fs.mkdirSync(path.join(tmpDir, "conversations"), { recursive: true });
    manager = new ConversationManager(tmpDir);
  });

  afterEach(() => {
    manager.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("updates lastUserMessageAt on user turn", async () => {
    const conv = await manager.create();
    expect(conv.lastUserMessageAt).toBeNull();
    const turn = makeTurn("user", 1);
    await manager.appendTurn(conv.id, turn);
    const updated = await manager.get(conv.id);
    expect(updated!.lastUserMessageAt).not.toBeNull();
  });

  it("does NOT update lastUserMessageAt on assistant turn", async () => {
    const conv = await manager.create();
    await manager.appendTurn(conv.id, makeTurn("assistant", 1));
    const updated = await manager.get(conv.id);
    expect(updated!.lastUserMessageAt).toBeNull();
  });
});

// --- Task 3: getCurrent() replaces getActiveConversation() ---

describe("Task 3: getCurrent() replaces getActiveConversation()", () => {
  let manager: ConversationManager;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "conv-initiator-"));
    fs.mkdirSync(path.join(tmpDir, "conversations"), { recursive: true });
    manager = new ConversationManager(tmpDir);
  });

  afterEach(() => {
    manager.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns the current conversation regardless of user message age", async () => {
    const conv = await manager.create();
    const oldTime = new Date(Date.now() - 20 * 60 * 1000);
    await manager.appendTurn(
      conv.id,
      makeTurn("user", 1, { timestamp: oldTime.toISOString() }),
    );
    const current = await manager.getCurrent();
    expect(current).not.toBeNull();
    expect(current!.id).toBe(conv.id);
  });

  it("returns null when no conversations exist", async () => {
    const current = await manager.getCurrent();
    expect(current).toBeNull();
  });
});

// --- ConversationInitiator tests ---

describe("ConversationInitiator", () => {
  let manager: ConversationManager;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "conv-initiator-"));
    fs.mkdirSync(path.join(tmpDir, "conversations"), { recursive: true });
    manager = new ConversationManager(tmpDir);
  });

  afterEach(() => {
    manager.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("alert()", () => {
    it("delivers via app.chat when user has recent web message", async () => {
      const conv = await manager.create();
      await manager.appendTurn(conv.id, makeTurn("user", 1)); // no channel = web

      const chatService = createMockChatService("Morning brief ready!");
      const initiator = new ConversationInitiator({
        conversationManager: manager,
        chatService,
        channelManager: createMockChannelManager(false),
        getOutboundChannel: () => "web",
      });

      const result = await initiator.alert("Morning brief is due.");
      expect(result).toBe(true);
      expect(chatService.calls).toHaveLength(1);
      expect(chatService.calls[0].conversationId).toBe(conv.id);
    });

    it("returns true even when last web message is stale (>15 min)", async () => {
      const conv = await manager.create();
      const oldTime = new Date(Date.now() - 20 * 60 * 1000);
      await manager.appendTurn(
        conv.id,
        makeTurn("user", 1, { timestamp: oldTime.toISOString() }),
      );

      const chatService = createMockChatService();
      const initiator = new ConversationInitiator({
        conversationManager: manager,
        chatService,
        channelManager: createMockChannelManager(false),
        getOutboundChannel: () => "web",
      });

      const result = await initiator.alert("Morning brief is due.");
      expect(result).toBe(true);
    });

    it("returns false when no current conversation exists", async () => {
      // Don't create any conversation
      const chatService = createMockChatService();
      const initiator = new ConversationInitiator({
        conversationManager: manager,
        chatService,
        channelManager: createMockChannelManager(),
        getOutboundChannel: () => "whatsapp",
      });

      const result = await initiator.alert("Morning brief is due.");
      expect(result).toBe(false);
    });

    it("dashboard-sourced alerts never route to WhatsApp", async () => {
      const conv = await manager.create();
      const oldTime = new Date(Date.now() - 20 * 60 * 1000);
      await manager.appendTurn(
        conv.id,
        makeTurn("user", 1, { timestamp: oldTime.toISOString() }),
      );

      const chatService = createMockChatService();
      const channelManager = createMockChannelManager(true);
      const initiator = new ConversationInitiator({
        conversationManager: manager,
        chatService,
        channelManager,
        getOutboundChannel: () => "whatsapp",
      });

      const result = await initiator.alert("test prompt", {
        sourceChannel: "dashboard",
      });
      expect(result).toBe(true);
      expect(channelManager.sent).toHaveLength(0);
      expect(chatService.calls).toHaveLength(1);
    });

    it("routes to WhatsApp when web message is stale and preferred channel is whatsapp", async () => {
      const conv = await manager.create();
      const oldTime = new Date(Date.now() - 20 * 60 * 1000);
      await manager.appendTurn(
        conv.id,
        makeTurn("user", 1, { timestamp: oldTime.toISOString() }),
      );

      const chatService = createMockChatService("Notification delivered");
      const channelManager = createMockChannelManager(true);
      const initiator = new ConversationInitiator({
        conversationManager: manager,
        chatService,
        channelManager,
        getOutboundChannel: () => "whatsapp",
      });

      const result = await initiator.alert("Task completed.");
      expect(result).toBe(true);
      // Should have created a new conversation via initiate() (channel switch)
      expect(chatService.calls.length).toBeGreaterThanOrEqual(1);
    });

    it("continues current conversation when same channel (no new conversation)", async () => {
      // Create conversation with externalParty matching the mock channel's ownerJid
      const conv = await manager.create({
        externalParty: "1234567890@s.whatsapp.net",
      });
      // Stale web message — will route via channel
      const oldTime = new Date(Date.now() - 20 * 60 * 1000);
      await manager.appendTurn(
        conv.id,
        makeTurn("user", 1, {
          channel: "whatsapp",
          timestamp: oldTime.toISOString(),
        }),
      );

      const chatService = createMockChatService("Continued on WhatsApp");
      const channelManager = createMockChannelManager(true);
      const initiator = new ConversationInitiator({
        conversationManager: manager,
        chatService,
        channelManager,
        getOutboundChannel: () => "whatsapp",
      });

      const result = await initiator.alert("Task completed.");
      expect(result).toBe(true);
      // Should continue in CURRENT conversation (same channel), not create new one
      expect(chatService.calls).toHaveLength(1);
      expect(chatService.calls[0].conversationId).toBe(conv.id);
      // Should forward to WhatsApp
      expect(channelManager.sent).toHaveLength(1);
      expect(channelManager.sent[0].content).toBe("Continued on WhatsApp");
    });

    it("returns null web age when only channel messages exist", async () => {
      const conv = await manager.create();
      await manager.appendTurn(
        conv.id,
        makeTurn("user", 1, { channel: "whatsapp" }),
      );

      const chatService = createMockChatService("Response");
      const channelManager = createMockChannelManager(true);
      const initiator = new ConversationInitiator({
        conversationManager: manager,
        chatService,
        channelManager,
        getOutboundChannel: () => "whatsapp",
      });

      const result = await initiator.alert("test");
      expect(result).toBe(true);
      // No web messages = not on web, routes via channel
      expect(chatService.calls.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("initiate()", () => {
    it("creates new conversation and invokes brain via app.chat", async () => {
      const chatService = createMockChatService("Good morning!");
      const initiator = new ConversationInitiator({
        conversationManager: manager,
        chatService,
        channelManager: createMockChannelManager(false),
        getOutboundChannel: () => "web",
      });

      const conv = await initiator.initiate();
      expect(conv).toBeTruthy();
      expect(conv.id).toMatch(/^conv-/);
      expect(chatService.calls).toHaveLength(1);
      expect(chatService.calls[0].conversationId).toBe(conv.id);
      expect(chatService.calls[0].turnNumber).toBe(1);
    });

    it("sends via preferred channel when connected", async () => {
      const chatService = createMockChatService("Good morning!");
      const channelManager = createMockChannelManager(true);
      const initiator = new ConversationInitiator({
        conversationManager: manager,
        chatService,
        channelManager,
        getOutboundChannel: () => "whatsapp",
      });

      await initiator.initiate();
      expect(channelManager.sent).toHaveLength(1);
      expect(channelManager.sent[0].content).toBe("Good morning!");
    });

    it("demotes existing current conversation", async () => {
      const existing = await manager.create();
      expect(existing.status).toBe("current");

      const chatService = createMockChatService("Good morning!");
      const initiator = new ConversationInitiator({
        conversationManager: manager,
        chatService,
        channelManager: createMockChannelManager(false),
        getOutboundChannel: () => "web",
      });

      const newConv = await initiator.initiate();
      expect(newConv.id).not.toBe(existing.id);
      const old = await manager.get(existing.id);
      expect(old!.status).toBe("inactive");
    });
  });

  describe("daily brief integration flow", () => {
    it("alert() always succeeds when a conversation exists", async () => {
      const conv = await manager.create();
      await manager.appendTurn(conv.id, makeTurn("user", 1));

      const chatService = createMockChatService("Brief is ready, shall we?");
      const initiator = new ConversationInitiator({
        conversationManager: manager,
        chatService,
        channelManager: createMockChannelManager(false),
        getOutboundChannel: () => "web",
      });

      const alerted = await initiator.alert("Morning brief ready.");
      expect(alerted).toBe(true);
      expect(chatService.calls).toHaveLength(1);
    });
  });
});
