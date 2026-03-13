import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ConversationManager } from "../src/conversations/manager.js";
import type { TranscriptTurn, Conversation } from "../src/conversations/types.js";
import {
  ConversationInitiator,
  type SessionFactory,
  type ChannelManagerLike,
} from "../src/agent/conversation-initiator.js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

function makeTurn(
  role: "user" | "assistant",
  turnNumber: number,
): TranscriptTurn {
  return {
    type: "turn",
    role,
    content: `${role} message`,
    timestamp: new Date().toISOString(),
    turnNumber,
  };
}

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
    expect(updated!.lastUserMessageAt).toBeInstanceOf(Date);
    expect(updated!.lastUserMessageAt!.toISOString()).toBe(turn.timestamp);
  });

  it("does NOT update lastUserMessageAt on assistant turn", async () => {
    const conv = await manager.create();

    const assistantTurn = makeTurn("assistant", 1);
    await manager.appendTurn(conv.id, assistantTurn);

    const updated = await manager.get(conv.id);
    expect(updated!.lastUserMessageAt).toBeNull();
  });
});

describe("Task 3: getActiveConversation()", () => {
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

  it("returns conversation with recent user message (within threshold)", async () => {
    const conv = await manager.create();
    const turn: TranscriptTurn = {
      type: "turn",
      role: "user",
      content: "hello",
      timestamp: new Date().toISOString(),
      turnNumber: 1,
    };
    await manager.appendTurn(conv.id, turn);

    const active = await manager.getActiveConversation(15);
    expect(active).not.toBeNull();
    expect(active!.id).toBe(conv.id);
  });

  it("returns null when last user message is older than threshold", async () => {
    const conv = await manager.create();
    const twentyMinsAgo = new Date(Date.now() - 20 * 60 * 1000);
    const turn: TranscriptTurn = {
      type: "turn",
      role: "user",
      content: "old message",
      timestamp: twentyMinsAgo.toISOString(),
      turnNumber: 1,
    };
    await manager.appendTurn(conv.id, turn);

    const active = await manager.getActiveConversation(15);
    expect(active).toBeNull();
  });

  it("returns null when no conversations exist", async () => {
    const active = await manager.getActiveConversation(15);
    expect(active).toBeNull();
  });

  it("returns null when conversation has no user messages", async () => {
    const conv = await manager.create();
    const turn: TranscriptTurn = {
      type: "turn",
      role: "assistant",
      content: "hello from assistant",
      timestamp: new Date().toISOString(),
      turnNumber: 1,
    };
    await manager.appendTurn(conv.id, turn);

    const active = await manager.getActiveConversation(15);
    expect(active).toBeNull();
  });
});

// --- Mock factories for ConversationInitiator tests ---

function createMockSessionFactory(
  response: string = "Good morning!",
): SessionFactory {
  return {
    async *injectSystemTurn(
      _convId: string,
      _prompt: string,
    ): AsyncGenerator<{ type: string; text?: string }> {
      yield { type: "text_delta", text: response };
    },
    async *streamNewConversation(
      _convId: string,
    ): AsyncGenerator<{ type: string; text?: string }> {
      yield { type: "text_delta", text: response };
    },
  };
}

function createMockChannelManager(
  connected: boolean = true,
): ChannelManagerLike & { sent: Array<{ channelId: string; to: string; content: string }> } {
  const sent: Array<{ channelId: string; to: string; content: string }> = [];
  return {
    sent,
    async send(
      channelId: string,
      to: string,
      message: { content: string },
    ) {
      sent.push({ channelId, to, content: message.content });
    },
    getChannelConfig(_id: string) {
      return connected ? { ownerJid: "1234567890@s.whatsapp.net" } : undefined;
    },
    getChannelInfos() {
      return connected
        ? [{ id: "whatsapp", statusDetail: { connected: true } }]
        : [{ id: "whatsapp", statusDetail: { connected: false } }];
    },
  };
}

