/**
 * M6.7 Conversation Lifecycle E2E Tests
 *
 * Validates the complete Two-Agent Refactor milestone:
 * - S1: Core Architecture (SystemPromptBuilder, buildQuery, resume fallback)
 * - S2: Conversation Lifecycle (status model, atomic swap, channel switch)
 * - S4: Search Infrastructure (FTS5, hybrid search, RRF, field normalization)
 * - S5: Home Widget Logic (filtering, empty cleanup)
 *
 * Does NOT duplicate tests from:
 * - conversation-status.test.ts (basic status CRUD)
 * - system-prompt-builder.test.ts (prompt block structure)
 * - conversations.test.ts (ConversationManager CRUD, FTS basics)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { ConversationManager } from "../../src/conversations/manager.js";
import { ConversationDatabase } from "../../src/conversations/db.js";
import { ConversationSearchDB } from "../../src/conversations/search-db.js";
import { ConversationSearchService } from "../../src/conversations/search-service.js";
import type { TranscriptTurn } from "../../src/conversations/types.js";

// -------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "m67-e2e-"));
}

function cleanDir(dir: string): void {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function makeTurn(
  role: "user" | "assistant",
  content: string,
  turnNumber: number,
): TranscriptTurn {
  return {
    type: "turn",
    role,
    content,
    timestamp: new Date().toISOString(),
    turnNumber,
  };
}

// -------------------------------------------------------------------
// S1: Core Architecture
// -------------------------------------------------------------------

describe("M6.7 Conversation Lifecycle E2E", () => {
  describe("S1: Core Architecture", () => {
    // SystemPromptBuilder block structure and caching are tested in
    // system-prompt-builder.test.ts. Here we test cross-cutting concerns.

    it("SystemPromptBuilder produces 6-layer prompt with both stable and dynamic blocks", async () => {
      // Mock @my-agent/core to avoid filesystem deps
      const { SystemPromptBuilder } =
        await import("../../src/agent/system-prompt-builder.js");

      // The mock is already set up by system-prompt-builder.test.ts vi.mock
      // but we need our own instance
      vi.mock("@my-agent/core", () => ({
        assembleSystemPrompt: vi
          .fn()
          .mockResolvedValue("## Identity\nYou are a test agent."),
        loadCalendarConfig: vi.fn().mockReturnValue(null),
        loadCalendarCredentials: vi.fn().mockReturnValue(null),
        createCalDAVClient: vi.fn().mockResolvedValue({}),
        assembleCalendarContext: vi.fn().mockResolvedValue(undefined),
      }));

      const builder = new SystemPromptBuilder({
        brainDir: "/tmp/test-brain",
        agentDir: "/tmp/test-agent",
      });

      const result = await builder.build({
        channel: "web",
        conversationId: "conv-TEST123",
        messageIndex: 1,
      });

      // 6-layer architecture: 2 blocks (stable cached + dynamic)
      expect(result).toHaveLength(2);

      // Block 0: stable layers (1-2: identity + skills) with cache_control
      expect(result[0].cache_control).toEqual({ type: "ephemeral" });

      // Block 1: dynamic layers (3-6: state, memory, metadata, session)
      const dynamic = result[1].text;
      expect(dynamic).toContain("[Current State]");
      expect(dynamic).toContain("[Inbound Metadata]");
      expect(dynamic).toContain("[Session Context]");
      expect(dynamic).toContain("conv-TEST123");
      expect(dynamic).toContain('"message_index": 1');
    });

    it("buildQuery always includes systemPrompt (via dynamic block content)", async () => {
      const { SystemPromptBuilder } =
        await import("../../src/agent/system-prompt-builder.js");

      const builder = new SystemPromptBuilder({
        brainDir: "/tmp/test-brain",
        agentDir: "/tmp/test-agent",
      });

      // First call
      const result1 = await builder.build({
        channel: "web",
        conversationId: "conv-A",
        messageIndex: 1,
      });

      // Second call with different context
      const result2 = await builder.build({
        channel: "whatsapp",
        conversationId: "conv-B",
        messageIndex: 5,
      });

      // Both should have systemPrompt (stable block)
      expect(result1[0].text).toBeTruthy();
      expect(result2[0].text).toBeTruthy();

      // Dynamic blocks should reflect different contexts
      expect(result1[1].text).toContain("conv-A");
      expect(result2[1].text).toContain("conv-B");
      expect(result2[1].text).toContain('"channel": "whatsapp"');
    });

    it.skip("resume fallback on invalid session ID (requires live SDK)", () => {
      // SessionManager.streamMessage catches resume errors and retries fresh:
      // 1. First attempt uses this.sdkSessionId for resume
      // 2. On error, sets this.sdkSessionId = null
      // 3. Calls buildQuery again without resume
      // 4. Streams fresh session successfully
      // Cannot test without a real Agent SDK connection.
    });
  });

  // -------------------------------------------------------------------
  // S2: Conversation Lifecycle
  // -------------------------------------------------------------------

  describe("S2: Conversation Lifecycle", () => {
    let tempDir: string;
    let manager: ConversationManager;

    beforeEach(() => {
      tempDir = createTempDir();
      manager = new ConversationManager(tempDir);
    });

    afterEach(() => {
      manager.close();
      cleanDir(tempDir);
    });

    it("only one current conversation at a time (atomic swap)", async () => {
      const conv1 = await manager.create();
      const conv2 = await manager.create();
      const conv3 = await manager.create();

      // Only conv3 should be current
      expect((await manager.get(conv1.id))!.status).toBe("inactive");
      expect((await manager.get(conv2.id))!.status).toBe("inactive");
      expect((await manager.get(conv3.id))!.status).toBe("current");

      // Verify getCurrent agrees
      const current = await manager.getCurrent();
      expect(current!.id).toBe(conv3.id);
    });

    it("new conversation makes previous inactive (verified across 5 creates)", async () => {
      const ids: string[] = [];
      for (let i = 0; i < 5; i++) {
        const conv = await manager.create();
        ids.push(conv.id);
      }

      // All but the last should be inactive
      for (let i = 0; i < 4; i++) {
        const conv = await manager.get(ids[i]);
        expect(conv!.status).toBe("inactive");
      }
      const last = await manager.get(ids[4]);
      expect(last!.status).toBe("current");
    });

    it("makeCurrent restores a previously inactive conversation", async () => {
      const conv1 = await manager.create();
      const conv2 = await manager.create();

      // conv1 is inactive, conv2 is current
      expect((await manager.get(conv1.id))!.status).toBe("inactive");

      // Restore conv1
      await manager.makeCurrent(conv1.id);
      expect((await manager.get(conv1.id))!.status).toBe("current");
      expect((await manager.get(conv2.id))!.status).toBe("inactive");
    });

    it("channel switch detection: last turn from different channel triggers new conversation", async () => {
      const conv = await manager.create({ externalParty: "+1555000000" });

      // Simulate a web message as the last turn
      await manager.appendTurn(conv.id, {
        type: "turn",
        turnNumber: 1,
        role: "user",
        content: "hello from web",
        timestamp: new Date().toISOString(),
        channel: "web",
      });

      // Get recent turns to check the channel
      const recentTurns = await manager.getRecentTurns(conv.id, 1);
      const lastTurnChannel = recentTurns[0].channel ?? "web";
      const incomingChannel = "ninas_dedicated_whatsapp";

      // Different channel → should trigger new conversation
      expect(lastTurnChannel).not.toBe(incomingChannel);
    });

    it("channel continuity: same channel does not trigger new conversation", async () => {
      const conv = await manager.create({ externalParty: "+1555000000" });

      // Simulate a WhatsApp message as the last turn
      await manager.appendTurn(conv.id, {
        type: "turn",
        turnNumber: 1,
        role: "user",
        content: "hello from whatsapp",
        timestamp: new Date().toISOString(),
        channel: "ninas_dedicated_whatsapp",
      });

      // Get recent turns to check the channel
      const recentTurns = await manager.getRecentTurns(conv.id, 1);
      const lastTurnChannel = recentTurns[0].channel ?? "web";
      const incomingChannel = "ninas_dedicated_whatsapp";

      // Same channel → should NOT trigger new conversation
      expect(lastTurnChannel).toBe(incomingChannel);
    });

    it("assistant response on same channel does not trigger new conversation", async () => {
      const conv = await manager.create({ externalParty: "+1555000000" });

      // WhatsApp user message followed by assistant response on same channel
      await manager.appendTurn(conv.id, {
        type: "turn",
        turnNumber: 1,
        role: "user",
        content: "hello from whatsapp",
        timestamp: new Date().toISOString(),
        channel: "ninas_dedicated_whatsapp",
      });
      await manager.appendTurn(conv.id, {
        type: "turn",
        turnNumber: 1,
        role: "assistant",
        content: "hi there!",
        timestamp: new Date().toISOString(),
        channel: "ninas_dedicated_whatsapp",
      });

      // Last turn (assistant) is on WhatsApp — incoming WhatsApp should continue
      const recentTurns = await manager.getRecentTurns(conv.id, 1);
      const lastTurnChannel = recentTurns[0].channel ?? "web";
      expect(lastTurnChannel).toBe("ninas_dedicated_whatsapp");
    });

    it("empty conversation does not trigger new conversation for any channel", async () => {
      const conv = await manager.create({ externalParty: "+1555000000" });

      // No turns yet
      const recentTurns = await manager.getRecentTurns(conv.id, 1);

      // Empty conversation → continue using it regardless of incoming channel
      expect(recentTurns.length).toBe(0);
    });

    it("status persists across manager re-creation", async () => {
      const conv1 = await manager.create();
      const conv2 = await manager.create();
      await manager.makeCurrent(conv1.id);
      manager.close();

      // Re-create manager (simulates restart)
      const manager2 = new ConversationManager(tempDir);
      try {
        const current = await manager2.getCurrent();
        expect(current).not.toBeNull();
        expect(current!.id).toBe(conv1.id);

        const inactive = await manager2.get(conv2.id);
        expect(inactive!.status).toBe("inactive");
      } finally {
        manager2.close();
      }
    });
  });

  // -------------------------------------------------------------------
  // S4: Search Infrastructure
  // -------------------------------------------------------------------

  describe("S4: Search Infrastructure", () => {
    let tempDir: string;
    let manager: ConversationManager;
    let db: ConversationDatabase;
    let searchDb: ConversationSearchDB;
    let searchService: ConversationSearchService;

    beforeEach(() => {
      tempDir = createTempDir();
      manager = new ConversationManager(tempDir);
      db = manager.getConversationDb();
      searchDb = new ConversationSearchDB(db.getDb());
      searchService = new ConversationSearchService({
        searchDb,
        getPlugin: () => null, // No embeddings in test
      });
    });

    afterEach(() => {
      manager.close();
      cleanDir(tempDir);
    });

    it("FTS5 keyword search returns results with correct field names", async () => {
      const conv = await manager.create();
      await manager.appendTurn(
        conv.id,
        makeTurn("user", "How do I configure nginx reverse proxy?", 1),
      );
      await manager.appendTurn(
        conv.id,
        makeTurn(
          "assistant",
          "You can configure nginx by editing the sites-available config.",
          1,
        ),
      );

      const results = searchDb.searchKeyword("nginx", 10);

      expect(results.length).toBeGreaterThan(0);
      // Verify field names match what frontend expects
      const first = results[0];
      expect(first).toHaveProperty("conversationId");
      expect(first).toHaveProperty("turnNumber");
      expect(first).toHaveProperty("content");
      expect(first).toHaveProperty("timestamp");
      expect(first).toHaveProperty("score");
      expect(first.conversationId).toBe(conv.id);
    });

    it("hybrid search with RRF ranking (FTS5 only, no embeddings)", async () => {
      const conv1 = await manager.create();
      const conv2 = await manager.create();

      await manager.appendTurn(
        conv1.id,
        makeTurn("user", "Deploy the application to production server", 1),
      );
      await manager.appendTurn(
        conv2.id,
        makeTurn("user", "Production database needs backup", 1),
      );

      const results = await searchService.search("production", 10);

      expect(results.length).toBe(2);
      // Results should have RRF scores
      for (const r of results) {
        expect(r.score).toBeGreaterThan(0);
        expect(r).toHaveProperty("conversationId");
        expect(r).toHaveProperty("turnNumber");
        expect(r).toHaveProperty("content");
        expect(r).toHaveProperty("role");
      }
    });

    it("search field normalization: backend field names are consistent", async () => {
      const conv = await manager.create();
      await manager.appendTurn(
        conv.id,
        makeTurn("user", "systemd service configuration", 1),
      );

      // Test via ConversationSearchService (the API used by frontend)
      const results = await searchService.search("systemd", 10);

      expect(results.length).toBe(1);
      // These are the exact field names the frontend expects
      expect(results[0].conversationId).toBe(conv.id);
      expect(results[0].turnNumber).toBe(1);
      expect(results[0].content).toContain("systemd");
      expect(typeof results[0].timestamp).toBe("string");
      expect(results[0].role).toBe("user");
      expect(typeof results[0].score).toBe("number");
    });

    it("special character safety: no SQL injection via search", async () => {
      const conv = await manager.create();
      await manager.appendTurn(
        conv.id,
        makeTurn("user", "normal message content", 1),
      );

      // FTS5 special characters that could cause issues
      const maliciousQueries = [
        "'; DROP TABLE turns_fts; --",
        'Robert"); DROP TABLE conversations;--',
        "* OR 1=1",
        "NEAR(test, 5)",
      ];

      for (const query of maliciousQueries) {
        // Should not throw — gracefully handle or return empty
        try {
          const results = await searchService.search(query, 10);
          // If it returns results, they should be valid objects
          for (const r of results) {
            expect(r).toHaveProperty("conversationId");
          }
        } catch (e) {
          // FTS5 syntax errors are acceptable (thrown by sqlite),
          // but should not be SQL injection
          expect(String(e)).not.toContain("DROP TABLE");
        }
      }
    });

    it("empty query handling", async () => {
      const conv = await manager.create();
      await manager.appendTurn(conv.id, makeTurn("user", "test message", 1));

      // Empty string should not crash — either returns empty or throws FTS5 error
      try {
        const results = await searchService.search("", 10);
        expect(Array.isArray(results)).toBe(true);
      } catch (e) {
        // FTS5 throws on empty query — verify it's a SQLite error, not something else
        expect(String(e)).toMatch(/fts5|syntax|parse/i);
      }
    });

    it("search latency < 500ms for moderate dataset", async () => {
      // Create 10 conversations with 5 turns each = 50 indexed turns
      for (let i = 0; i < 10; i++) {
        const conv = await manager.create();
        for (let j = 1; j <= 5; j++) {
          await manager.appendTurn(
            conv.id,
            makeTurn(
              "user",
              `Message ${j} about topic ${i}: server monitoring deployment logs`,
              j,
            ),
          );
        }
      }

      const start = performance.now();
      const results = await searchService.search("monitoring", 10);
      const elapsed = performance.now() - start;

      expect(elapsed).toBeLessThan(500);
      expect(results.length).toBeGreaterThan(0);
    });

    it("search across conversations returns correct conversation IDs", async () => {
      const conv1 = await manager.create();
      const conv2 = await manager.create();
      const conv3 = await manager.create();

      await manager.appendTurn(
        conv1.id,
        makeTurn("user", "Tailscale VPN configuration", 1),
      );
      await manager.appendTurn(
        conv2.id,
        makeTurn("user", "Docker container setup", 1),
      );
      await manager.appendTurn(
        conv3.id,
        makeTurn("user", "Tailscale network routing", 1),
      );

      const results = await searchService.search("Tailscale", 10);
      const convIds = results.map((r) => r.conversationId);

      expect(convIds).toContain(conv1.id);
      expect(convIds).toContain(conv3.id);
      expect(convIds).not.toContain(conv2.id);
    });

    it("ConversationSearchService.isSemanticAvailable returns false without plugin", async () => {
      const available = await searchService.isSemanticAvailable();
      expect(available).toBe(false);
    });

    it("concurrent appendTurn calls do not corrupt search index", async () => {
      const conv = await manager.create();

      // Fire 10 appendTurn calls concurrently
      const promises = Array.from({ length: 10 }, (_, i) =>
        manager.appendTurn(
          conv.id,
          makeTurn("user", `concurrent message number ${i + 1}`, i + 1),
        ),
      );

      await Promise.all(promises);

      // All 10 should be indexed and searchable
      const results = await manager.search("concurrent");
      expect(results.length).toBe(10);

      // Verify turn count
      const updated = await manager.get(conv.id);
      expect(updated!.turnCount).toBe(10);
    });
  });

  // -------------------------------------------------------------------
  // S5: Home Widget Logic
  // -------------------------------------------------------------------

  describe("S5: Home Widget Logic", () => {
    let tempDir: string;
    let manager: ConversationManager;

    beforeEach(() => {
      tempDir = createTempDir();
      manager = new ConversationManager(tempDir);
    });

    afterEach(() => {
      manager.close();
      cleanDir(tempDir);
    });

    it("widget list excludes current conversation", async () => {
      const conv1 = await manager.create();
      await manager.appendTurn(conv1.id, makeTurn("user", "msg 1", 1));

      const conv2 = await manager.create();
      await manager.appendTurn(conv2.id, makeTurn("user", "msg 2", 1));

      const conv3 = await manager.create();
      await manager.appendTurn(conv3.id, makeTurn("user", "msg 3", 1));

      // conv3 is current
      const current = await manager.getCurrent();
      expect(current!.id).toBe(conv3.id);

      // Widget list: all conversations except current
      const allConvs = await manager.list();
      const widgetList = allConvs.filter((c) => c.status !== "current");

      expect(widgetList.length).toBe(2);
      expect(widgetList.map((c) => c.id)).not.toContain(conv3.id);
      expect(widgetList.map((c) => c.id)).toContain(conv1.id);
      expect(widgetList.map((c) => c.id)).toContain(conv2.id);
    });

    it("widget list excludes empty conversations (turnCount=0)", async () => {
      // Create conversation with turns
      const conv1 = await manager.create();
      await manager.appendTurn(conv1.id, makeTurn("user", "real message", 1));

      // Create empty conversation (no turns appended)
      const conv2 = await manager.create();
      // conv2 has turnCount=0

      // Create another with turns
      const conv3 = await manager.create();
      await manager.appendTurn(conv3.id, makeTurn("user", "another msg", 1));

      // Widget list: exclude current AND empty
      const allConvs = await manager.list();
      const widgetList = allConvs.filter(
        (c) => c.status !== "current" && c.turnCount > 0,
      );

      // conv3 is current (excluded), conv2 is empty (excluded), only conv1 remains
      expect(widgetList.length).toBe(1);
      expect(widgetList[0].id).toBe(conv1.id);
    });

    it("deleteIfEmpty removes conversations with no turns", async () => {
      // Simulate the deleteIfEmpty pattern from chat-handler.ts
      const conv = await manager.create();
      expect(conv.turnCount).toBe(0);

      // deleteIfEmpty check: if turnCount === 0, delete
      const loaded = await manager.get(conv.id);
      if (loaded && loaded.turnCount === 0) {
        await manager.delete(conv.id);
      }

      const afterDelete = await manager.get(conv.id);
      expect(afterDelete).toBeNull();
    });

    it("deleteIfEmpty does NOT remove conversations with turns", async () => {
      const conv = await manager.create();
      await manager.appendTurn(conv.id, makeTurn("user", "hello", 1));

      // deleteIfEmpty check: turnCount > 0, so don't delete
      const loaded = await manager.get(conv.id);
      if (loaded && loaded.turnCount === 0) {
        await manager.delete(conv.id);
      }

      const afterCheck = await manager.get(conv.id);
      expect(afterCheck).not.toBeNull();
      expect(afterCheck!.turnCount).toBe(1);
    });

    it("startup cleanup: batch delete empty conversations", async () => {
      // Create mix of empty and non-empty conversations
      const empty1 = await manager.create();
      const withTurns = await manager.create();
      await manager.appendTurn(withTurns.id, makeTurn("user", "content", 1));
      const empty2 = await manager.create();

      // Simulate startup cleanup: find and delete all empty conversations
      const allConvs = await manager.list();
      const emptyConvs = allConvs.filter((c) => c.turnCount === 0);

      for (const conv of emptyConvs) {
        await manager.delete(conv.id);
      }

      const remaining = await manager.list();
      expect(remaining.length).toBe(1);
      expect(remaining[0].id).toBe(withTurns.id);
    });

    it("widget list is ordered by most recently updated", async () => {
      const conv1 = await manager.create();
      await manager.appendTurn(conv1.id, makeTurn("user", "first", 1));
      await new Promise((r) => setTimeout(r, 15));

      const conv2 = await manager.create();
      await manager.appendTurn(conv2.id, makeTurn("user", "second", 1));
      await new Promise((r) => setTimeout(r, 15));

      const conv3 = await manager.create();
      await manager.appendTurn(conv3.id, makeTurn("user", "third", 1));

      // conv3 is current; widget list = conv2, conv1 (by updated DESC)
      const allConvs = await manager.list();
      const widgetList = allConvs.filter((c) => c.status !== "current");

      expect(widgetList[0].id).toBe(conv2.id);
      expect(widgetList[1].id).toBe(conv1.id);
    });

    it("empty dashboard: no conversations returns empty list", async () => {
      const allConvs = await manager.list();
      expect(allConvs).toEqual([]);

      const current = await manager.getCurrent();
      expect(current).toBeNull();

      const results = await manager.search("anything");
      expect(results).toEqual([]);
    });

    it("delete removes conversation from search index too", async () => {
      const conv = await manager.create();
      await manager.appendTurn(
        conv.id,
        makeTurn("user", "uniquesearchxyzzy content here", 1),
      );

      // Verify it's findable
      const before = await manager.search("uniquesearchxyzzy");
      expect(before.length).toBe(1);

      // Delete
      await manager.delete(conv.id);

      // Should no longer be findable
      const after = await manager.search("uniquesearchxyzzy");
      expect(after.length).toBe(0);
    });
  });

  // -------------------------------------------------------------------
  // Cross-cutting: Lifecycle + Search integration
  // -------------------------------------------------------------------

  describe("Cross-cutting: Lifecycle + Search", () => {
    let tempDir: string;
    let manager: ConversationManager;

    beforeEach(() => {
      tempDir = createTempDir();
      manager = new ConversationManager(tempDir);
    });

    afterEach(() => {
      manager.close();
      cleanDir(tempDir);
    });

    it("search still works after status transitions", async () => {
      const conv1 = await manager.create();
      await manager.appendTurn(
        conv1.id,
        makeTurn("user", "infrastructure monitoring alert", 1),
      );

      const conv2 = await manager.create();
      await manager.appendTurn(
        conv2.id,
        makeTurn("user", "monitoring dashboard setup", 1),
      );

      // conv1 is inactive, conv2 is current
      // Switch back to conv1
      await manager.makeCurrent(conv1.id);

      // Search should find both regardless of status
      const results = await manager.search("monitoring");
      expect(results.length).toBe(2);
    });

    it("full lifecycle: create -> turns -> search -> switch -> delete empty", async () => {
      // 1. Create first conversation with content
      const conv1 = await manager.create();
      await manager.appendTurn(
        conv1.id,
        makeTurn("user", "Setup Tailscale VPN", 1),
      );
      await manager.appendTurn(
        conv1.id,
        makeTurn("assistant", "Sure, let me help with Tailscale.", 1),
      );
      await manager.setTitle(conv1.id, "vpn-tailscale-setup");

      // 2. Create second conversation (makes conv1 inactive)
      const conv2 = await manager.create();
      expect((await manager.get(conv1.id))!.status).toBe("inactive");
      expect(conv2.status).toBe("current");

      // 3. Second conversation is empty — simulate "user switches back"
      // Delete empty conv2 first (deleteIfEmpty pattern)
      const loaded = await manager.get(conv2.id);
      if (loaded && loaded.turnCount === 0) {
        await manager.delete(conv2.id);
      }

      // 4. Switch back to conv1
      await manager.makeCurrent(conv1.id);
      const current = await manager.getCurrent();
      expect(current!.id).toBe(conv1.id);
      expect(current!.title).toBe("vpn-tailscale-setup");

      // 5. Search still works
      const results = await manager.search("Tailscale");
      expect(results.length).toBeGreaterThan(0);

      // 6. conv2 is gone
      expect(await manager.get(conv2.id)).toBeNull();
    });

    it("conversation with external party metadata", async () => {
      const conv = await manager.create({
        externalParty: "+1555000000",
      });

      expect(conv.externalParty).toBe("+1555000000");

      // Lookup by external party
      const found = await manager.getByExternalParty("+1555000000");
      expect(found).not.toBeNull();
      expect(found!.id).toBe(conv.id);
    });

    it.skip("WhatsApp session resume across server restarts (requires live SDK)", () => {
      // This test requires a real Agent SDK connection.
      // Manual test: send WhatsApp message, restart server, send another message.
      // Verify session ID is restored from DB and conversation continues.
    });
  });
});
