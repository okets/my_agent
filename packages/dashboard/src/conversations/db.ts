/**
 * Conversation System — Database Layer
 *
 * Manages SQLite database for conversation metadata and full-text search.
 * Uses better-sqlite3 with WAL mode for concurrent access.
 */

import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import type { Conversation } from "./types.js";

/**
 * SQLite database manager for conversation metadata and FTS
 */
export class ConversationDatabase {
  private db: Database.Database;

  constructor(agentDir: string) {
    const conversationsDir = path.join(agentDir, "conversations");

    // Ensure directory exists
    if (!fs.existsSync(conversationsDir)) {
      fs.mkdirSync(conversationsDir, { recursive: true });
    }

    const dbPath = path.join(conversationsDir, "conversations.db");
    this.db = new Database(dbPath);

    this.initialize();
  }

  /**
   * Initialize database with pragmas and schema
   */
  private initialize(): void {
    // Configure SQLite for optimal performance and safety
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("busy_timeout = 5000");
    this.db.pragma("foreign_keys = ON");

    // Create conversations table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        channel TEXT NOT NULL,
        title TEXT,
        topics TEXT,
        created TEXT NOT NULL,
        updated TEXT NOT NULL,
        turn_count INTEGER DEFAULT 0,
        participants TEXT,
        abbreviation TEXT,
        needs_abbreviation INTEGER DEFAULT 0,
        manually_named INTEGER DEFAULT 0,
        last_renamed_at_turn INTEGER DEFAULT NULL,
        external_party TEXT DEFAULT NULL,
        is_pinned INTEGER DEFAULT 1
      );
    `);

    // Migration: add columns if missing (for existing databases)
    const columns = this.db
      .prepare("PRAGMA table_info(conversations)")
      .all() as Array<{ name: string }>;
    if (!columns.some((c) => c.name === "manually_named")) {
      this.db.exec(
        "ALTER TABLE conversations ADD COLUMN manually_named INTEGER DEFAULT 0",
      );
    }
    if (!columns.some((c) => c.name === "last_renamed_at_turn")) {
      this.db.exec(
        "ALTER TABLE conversations ADD COLUMN last_renamed_at_turn INTEGER DEFAULT NULL",
      );
    }
    if (!columns.some((c) => c.name === "model")) {
      this.db.exec(
        "ALTER TABLE conversations ADD COLUMN model TEXT DEFAULT NULL",
      );
    }
    if (!columns.some((c) => c.name === "external_party")) {
      this.db.exec(
        "ALTER TABLE conversations ADD COLUMN external_party TEXT DEFAULT NULL",
      );
    }
    if (!columns.some((c) => c.name === "is_pinned")) {
      this.db.exec(
        "ALTER TABLE conversations ADD COLUMN is_pinned INTEGER DEFAULT 1",
      );
    }

    // Create FTS5 virtual table for full-text search
    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS turns_fts USING fts5(
        content,
        conversation_id UNINDEXED,
        turn_number UNINDEXED,
        timestamp UNINDEXED
      );
    `);

    // Create index on updated timestamp for efficient sorting
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_conversations_updated
      ON conversations(updated DESC);
    `);

    // Create index on channel for filtering
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_conversations_channel
      ON conversations(channel);
    `);

    // Create index on external_party for channel message lookups
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_conversations_external_party
      ON conversations(channel, external_party);
    `);
  }

  /**
   * Insert a new conversation
   */
  insertConversation(conversation: Conversation): void {
    const stmt = this.db.prepare(`
      INSERT INTO conversations (
        id, channel, title, topics, created, updated,
        turn_count, participants, abbreviation, needs_abbreviation, manually_named,
        last_renamed_at_turn, model, external_party, is_pinned
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      conversation.id,
      conversation.channel,
      conversation.title,
      JSON.stringify(conversation.topics),
      conversation.created.toISOString(),
      conversation.updated.toISOString(),
      conversation.turnCount,
      JSON.stringify(conversation.participants),
      conversation.abbreviation,
      conversation.needsAbbreviation ? 1 : 0,
      conversation.manuallyNamed ? 1 : 0,
      conversation.lastRenamedAtTurn,
      conversation.model,
      conversation.externalParty,
      conversation.isPinned !== false ? 1 : 0,
    );
  }

  /**
   * Get a conversation by ID
   */
  getConversation(id: string): Conversation | null {
    const stmt = this.db.prepare(`
      SELECT * FROM conversations WHERE id = ?
    `);

    const row = stmt.get(id) as any;

    if (!row) {
      return null;
    }

    return this.rowToConversation(row);
  }

  /**
   * List conversations with optional filtering
   */
  listConversations(options?: {
    channel?: string;
    limit?: number;
  }): Conversation[] {
    let sql = "SELECT * FROM conversations";
    const params: any[] = [];

    if (options?.channel) {
      sql += " WHERE channel = ?";
      params.push(options.channel);
    }

    sql += " ORDER BY updated DESC";

    if (options?.limit) {
      sql += " LIMIT ?";
      params.push(options.limit);
    }

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params) as any[];

    return rows.map((row) => this.rowToConversation(row));
  }

  /**
   * Get the most recent conversation for a channel
   */
  getMostRecent(channel: string): Conversation | null {
    const stmt = this.db.prepare(`
      SELECT * FROM conversations
      WHERE channel = ?
      ORDER BY updated DESC
      LIMIT 1
    `);

    const row = stmt.get(channel) as any;

    if (!row) {
      return null;
    }

    return this.rowToConversation(row);
  }

  /**
   * Update conversation metadata
   */
  updateConversation(
    id: string,
    updates: Partial<Omit<Conversation, "id" | "created">>,
  ): void {
    const fields: string[] = [];
    const values: any[] = [];

    if (updates.channel !== undefined) {
      fields.push("channel = ?");
      values.push(updates.channel);
    }

    if (updates.title !== undefined) {
      fields.push("title = ?");
      values.push(updates.title);
    }

    if (updates.topics !== undefined) {
      fields.push("topics = ?");
      values.push(JSON.stringify(updates.topics));
    }

    if (updates.updated !== undefined) {
      fields.push("updated = ?");
      values.push(updates.updated.toISOString());
    }

    if (updates.turnCount !== undefined) {
      fields.push("turn_count = ?");
      values.push(updates.turnCount);
    }

    if (updates.participants !== undefined) {
      fields.push("participants = ?");
      values.push(JSON.stringify(updates.participants));
    }

    if (updates.abbreviation !== undefined) {
      fields.push("abbreviation = ?");
      values.push(updates.abbreviation);
    }

    if (updates.needsAbbreviation !== undefined) {
      fields.push("needs_abbreviation = ?");
      values.push(updates.needsAbbreviation ? 1 : 0);
    }

    if (updates.manuallyNamed !== undefined) {
      fields.push("manually_named = ?");
      values.push(updates.manuallyNamed ? 1 : 0);
    }

    if (updates.lastRenamedAtTurn !== undefined) {
      fields.push("last_renamed_at_turn = ?");
      values.push(updates.lastRenamedAtTurn);
    }

    if (updates.model !== undefined) {
      fields.push("model = ?");
      values.push(updates.model);
    }

    if (updates.externalParty !== undefined) {
      fields.push("external_party = ?");
      values.push(updates.externalParty);
    }

    if (updates.isPinned !== undefined) {
      fields.push("is_pinned = ?");
      values.push(updates.isPinned ? 1 : 0);
    }

    if (fields.length === 0) {
      return;
    }

    const sql = `UPDATE conversations SET ${fields.join(", ")} WHERE id = ?`;
    values.push(id);

    const stmt = this.db.prepare(sql);
    stmt.run(...values);
  }

  /**
   * Insert a turn into the FTS index
   */
  indexTurn(
    conversationId: string,
    turnNumber: number,
    content: string,
    role: "user" | "assistant",
    timestamp: string,
  ): void {
    const stmt = this.db.prepare(`
      INSERT INTO turns_fts (content, conversation_id, turn_number, timestamp)
      VALUES (?, ?, ?, ?)
    `);

    // Prefix content with role for better search context
    const prefixedContent = `${role === "user" ? "User" : "Assistant"}: ${content}`;

    stmt.run(prefixedContent, conversationId, turnNumber, timestamp);
  }

  /**
   * Search conversations using FTS
   */
  searchConversations(
    query: string,
    limit = 10,
  ): Array<{
    conversationId: string;
    turnNumber: number;
    content: string;
    timestamp: string;
  }> {
    const stmt = this.db.prepare(`
      SELECT
        conversation_id as conversationId,
        turn_number as turnNumber,
        content,
        timestamp,
        rank
      FROM turns_fts
      WHERE turns_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `);

    return stmt.all(query, limit) as any[];
  }

  /**
   * Get conversations that need abbreviation
   */
  getPendingAbbreviations(): string[] {
    const stmt = this.db.prepare(`
      SELECT id FROM conversations
      WHERE needs_abbreviation = 1
      ORDER BY updated DESC
    `);

    const rows = stmt.all() as Array<{ id: string }>;
    return rows.map((row) => row.id);
  }

  /**
   * Increment turn count for a conversation
   */
  incrementTurnCount(id: string): void {
    const stmt = this.db.prepare(`
      UPDATE conversations
      SET turn_count = turn_count + 1,
          updated = ?
      WHERE id = ?
    `);

    stmt.run(new Date().toISOString(), id);
  }

  /**
   * Convert a database row to a Conversation object
   */
  private rowToConversation(row: any): Conversation {
    return {
      id: row.id,
      channel: row.channel,
      title: row.title,
      topics: row.topics ? JSON.parse(row.topics) : [],
      created: new Date(row.created),
      updated: new Date(row.updated),
      turnCount: row.turn_count,
      participants: row.participants ? JSON.parse(row.participants) : [],
      abbreviation: row.abbreviation,
      needsAbbreviation: row.needs_abbreviation === 1,
      manuallyNamed: row.manually_named === 1,
      lastRenamedAtTurn: row.last_renamed_at_turn ?? null,
      model: row.model ?? null,
      externalParty: row.external_party ?? null,
      isPinned: row.is_pinned !== 0,
    };
  }

  /**
   * Get conversation by external party (channel + external party).
   * Only returns pinned conversations — unpinned ones are web-only.
   */
  getByExternalParty(
    channel: string,
    externalParty: string,
  ): Conversation | null {
    const stmt = this.db.prepare(`
      SELECT * FROM conversations
      WHERE channel = ? AND external_party = ? AND is_pinned = 1
      ORDER BY updated DESC
      LIMIT 1
    `);
    const row = stmt.get(channel, externalParty) as any;
    if (!row) return null;
    return this.rowToConversation(row);
  }

  /**
   * Unpin a conversation (marks it as no longer the active channel conversation).
   * Unpinned conversations can still be viewed/continued via web dashboard.
   */
  unpinConversation(id: string): void {
    const stmt = this.db.prepare(`
      UPDATE conversations SET is_pinned = 0 WHERE id = ?
    `);
    stmt.run(id);
  }

  /**
   * Delete a conversation and its FTS entries in a transaction
   */
  deleteConversation(id: string): void {
    const deleteConv = this.db.prepare(
      "DELETE FROM conversations WHERE id = ?",
    );
    const deleteFts = this.db.prepare(
      "DELETE FROM turns_fts WHERE conversation_id = ?",
    );

    const transaction = this.db.transaction(() => {
      deleteFts.run(id);
      deleteConv.run(id);
    });

    transaction();
  }

  /**
   * Expose the raw Database instance for shared access (e.g. ExternalMessageStore)
   */
  getDb(): Database.Database {
    return this.db;
  }

  /**
   * Close the database connection
   */
  close(): void {
    this.db.close();
  }
}
