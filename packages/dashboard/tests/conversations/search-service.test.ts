import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Database from "better-sqlite3";
import { ConversationSearchDB } from "../../src/conversations/search-db.js";
import { ConversationSearchService } from "../../src/conversations/search-service.js";

// Minimal mock of EmbeddingsPlugin
function createMockPlugin(ready = true) {
  return {
    embed: vi.fn(async (text: string) => {
      // Deterministic "embedding" based on text hash
      const hash = [...text].reduce(
        (h, c) => (h * 31 + c.charCodeAt(0)) | 0,
        0,
      );
      return [
        Math.sin(hash),
        Math.cos(hash),
        Math.sin(hash * 2),
        Math.cos(hash * 2),
      ];
    }),
    isReady: vi.fn(async () => ready),
    id: "mock",
    name: "Mock Plugin",
    modelName: "mock-embed",
    pluginType: "embeddings" as const,
    getDimensions: () => 4,
    initialize: vi.fn(),
    embedBatch: vi.fn(),
    healthCheck: vi.fn(),
  };
}

describe("ConversationSearchService", () => {
  let db: Database.Database;
  let searchDb: ConversationSearchDB;
  let service: ConversationSearchService;
  let mockPlugin: ReturnType<typeof createMockPlugin>;

  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("journal_mode = WAL");

    // Create FTS5 table (normally done by ConversationDatabase)
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS turns_fts USING fts5(
        content,
        conversation_id UNINDEXED,
        turn_number UNINDEXED,
        timestamp UNINDEXED
      )
    `);

    searchDb = new ConversationSearchDB(db);
    searchDb.initVectorTable(4);

    mockPlugin = createMockPlugin();

    service = new ConversationSearchService({
      searchDb,
      getPlugin: () => mockPlugin,
    });
  });

  afterEach(() => {
    db.close();
  });

  function insertFtsTurn(
    conversationId: string,
    turnNumber: number,
    role: string,
    content: string,
    timestamp = "2026-03-09T10:00:00Z",
  ) {
    const prefixed = `${role === "user" ? "User" : "Assistant"}: ${content}`;
    db.prepare(
      "INSERT INTO turns_fts (content, conversation_id, turn_number, timestamp) VALUES (?, ?, ?, ?)",
    ).run(prefixed, conversationId, turnNumber, timestamp);
  }

  describe("search (FTS5 only)", () => {
    beforeEach(() => {
      insertFtsTurn("conv-001", 1, "user", "How do I configure webhooks?");
      insertFtsTurn(
        "conv-001",
        1,
        "assistant",
        "You can configure webhooks in the settings panel.",
      );
      insertFtsTurn(
        "conv-002",
        1,
        "user",
        "Tell me about email notifications.",
      );
    });

    it("returns keyword search results", async () => {
      const results = await service.search("webhooks");
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].conversationId).toBe("conv-001");
      expect(results[0].score).toBeGreaterThan(0);
    });

    it("respects limit", async () => {
      const results = await service.search("configure", 1);
      expect(results).toHaveLength(1);
    });
  });

  describe("search (hybrid FTS5 + vector)", () => {
    beforeEach(async () => {
      insertFtsTurn("conv-001", 1, "user", "How do I configure webhooks?");
      insertFtsTurn("conv-002", 1, "user", "Tell me about ocean coral reefs.");

      // Add embeddings for both turns
      await service.indexTurn(
        "conv-001",
        1,
        "user",
        "How do I configure webhooks?",
      );
      await service.indexTurn(
        "conv-002",
        1,
        "user",
        "Tell me about ocean coral reefs.",
      );
    });

    it("calls embed for vector search", async () => {
      await service.search("webhooks");
      // embed called for: 2 indexTurn calls + 1 search query
      expect(mockPlugin.embed).toHaveBeenCalledTimes(3);
    });

    it("returns results combining both search types", async () => {
      const results = await service.search("webhooks");
      expect(results.length).toBeGreaterThan(0);
    });
  });

  describe("search (graceful degradation)", () => {
    it("falls back to FTS5 when plugin not ready", async () => {
      mockPlugin.isReady.mockResolvedValue(false);

      insertFtsTurn("conv-001", 1, "user", "test query content");

      const results = await service.search("test");
      expect(results.length).toBeGreaterThan(0);
      // embed should NOT be called
      expect(mockPlugin.embed).not.toHaveBeenCalled();
    });

    it("falls back to FTS5 when no plugin", async () => {
      const noPluginService = new ConversationSearchService({
        searchDb,
        getPlugin: () => null,
      });

      insertFtsTurn("conv-001", 1, "user", "test query content");

      const results = await noPluginService.search("test");
      expect(results.length).toBeGreaterThan(0);
    });

    it("falls back to FTS5 when embed throws", async () => {
      mockPlugin.embed.mockRejectedValueOnce(new Error("Ollama unreachable"));

      insertFtsTurn("conv-001", 1, "user", "test query content");

      const results = await service.search("test");
      expect(results.length).toBeGreaterThan(0);
    });
  });

  describe("indexTurn", () => {
    it("embeds and stores a turn", async () => {
      await service.indexTurn("conv-001", 1, "user", "Hello world");
      expect(mockPlugin.embed).toHaveBeenCalledWith("Hello world");
      expect(searchDb.hasEmbedding("conv-001", 1)).toBe(true);
    });

    it("silently fails when plugin not ready", async () => {
      mockPlugin.isReady.mockResolvedValue(false);
      await service.indexTurn("conv-001", 1, "user", "Hello world");
      expect(mockPlugin.embed).not.toHaveBeenCalled();
      expect(searchDb.hasEmbedding("conv-001", 1)).toBe(false);
    });

    it("silently fails when embed throws", async () => {
      mockPlugin.embed.mockRejectedValueOnce(new Error("Ollama down"));
      await expect(
        service.indexTurn("conv-001", 1, "user", "Hello world"),
      ).resolves.not.toThrow();
    });
  });

  describe("indexMissing", () => {
    it("indexes turns that lack embeddings", async () => {
      const allTurns = [
        {
          conversationId: "conv-001",
          turnNumber: 1,
          role: "user",
          content: "First message",
        },
        {
          conversationId: "conv-001",
          turnNumber: 2,
          role: "assistant",
          content: "Response",
        },
      ];

      const indexed = await service.indexMissing(() => allTurns);
      expect(indexed).toBe(2);
      expect(searchDb.hasEmbedding("conv-001", 1)).toBe(true);
      expect(searchDb.hasEmbedding("conv-001", 2)).toBe(true);
    });

    it("skips already-embedded turns", async () => {
      // Pre-embed one turn
      await service.indexTurn("conv-001", 1, "user", "First message");

      const allTurns = [
        {
          conversationId: "conv-001",
          turnNumber: 1,
          role: "user",
          content: "First message",
        },
        {
          conversationId: "conv-001",
          turnNumber: 2,
          role: "assistant",
          content: "Response",
        },
      ];

      mockPlugin.embed.mockClear();
      const indexed = await service.indexMissing(() => allTurns);
      expect(indexed).toBe(1); // Only turn 2
      expect(mockPlugin.embed).toHaveBeenCalledTimes(1);
    });

    it("returns 0 when plugin not available", async () => {
      const noPluginService = new ConversationSearchService({
        searchDb,
        getPlugin: () => null,
      });

      const indexed = await noPluginService.indexMissing(() => [
        {
          conversationId: "conv-001",
          turnNumber: 1,
          role: "user",
          content: "test",
        },
      ]);
      expect(indexed).toBe(0);
    });
  });

  describe("isSemanticAvailable", () => {
    it("returns true when plugin is ready and vec initialized", async () => {
      expect(await service.isSemanticAvailable()).toBe(true);
    });

    it("returns false when plugin not ready", async () => {
      mockPlugin.isReady.mockResolvedValue(false);
      expect(await service.isSemanticAvailable()).toBe(false);
    });

    it("returns false when no plugin", async () => {
      const noPluginService = new ConversationSearchService({
        searchDb,
        getPlugin: () => null,
      });
      expect(await noPluginService.isSemanticAvailable()).toBe(false);
    });
  });
});
