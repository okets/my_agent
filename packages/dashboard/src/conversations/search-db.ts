/**
 * Conversation Search Database Layer (M6.7-S4)
 *
 * Extends the conversation database with vector search capabilities
 * using sqlite-vec. Works alongside the existing FTS5 index in db.ts.
 *
 * The FTS5 table (turns_fts) is managed by ConversationDatabase.
 * This class adds:
 * - conv_vec: sqlite-vec virtual table for semantic search
 * - conversation_embedding_map: maps vec0 rowids to conversation turns
 */

import type Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";

export interface SearchResult {
  conversationId: string;
  turnNumber: number;
  content: string;
  timestamp: string;
  score: number;
}

export interface VectorResult {
  conversationId: string;
  turnNumber: number;
  role: string;
  distance: number;
}

export class ConversationSearchDB {
  private db: Database.Database;
  private vecInitialized = false;

  constructor(db: Database.Database) {
    this.db = db;

    // Load sqlite-vec extension (idempotent — safe to call multiple times)
    sqliteVec.load(db);

    this.initializeTables();
  }

  private initializeTables(): void {
    // Mapping table for vec0 rowids → conversation turns
    // vec0 uses integer rowids, so we need a mapping layer
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS conversation_embedding_map (
        rowid INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id TEXT NOT NULL,
        turn_number INTEGER NOT NULL,
        role TEXT NOT NULL,
        UNIQUE(conversation_id, turn_number, role)
      )
    `);

    // Index for cleanup on conversation deletion
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_conv_embed_map_conv
      ON conversation_embedding_map(conversation_id)
    `);
  }

  /**
   * Initialize the vector table with the given dimensions.
   * Must be called once the embedding plugin dimensions are known.
   */
  initVectorTable(dimensions: number): void {
    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS conv_vec USING vec0(
        embedding FLOAT[${dimensions}]
      )
    `);
    this.vecInitialized = true;
  }

  /**
   * Check if the vector table has been initialized
   */
  isVectorReady(): boolean {
    return this.vecInitialized;
  }

  /**
   * Search FTS5 index for keyword matches.
   * Delegates to the existing turns_fts table created by ConversationDatabase.
   */
  searchKeyword(query: string, limit = 20): SearchResult[] {
    const stmt = this.db.prepare(`
      SELECT
        conversation_id as conversationId,
        turn_number as turnNumber,
        content,
        timestamp,
        rank as score
      FROM turns_fts
      WHERE turns_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `);

    return stmt.all(query, limit) as SearchResult[];
  }

  /**
   * Insert or update an embedding for a conversation turn.
   */
  upsertEmbedding(
    conversationId: string,
    turnNumber: number,
    role: string,
    embedding: number[],
  ): void {
    if (!this.vecInitialized) return;

    const upsertMap = this.db.prepare(`
      INSERT INTO conversation_embedding_map (conversation_id, turn_number, role)
      VALUES (?, ?, ?)
      ON CONFLICT(conversation_id, turn_number, role) DO UPDATE SET
        conversation_id = excluded.conversation_id
      RETURNING rowid
    `);

    const deleteVec = this.db.prepare(`
      DELETE FROM conv_vec WHERE rowid = ?
    `);

    const insertVec = this.db.prepare(`
      INSERT INTO conv_vec (rowid, embedding) VALUES (?, ?)
    `);

    const transaction = this.db.transaction(() => {
      const row = upsertMap.get(conversationId, turnNumber, role) as {
        rowid: number;
      };
      // On conflict (update path), clear old vector first
      deleteVec.run(row.rowid);
      // vec0 requires BigInt rowids and JSON-encoded embeddings
      insertVec.run(BigInt(row.rowid), JSON.stringify(embedding));
    });

    transaction();
  }

  /**
   * Search vectors by cosine similarity.
   */
  searchVector(embedding: number[], limit = 20): VectorResult[] {
    if (!this.vecInitialized) return [];

    const stmt = this.db.prepare(`
      SELECT
        m.conversation_id as conversationId,
        m.turn_number as turnNumber,
        m.role,
        v.distance
      FROM conv_vec v
      JOIN conversation_embedding_map m ON m.rowid = v.rowid
      WHERE v.embedding MATCH ? AND v.k = ?
      ORDER BY v.distance
    `);

    return stmt.all(JSON.stringify(embedding), limit) as VectorResult[];
  }

  /**
   * Remove all vector data for a conversation.
   * FTS cleanup is already handled by ConversationDatabase.deleteConversation().
   */
  removeTurns(conversationId: string): void {
    if (!this.vecInitialized) {
      // Only clean up the mapping table if vec isn't initialized
      this.db
        .prepare(
          "DELETE FROM conversation_embedding_map WHERE conversation_id = ?",
        )
        .run(conversationId);
      return;
    }

    const transaction = this.db.transaction(() => {
      // Get rowids to delete from vec table
      const rows = this.db
        .prepare(
          "SELECT rowid FROM conversation_embedding_map WHERE conversation_id = ?",
        )
        .all(conversationId) as Array<{ rowid: number }>;

      // Delete from vec table
      const deleteVec = this.db.prepare("DELETE FROM conv_vec WHERE rowid = ?");
      for (const row of rows) {
        deleteVec.run(BigInt(row.rowid));
      }

      // Delete from mapping table
      this.db
        .prepare(
          "DELETE FROM conversation_embedding_map WHERE conversation_id = ?",
        )
        .run(conversationId);
    });

    transaction();
  }

  /**
   * Get count of indexed embeddings (for startup logging)
   */
  getEmbeddingCount(): number {
    const row = this.db
      .prepare("SELECT COUNT(*) as count FROM conversation_embedding_map")
      .get() as { count: number };
    return row.count;
  }

  /**
   * Check if a turn already has an embedding
   */
  hasEmbedding(conversationId: string, turnNumber: number): boolean {
    const row = this.db
      .prepare(
        "SELECT 1 FROM conversation_embedding_map WHERE conversation_id = ? AND turn_number = ? LIMIT 1",
      )
      .get(conversationId, turnNumber);
    return !!row;
  }
}
