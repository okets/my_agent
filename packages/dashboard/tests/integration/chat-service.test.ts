/**
 * ChatService Integration Tests
 *
 * Verifies AppChatService conversation operations work correctly
 * against real services (ConversationManager, SessionRegistry).
 *
 * M6.10-S3: Design spec §S3 (Chat Handler Decomposition)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { AppHarness } from "./app-harness.js";
import { isValidConversationId } from "../../src/chat/chat-service.js";

describe("ChatService Integration", () => {
  let harness: AppHarness;

  beforeEach(async () => {
    harness = await AppHarness.create();
  });

  afterEach(async () => {
    await harness.shutdown();
  });

  describe("connect()", () => {
    it("returns empty state when no conversations exist", async () => {
      const result = await harness.chat.connect();
      expect(result.conversation).toBeNull();
      expect(result.turns).toEqual([]);
      expect(result.hasMore).toBe(false);
      expect(result.allConversations).toEqual([]);
    });

    it("returns current conversation when one exists", async () => {
      const conv = await harness.conversations.create();
      const result = await harness.chat.connect();
      expect(result.conversation?.id).toBe(conv.id);
    });

    it("returns specific conversation when ID provided", async () => {
      await harness.conversations.create();
      const conv2 = await harness.conversations.create();
      const result = await harness.chat.connect(conv2.id);
      expect(result.conversation?.id).toBe(conv2.id);
    });

    it("throws for nonexistent conversation", async () => {
      await expect(
        harness.chat.connect("conv-AAAAAAAAAAAAAAAAAAAAAAAAAA"),
      ).rejects.toThrow("Conversation not found");
    });

    it("includes all conversations in result", async () => {
      await harness.conversations.create();
      await harness.conversations.create();
      await harness.conversations.create();

      const result = await harness.chat.connect();
      expect(result.allConversations.length).toBe(3);
    });
  });

  describe("newConversation()", () => {
    it("creates a new conversation", async () => {
      const result = await harness.chat.newConversation();
      expect(result.conversation.id).toMatch(/^conv-/);
      expect(result.turns).toEqual([]);
      expect(result.hasMore).toBe(false);
    });

    it("emits conversation:created event", async () => {
      const events: any[] = [];
      harness.emitter.on("conversation:created", (conv) => events.push(conv));

      await harness.chat.newConversation();

      expect(events).toHaveLength(1);
      expect(events[0].id).toMatch(/^conv-/);
    });
  });

  describe("newConversationWithWelcome()", () => {
    it("creates conversation with welcome message", async () => {
      const result = await harness.chat.newConversationWithWelcome();
      expect(result.conversation.id).toMatch(/^conv-/);
      expect(result.turns).toHaveLength(1);
      expect(result.turns[0].role).toBe("assistant");
      expect(result.turns[0].content).toContain("Starting fresh");
    });
  });

  describe("switchConversation()", () => {
    it("loads existing conversation", async () => {
      const conv = await harness.conversations.create();
      const result = await harness.chat.switchConversation(conv.id);
      expect(result.conversation.id).toBe(conv.id);
    });

    it("throws for nonexistent conversation", async () => {
      await expect(
        harness.chat.switchConversation("conv-AAAAAAAAAAAAAAAAAAAAAAAAAA"),
      ).rejects.toThrow("Conversation not found");
    });

    it("makes switched conversation current", async () => {
      const conv1 = await harness.conversations.create();
      const conv2 = await harness.conversations.create();

      await harness.chat.switchConversation(conv1.id);

      // conv1 should be current now
      const result = await harness.chat.connect();
      expect(result.conversation?.id).toBe(conv1.id);
    });
  });

  describe("deleteConversation()", () => {
    it("deletes conversation and emits event", async () => {
      const events: string[] = [];
      harness.emitter.on("conversation:deleted", (id) => events.push(id));

      const conv = await harness.conversations.create();
      await harness.chat.deleteConversation(conv.id);

      expect(events).toHaveLength(1);
      expect(events[0]).toBe(conv.id);
    });

    it("throws for nonexistent conversation", async () => {
      await expect(
        harness.chat.deleteConversation("conv-AAAAAAAAAAAAAAAAAAAAAAAAAA"),
      ).rejects.toThrow("Conversation not found");
    });

    it("calls cleanup hooks", async () => {
      const conv = await harness.conversations.create();
      const cleaned: string[] = [];

      await harness.chat.deleteConversation(conv.id, {
        cancelAbbreviation: (id) => cleaned.push(`cancel:${id}`),
        clearIdleTimer: (id) => cleaned.push(`timer:${id}`),
        deleteAttachments: (id) => cleaned.push(`attach:${id}`),
        removeSearchEmbeddings: (id) => cleaned.push(`search:${id}`),
      });

      expect(cleaned).toEqual([
        `cancel:${conv.id}`,
        `timer:${conv.id}`,
        `attach:${conv.id}`,
        `search:${conv.id}`,
      ]);
    });
  });

  describe("deleteIfEmpty()", () => {
    it("deletes conversation with 0 turns", async () => {
      const conv = await harness.conversations.create();
      await harness.chat.deleteIfEmpty(conv.id);

      const check = await harness.conversationManager.get(conv.id);
      expect(check).toBeNull();
    });

    it("keeps conversation with turns", async () => {
      const conv = await harness.conversations.create();

      // Add a turn
      await harness.conversationManager.appendTurn(conv.id, {
        type: "turn",
        role: "user",
        content: "hello",
        timestamp: new Date().toISOString(),
        turnNumber: 1,
      });

      await harness.chat.deleteIfEmpty(conv.id);

      const check = await harness.conversationManager.get(conv.id);
      expect(check).not.toBeNull();
    });
  });

  describe("renameConversation()", () => {
    it("renames conversation", async () => {
      const conv = await harness.conversations.create();
      const result = await harness.chat.renameConversation(
        conv.id,
        "New Title",
      );
      expect(result).toBe("New Title");

      const updated = await harness.conversationManager.get(conv.id);
      expect(updated?.title).toBe("New Title");
    });

    it("truncates to 100 chars", async () => {
      const conv = await harness.conversations.create();
      const longTitle = "A".repeat(200);
      const result = await harness.chat.renameConversation(conv.id, longTitle);
      expect(result.length).toBe(100);
    });
  });

  describe("loadMoreTurns()", () => {
    it("returns empty when no turns exist", async () => {
      const conv = await harness.conversations.create();
      const result = await harness.chat.loadMoreTurns(
        conv.id,
        new Date().toISOString(),
      );
      expect(result.turns).toEqual([]);
      expect(result.hasMore).toBe(false);
    });
  });

  describe("isValidConversationId()", () => {
    it("validates correct format", () => {
      expect(
        isValidConversationId("conv-ABCDEFGHIJ1234567890123456"),
      ).toBe(true);
    });

    it("rejects bad format", () => {
      expect(isValidConversationId("bad-id")).toBe(false);
      expect(isValidConversationId("")).toBe(false);
      expect(isValidConversationId("conv-short")).toBe(false);
    });
  });
});