describe("Task 5: ConversationInitiator", () => {
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
    it("injects system turn into active conversation and returns true", async () => {
      const conv = await manager.create();
      await manager.appendTurn(conv.id, {
        type: "turn",
        role: "user",
        content: "Hello",
        timestamp: new Date().toISOString(),
        turnNumber: 1,
      });

      const sessionFactory = createMockSessionFactory("Morning brief ready!");
      const channelManager = createMockChannelManager(false);
      const initiator = new ConversationInitiator({
        conversationManager: manager,
        sessionFactory,
        channelManager,
        getOutboundChannel: () => "web",
      });

      const result = await initiator.alert("Morning brief is due.");
      expect(result).toBe(true);

      // Verify assistant turn was appended (not the system turn)
      const turns = await manager.getTurns(conv.id);
      expect(turns).toHaveLength(2); // user + assistant
      expect(turns[1].role).toBe("assistant");
      expect(turns[1].content).toBe("Morning brief ready!");
    });

    it("returns false when no active conversation", async () => {
      const sessionFactory = createMockSessionFactory();
      const channelManager = createMockChannelManager();
      const initiator = new ConversationInitiator({
        conversationManager: manager,
        sessionFactory,
        channelManager,
        getOutboundChannel: () => "whatsapp",
      });

      const result = await initiator.alert("Morning brief is due.");
      expect(result).toBe(false);
    });

    it("returns false when conversation is stale (>15 min)", async () => {
      const conv = await manager.create();
      const oldTime = new Date(Date.now() - 20 * 60 * 1000);
      await manager.appendTurn(conv.id, {
        type: "turn",
        role: "user",
        content: "Old message",
        timestamp: oldTime.toISOString(),
        turnNumber: 1,
      });

      const sessionFactory = createMockSessionFactory();
      const channelManager = createMockChannelManager();
      const initiator = new ConversationInitiator({
        conversationManager: manager,
        sessionFactory,
        channelManager,
        getOutboundChannel: () => "web",
      });

      const result = await initiator.alert("Morning brief is due.");
      expect(result).toBe(false);
    });
  });

  describe("initiate()", () => {
    it("creates new conversation and appends first turn", async () => {
      const sessionFactory = createMockSessionFactory("Good morning!");
      const channelManager = createMockChannelManager(false);
      const initiator = new ConversationInitiator({
        conversationManager: manager,
        sessionFactory,
        channelManager,
        getOutboundChannel: () => "web",
      });

      const conv = await initiator.initiate();
      expect(conv).toBeTruthy();
      expect(conv.id).toMatch(/^conv-/);

      // Verify assistant turn was appended
      const turns = await manager.getTurns(conv.id);
      expect(turns).toHaveLength(1);
      expect(turns[0].role).toBe("assistant");
      expect(turns[0].content).toBe("Good morning!");
    });

    it("sends via preferred channel when connected", async () => {
      const sessionFactory = createMockSessionFactory("Good morning!");
      const channelManager = createMockChannelManager(true);
      const initiator = new ConversationInitiator({
        conversationManager: manager,
        sessionFactory,
        channelManager,
        getOutboundChannel: () => "whatsapp",
      });

      await initiator.initiate();
      expect(channelManager.sent).toHaveLength(1);
      expect(channelManager.sent[0].channelId).toBe("whatsapp");
      expect(channelManager.sent[0].content).toBe("Good morning!");
    });

    it("falls back to web when preferred channel is disconnected", async () => {
      const sessionFactory = createMockSessionFactory("Good morning!");
      const channelManager = createMockChannelManager(false);
      const initiator = new ConversationInitiator({
        conversationManager: manager,
        sessionFactory,
        channelManager,
        getOutboundChannel: () => "whatsapp",
      });

      const conv = await initiator.initiate();
      expect(conv).toBeTruthy();
      // No channel send — web fallback
      expect(channelManager.sent).toHaveLength(0);
    });

    it("demotes existing current conversation", async () => {
      const existing = await manager.create();
      expect(existing.status).toBe("current");

      const sessionFactory = createMockSessionFactory("Good morning!");
      const channelManager = createMockChannelManager(false);
      const initiator = new ConversationInitiator({
        conversationManager: manager,
        sessionFactory,
        channelManager,
        getOutboundChannel: () => "web",
      });

      const newConv = await initiator.initiate();
      expect(newConv.id).not.toBe(existing.id);

      const old = await manager.get(existing.id);
      expect(old!.status).toBe("inactive");
    });
  });

  describe("morning brief integration flow", () => {
    it("calls initiate when alert returns false (no active conversation)", async () => {
      const sessionFactory = createMockSessionFactory("Here is your morning brief.");
      const channelManager = createMockChannelManager(false);
      const initiator = new ConversationInitiator({
        conversationManager: manager,
        sessionFactory,
        channelManager,
        getOutboundChannel: () => "web",
      });

      // No active conversation → alert returns false
      const alerted = await initiator.alert("Morning brief ready.");
      expect(alerted).toBe(false);

      // Caller falls back to initiate
      const conv = await initiator.initiate();
      expect(conv).toBeTruthy();

      const turns = await manager.getTurns(conv.id);
      expect(turns).toHaveLength(1);
      expect(turns[0].content).toBe("Here is your morning brief.");
    });

    it("does not initiate when alert succeeds", async () => {
      // Create active conversation
      const conv = await manager.create();
      await manager.appendTurn(conv.id, {
        type: "turn",
        role: "user",
        content: "I'm here",
        timestamp: new Date().toISOString(),
        turnNumber: 1,
      });

      const sessionFactory = createMockSessionFactory("Brief is ready, shall we?");
      const channelManager = createMockChannelManager(false);
      const initiator = new ConversationInitiator({
        conversationManager: manager,
        sessionFactory,
        channelManager,
        getOutboundChannel: () => "web",
      });

      const alerted = await initiator.alert("Morning brief ready.");
      expect(alerted).toBe(true);
      // No need to initiate — brief was delivered in active conversation
    });
  });
});
