import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { ConversationSearchDB } from "../../src/conversations/search-db.js";

describe("ConversationSearchDB", () => {
  let db: Database.Database;
  let searchDb: ConversationSearchDB;

  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("journal_mode = WAL");

    // Create the FTS5 table that ConversationDatabase normally creates
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS turns_fts USING fts5(
        content,
        conversation_id UNINDEXED,
        turn_number UNINDEXED,
        timestamp UNINDEXED
      )
    `);

    searchDb = new ConversationSearchDB(db);
  });

  afterEach(() => {
    db.close();
  });

  describe("constructor", () => {
    it("creates the conversation_embedding_map table", () => {
      const tables = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='conversation_embedding_map'",
        )
        .all();
      expect(tables).toHaveLength(1);
    });

    it("is idempotent — can construct multiple times on same DB", () => {
      const searchDb2 = new ConversationSearchDB(db);
      expect(searchDb2).toBeDefined();
    });
  });

  describe("initVectorTable", () => {
    it("creates the conv_vec virtual table", () => {
      searchDb.initVectorTable(768);
      expect(searchDb.isVectorReady()).toBe(true);
    });

    it("is idempotent", () => {
      searchDb.initVectorTable(768);
      searchDb.initVectorTable(768);
      expect(searchDb.isVectorReady()).toBe(true);
    });
  });

  describe("searchKeyword", () => {
    beforeEach(() => {
      // Insert test data into FTS5
      const stmt = db.prepare(
        "INSERT INTO turns_fts (content, conversation_id, turn_number, timestamp) VALUES (?, ?, ?, ?)",
      );
      stmt.run(
        "User: How do I configure webhooks?",
        "conv-001",
        1,
        "2026-03-09T10:00:00Z",
      );
      stmt.run(
        "Assistant: You can configure webhooks in settings.",
        "conv-001",
        1,
        "2026-03-09T10:00:01Z",
      );
      stmt.run(
        "User: What about email notifications?",
        "conv-002",
        1,
        "2026-03-09T11:00:00Z",
      );
    });

    it("returns BM25-ranked results", () => {
      const results = searchDb.searchKeyword("webhooks");
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].conversationId).toBe("conv-001");
    });

    it("respects limit parameter", () => {
      const results = searchDb.searchKeyword("configure", 1);
      expect(results).toHaveLength(1);
    });

    it("returns empty array for no matches", () => {
      const results = searchDb.searchKeyword("nonexistent_xyz");
      expect(results).toHaveLength(0);
    });
  });

  describe("upsertEmbedding + searchVector", () => {
    const dims = 4; // Small dimensions for testing

    beforeEach(() => {
      searchDb.initVectorTable(dims);
    });

    it("inserts and retrieves embeddings", () => {
      searchDb.upsertEmbedding("conv-001", 1, "user", [1, 0, 0, 0]);
      searchDb.upsertEmbedding("conv-001", 1, "assistant", [0, 1, 0, 0]);
      searchDb.upsertEmbedding("conv-002", 1, "user", [0, 0, 1, 0]);

      const results = searchDb.searchVector([1, 0, 0, 0], 10);
      expect(results.length).toBeGreaterThan(0);
      // Closest to [1,0,0,0] should be conv-001 turn 1 user
      expect(results[0].conversationId).toBe("conv-001");
      expect(results[0].turnNumber).toBe(1);
      expect(results[0].role).toBe("user");
    });

    it("upsert replaces existing embedding", () => {
      searchDb.upsertEmbedding("conv-001", 1, "user", [1, 0, 0, 0]);
      searchDb.upsertEmbedding("conv-001", 1, "user", [0, 0, 0, 1]);

      const results = searchDb.searchVector([0, 0, 0, 1], 10);
      expect(results[0].conversationId).toBe("conv-001");
      expect(results[0].distance).toBeCloseTo(0, 1);
    });

    it("returns empty when vec not initialized", () => {
      const freshDb = new Database(":memory:");
      freshDb.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS turns_fts USING fts5(
          content, conversation_id UNINDEXED, turn_number UNINDEXED, timestamp UNINDEXED
        )
      `);
      const freshSearchDb = new ConversationSearchDB(freshDb);
      // Don't call initVectorTable
      const results = freshSearchDb.searchVector([1, 0, 0, 0]);
      expect(results).toHaveLength(0);
      freshDb.close();
    });
  });

  describe("removeTurns", () => {
    beforeEach(() => {
      searchDb.initVectorTable(4);
      searchDb.upsertEmbedding("conv-001", 1, "user", [1, 0, 0, 0]);
      searchDb.upsertEmbedding("conv-001", 2, "assistant", [0, 1, 0, 0]);
      searchDb.upsertEmbedding("conv-002", 1, "user", [0, 0, 1, 0]);
    });

    it("removes all embeddings for a conversation", () => {
      searchDb.removeTurns("conv-001");

      const results = searchDb.searchVector([1, 0, 0, 0], 10);
      // Only conv-002 should remain
      expect(results.every((r) => r.conversationId === "conv-002")).toBe(true);
    });

    it("does not affect other conversations", () => {
      searchDb.removeTurns("conv-001");

      const results = searchDb.searchVector([0, 0, 1, 0], 10);
      expect(results).toHaveLength(1);
      expect(results[0].conversationId).toBe("conv-002");
    });

    it("handles non-existent conversation gracefully", () => {
      expect(() => searchDb.removeTurns("conv-999")).not.toThrow();
    });
  });

  describe("getEmbeddingCount", () => {
    it("returns 0 initially", () => {
      expect(searchDb.getEmbeddingCount()).toBe(0);
    });

    it("returns correct count after inserts", () => {
      searchDb.initVectorTable(4);
      searchDb.upsertEmbedding("conv-001", 1, "user", [1, 0, 0, 0]);
      searchDb.upsertEmbedding("conv-001", 1, "assistant", [0, 1, 0, 0]);
      expect(searchDb.getEmbeddingCount()).toBe(2);
    });
  });

  describe("hasEmbedding", () => {
    it("returns false when no embedding exists", () => {
      expect(searchDb.hasEmbedding("conv-001", 1)).toBe(false);
    });

    it("returns true when embedding exists", () => {
      searchDb.initVectorTable(4);
      searchDb.upsertEmbedding("conv-001", 1, "user", [1, 0, 0, 0]);
      expect(searchDb.hasEmbedding("conv-001", 1)).toBe(true);
    });
  });
});
