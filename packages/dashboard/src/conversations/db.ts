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
 * SQLite database manager for agent data (conversations, tasks)
 *
 * Renamed from conversations.db to agent.db in M5-S1 to reflect
 * expanded scope including tasks and future entity types.
 */
export class ConversationDatabase {
  private db: Database.Database;

  constructor(agentDir: string) {
    const conversationsDir = path.join(agentDir, "conversations");

    // Ensure directory exists
    if (!fs.existsSync(conversationsDir)) {
      fs.mkdirSync(conversationsDir, { recursive: true });
    }

    // Migration: rename conversations.db to agent.db
    const oldPath = path.join(conversationsDir, "conversations.db");
    const newPath = path.join(conversationsDir, "agent.db");

    if (fs.existsSync(oldPath) && !fs.existsSync(newPath)) {
      // Migrate: rename the database file
      fs.renameSync(oldPath, newPath);

      // Also migrate WAL and SHM files if they exist
      const oldWal = oldPath + "-wal";
      const oldShm = oldPath + "-shm";
      if (fs.existsSync(oldWal)) {
        fs.renameSync(oldWal, newPath + "-wal");
      }
      if (fs.existsSync(oldShm)) {
        fs.renameSync(oldShm, newPath + "-shm");
      }

      console.log("[DB] Migrated conversations.db → agent.db");
    }

    this.db = new Database(newPath);

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
        channel TEXT,
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

    // Migration: add SDK session ID for Agent SDK session resumption (M6.5-S2)
    if (!columns.some((c) => c.name === "sdk_session_id")) {
      this.db.exec(
        "ALTER TABLE conversations ADD COLUMN sdk_session_id TEXT DEFAULT NULL",
      );
    }

    // Migration: add last_extracted_at_turn for fact extraction tracking (M6.6-S3)
    if (!columns.some((c) => c.name === "last_extracted_at_turn")) {
      this.db.exec(
        "ALTER TABLE conversations ADD COLUMN last_extracted_at_turn INTEGER DEFAULT NULL",
      );
    }

    // Migration: add last_user_message_at for active conversation detection (M6.9-S3)
    if (!columns.some((c) => c.name === "last_user_message_at")) {
      this.db.exec(
        "ALTER TABLE conversations ADD COLUMN last_user_message_at TEXT DEFAULT NULL",
      );
    }

    // Migration: add status column for conversation lifecycle (M6.7-S2)
    if (!columns.some((c) => c.name === "status")) {
      this.db.exec(
        "ALTER TABLE conversations ADD COLUMN status TEXT NOT NULL DEFAULT 'inactive'",
      );
      // Mark the most recently updated conversation as current
      this.db.exec(`
        UPDATE conversations SET status = 'current'
        WHERE id = (SELECT id FROM conversations ORDER BY updated DESC LIMIT 1)
      `);
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

    // Create tasks table (M5-S1)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        source_type TEXT NOT NULL,
        source_ref TEXT,
        title TEXT NOT NULL,
        instructions TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        session_id TEXT NOT NULL,
        recurrence_id TEXT,
        occurrence_date TEXT,
        scheduled_for TEXT,
        started_at TEXT,
        completed_at TEXT,
        created_by TEXT NOT NULL,
        log_path TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);

    // Task indexes
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_tasks_status
      ON tasks(status);
    `);

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_tasks_recurrence
      ON tasks(recurrence_id);
    `);

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_tasks_source
      ON tasks(source_type, source_ref);
    `);

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_tasks_scheduled
      ON tasks(scheduled_for);
    `);

    // Migration: add deleted_at column if missing (M5-S5)
    const taskColumns = this.db
      .prepare("PRAGMA table_info(tasks)")
      .all() as Array<{ name: string }>;
    if (!taskColumns.some((c) => c.name === "deleted_at")) {
      this.db.exec("ALTER TABLE tasks ADD COLUMN deleted_at TEXT DEFAULT NULL");
    }

    // Migration: add steps and current_step columns (M5-S9, legacy)
    if (!taskColumns.some((c) => c.name === "steps")) {
      this.db.exec("ALTER TABLE tasks ADD COLUMN steps TEXT DEFAULT NULL");
    }
    if (!taskColumns.some((c) => c.name === "current_step")) {
      this.db.exec(
        "ALTER TABLE tasks ADD COLUMN current_step INTEGER DEFAULT NULL",
      );
    }

    // Migration: add work and delivery columns (M5-S9 Work+Deliverable architecture)
    if (!taskColumns.some((c) => c.name === "work")) {
      this.db.exec("ALTER TABLE tasks ADD COLUMN work TEXT DEFAULT NULL");
    }
    if (!taskColumns.some((c) => c.name === "delivery")) {
      this.db.exec("ALTER TABLE tasks ADD COLUMN delivery TEXT DEFAULT NULL");
    }

    // Migration: add SDK session ID for Agent SDK session resumption (M6.5-S2)
    if (!taskColumns.some((c) => c.name === "sdk_session_id")) {
      this.db.exec(
        "ALTER TABLE tasks ADD COLUMN sdk_session_id TEXT DEFAULT NULL",
      );
    }

    // M6.9-S3.5: Task completion notification preference
    if (!taskColumns.some((c) => c.name === "notify_on_completion")) {
      this.db.exec(
        "ALTER TABLE tasks ADD COLUMN notify_on_completion TEXT DEFAULT NULL",
      );
    }

    // M6.9-S4: Per-task model override
    if (!taskColumns.some((c) => c.name === "model")) {
      this.db.exec(
        "ALTER TABLE tasks ADD COLUMN model TEXT DEFAULT NULL",
      );
    }

    // Create task_conversations junction table (M5-S5)
    // Soft references: no FK constraints for graceful degradation
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS task_conversations (
        task_id TEXT NOT NULL,
        conversation_id TEXT NOT NULL,
        linked_at TEXT NOT NULL,
        PRIMARY KEY (task_id, conversation_id)
      );
    `);

    // Index for querying conversations by task
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_task_conversations_task
      ON task_conversations(task_id);
    `);

    // Index for querying tasks by conversation
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_task_conversations_conv
      ON task_conversations(conversation_id);
    `);

    // M6.9-S5: Task search tables (FTS5 for keyword search)
    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS tasks_fts USING fts5(
        task_id UNINDEXED,
        content
      );
    `);

    // M6.9-S5: Task embedding map (vec0 rowids → task IDs)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS task_embedding_map (
        vec_rowid INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id TEXT NOT NULL UNIQUE
      );
    `);

    // M7-S1: Spaces table (derived index — rebuildable from SPACE.md files)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS spaces (
        name TEXT PRIMARY KEY,
        path TEXT NOT NULL,
        tags TEXT,
        runtime TEXT,
        entry TEXT,
        io TEXT,
        maintenance TEXT,
        description TEXT,
        indexed_at TEXT NOT NULL
      );
    `);

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_spaces_tags ON spaces(tags);
    `);

    // M7-S3: Automations table (derived from automation .md files)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS automations (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        trigger_config TEXT NOT NULL,
        spaces TEXT,
        model TEXT,
        notify TEXT DEFAULT 'debrief',
        persist_session INTEGER DEFAULT 0,
        autonomy TEXT DEFAULT 'full',
        once INTEGER DEFAULT 0,
        delivery TEXT,
        created TEXT NOT NULL,
        indexed_at TEXT NOT NULL
      );
    `);

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_automations_status
      ON automations(status);
    `);

    // M7-S3: Jobs table (derived from JSONL files, for timeline queries)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        automation_id TEXT NOT NULL,
        status TEXT NOT NULL,
        created TEXT NOT NULL,
        completed TEXT,
        summary TEXT,
        context TEXT,
        sdk_session_id TEXT,
        run_dir TEXT,
        FOREIGN KEY (automation_id) REFERENCES automations(id)
      );
    `);

    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_jobs_automation ON jobs(automation_id);`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_jobs_created ON jobs(created);`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);`);
  }

  /**
   * Insert a new conversation
   */
  insertConversation(conversation: Conversation): void {
    const stmt = this.db.prepare(`
      INSERT INTO conversations (
        id, channel, title, topics, created, updated,
        turn_count, participants, abbreviation, needs_abbreviation, manually_named,
        last_renamed_at_turn, model, external_party, is_pinned, status, last_user_message_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      conversation.id,
      "web", // vestigial — channel is per-turn, not per-conversation
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
      conversation.status ?? "inactive",
      conversation.lastUserMessageAt?.toISOString() ?? null,
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
  listConversations(options?: { limit?: number }): Conversation[] {
    let sql = "SELECT * FROM conversations ORDER BY updated DESC";
    const params: any[] = [];

    if (options?.limit) {
      sql += " LIMIT ?";
      params.push(options.limit);
    }

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params) as any[];

    return rows.map((row) => this.rowToConversation(row));
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

    if (updates.lastExtractedAtTurn !== undefined) {
      fields.push("last_extracted_at_turn = ?");
      values.push(updates.lastExtractedAtTurn);
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

    if (updates.status !== undefined) {
      fields.push("status = ?");
      values.push(updates.status);
    }

    if (updates.lastUserMessageAt !== undefined) {
      fields.push("last_user_message_at = ?");
      values.push(updates.lastUserMessageAt?.toISOString() ?? null);
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
   * Get the active conversation — status 'current' with a recent user message.
   * Returns null if no conversation has user activity within the threshold.
   */
  getActiveConversation(thresholdMinutes: number): Conversation | null {
    const cutoff = new Date(
      Date.now() - thresholdMinutes * 60 * 1000,
    ).toISOString();
    const row = this.db
      .prepare(
        `SELECT * FROM conversations
         WHERE status = 'current'
           AND last_user_message_at IS NOT NULL
           AND last_user_message_at > ?
         ORDER BY last_user_message_at DESC
         LIMIT 1`,
      )
      .get(cutoff) as any;
    return row ? this.rowToConversation(row) : null;
  }

  /**
   * Convert a database row to a Conversation object
   */
  rowToConversation(row: any): Conversation {
    return {
      id: row.id,
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
      lastExtractedAtTurn: row.last_extracted_at_turn ?? null,
      model: row.model ?? null,
      externalParty: row.external_party ?? null,
      isPinned: row.is_pinned !== 0,
      status: (row.status as "current" | "inactive") ?? "inactive",
      lastUserMessageAt: row.last_user_message_at
        ? new Date(row.last_user_message_at)
        : null,
    };
  }

  /**
   * Make a conversation current, demoting any existing current conversation.
   * Runs in a transaction for atomicity.
   */
  makeCurrent(conversationId: string): void {
    const transaction = this.db.transaction(() => {
      this.db
        .prepare(
          "UPDATE conversations SET status = 'inactive' WHERE status = 'current'",
        )
        .run();
      this.db
        .prepare("UPDATE conversations SET status = 'current' WHERE id = ?")
        .run(conversationId);
    });
    transaction();
  }

  /**
   * Get the current conversation (status = 'current'), if any.
   */
  getCurrent(): Conversation | null {
    const stmt = this.db.prepare(
      "SELECT * FROM conversations WHERE status = 'current' LIMIT 1",
    );
    const row = stmt.get() as any;
    return row ? this.rowToConversation(row) : null;
  }

  /**
   * Get pinned conversation by external party identifier.
   * Only returns pinned conversations — unpinned ones don't receive channel messages.
   */
  getByExternalParty(externalParty: string): Conversation | null {
    const stmt = this.db.prepare(`
      SELECT * FROM conversations
      WHERE external_party = ? AND is_pinned = 1
      ORDER BY updated DESC
      LIMIT 1
    `);
    const row = stmt.get(externalParty) as any;
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
   * Get the SDK session ID for a conversation (M6.5-S2)
   */
  getSdkSessionId(conversationId: string): string | null {
    const stmt = this.db.prepare(
      "SELECT sdk_session_id FROM conversations WHERE id = ?",
    );
    const row = stmt.get(conversationId) as
      | { sdk_session_id: string | null }
      | undefined;
    return row?.sdk_session_id ?? null;
  }

  /**
   * Update the SDK session ID for a conversation (M6.5-S2)
   */
  updateSdkSessionId(conversationId: string, sessionId: string | null): void {
    const stmt = this.db.prepare(
      "UPDATE conversations SET sdk_session_id = ? WHERE id = ?",
    );
    stmt.run(sessionId, conversationId);
  }

  /**
   * Get the SDK session ID for a task (M6.5-S2)
   */
  getTaskSdkSessionId(taskId: string): string | null {
    const stmt = this.db.prepare(
      "SELECT sdk_session_id FROM tasks WHERE id = ?",
    );
    const row = stmt.get(taskId) as
      | { sdk_session_id: string | null }
      | undefined;
    return row?.sdk_session_id ?? null;
  }

  /**
   * Update the SDK session ID for a task (M6.5-S2)
   */
  updateTaskSdkSessionId(taskId: string, sessionId: string | null): void {
    const stmt = this.db.prepare(
      "UPDATE tasks SET sdk_session_id = ? WHERE id = ?",
    );
    stmt.run(sessionId, taskId);
  }

  // --- Space CRUD (M7-S1) ---

  upsertSpace(space: {
    name: string;
    path: string;
    tags?: string[];
    runtime?: string;
    entry?: string;
    io?: object;
    maintenance?: object;
    description?: string;
    indexedAt: string;
  }): void {
    const stmt = this.db.prepare(`
      INSERT INTO spaces (name, path, tags, runtime, entry, io, maintenance, description, indexed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(name) DO UPDATE SET
        path = excluded.path,
        tags = excluded.tags,
        runtime = excluded.runtime,
        entry = excluded.entry,
        io = excluded.io,
        maintenance = excluded.maintenance,
        description = excluded.description,
        indexed_at = excluded.indexed_at
    `);

    stmt.run(
      space.name,
      space.path,
      space.tags ? JSON.stringify(space.tags) : null,
      space.runtime ?? null,
      space.entry ?? null,
      space.io ? JSON.stringify(space.io) : null,
      space.maintenance ? JSON.stringify(space.maintenance) : null,
      space.description ?? null,
      space.indexedAt,
    );
  }

  getSpace(name: string): {
    name: string;
    path: string;
    tags: string[];
    runtime: string | null;
    entry: string | null;
    io: object | null;
    maintenance: object | null;
    description: string | null;
    indexedAt: string;
  } | null {
    const row = this.db.prepare("SELECT * FROM spaces WHERE name = ?").get(name) as any;
    if (!row) return null;
    return this.rowToSpace(row);
  }

  listSpaces(filter?: {
    tag?: string;
    runtime?: string;
    search?: string;
  }): Array<{
    name: string;
    path: string;
    tags: string[];
    runtime: string | null;
    entry: string | null;
    io: object | null;
    maintenance: object | null;
    description: string | null;
    indexedAt: string;
  }> {
    let sql = "SELECT * FROM spaces WHERE 1=1";
    const params: any[] = [];

    if (filter?.tag) {
      // tags stored as JSON array, use LIKE for contains
      sql += " AND tags LIKE ?";
      params.push(`%"${filter.tag}"%`);
    }
    if (filter?.runtime) {
      sql += " AND runtime = ?";
      params.push(filter.runtime);
    }
    if (filter?.search) {
      sql += " AND (name LIKE ? OR description LIKE ? OR tags LIKE ?)";
      const term = `%${filter.search}%`;
      params.push(term, term, term);
    }

    sql += " ORDER BY name";
    const rows = this.db.prepare(sql).all(...params) as any[];
    return rows.map((row) => this.rowToSpace(row));
  }

  deleteSpace(name: string): void {
    this.db.prepare("DELETE FROM spaces WHERE name = ?").run(name);
  }

  private rowToSpace(row: any): {
    name: string;
    path: string;
    tags: string[];
    runtime: string | null;
    entry: string | null;
    io: object | null;
    maintenance: object | null;
    description: string | null;
    indexedAt: string;
  } {
    return {
      name: row.name,
      path: row.path,
      tags: row.tags ? JSON.parse(row.tags) : [],
      runtime: row.runtime,
      entry: row.entry,
      io: row.io ? JSON.parse(row.io) : null,
      maintenance: row.maintenance ? JSON.parse(row.maintenance) : null,
      description: row.description,
      indexedAt: row.indexed_at,
    };
  }

  // ── Automation CRUD ───────────────────────────────────────────────

  upsertAutomation(automation: {
    id: string;
    name: string;
    status: string;
    triggerConfig: string;
    spaces?: string;
    model?: string;
    notify?: string;
    persistSession?: boolean;
    autonomy?: string;
    once?: boolean;
    delivery?: string;
    created: string;
    indexedAt: string;
  }): void {
    const stmt = this.db.prepare(`
      INSERT INTO automations (id, name, status, trigger_config, spaces, model, notify, persist_session, autonomy, once, delivery, created, indexed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        status = excluded.status,
        trigger_config = excluded.trigger_config,
        spaces = excluded.spaces,
        model = excluded.model,
        notify = excluded.notify,
        persist_session = excluded.persist_session,
        autonomy = excluded.autonomy,
        once = excluded.once,
        delivery = excluded.delivery,
        indexed_at = excluded.indexed_at
    `);

    stmt.run(
      automation.id,
      automation.name,
      automation.status,
      automation.triggerConfig,
      automation.spaces ?? null,
      automation.model ?? null,
      automation.notify ?? "debrief",
      automation.persistSession ? 1 : 0,
      automation.autonomy ?? "full",
      automation.once ? 1 : 0,
      automation.delivery ?? null,
      automation.created,
      automation.indexedAt,
    );
  }

  deleteAutomation(id: string): void {
    this.db.prepare("DELETE FROM automations WHERE id = ?").run(id);
  }

  getAutomation(id: string): {
    id: string;
    name: string;
    status: string;
    triggerConfig: string;
    spaces: string | null;
    model: string | null;
    notify: string;
    persistSession: boolean;
    autonomy: string;
    once: boolean;
    delivery: string | null;
    created: string;
    indexedAt: string;
  } | null {
    const row = this.db
      .prepare("SELECT * FROM automations WHERE id = ?")
      .get(id) as any;
    if (!row) return null;
    return this.rowToAutomation(row);
  }

  listAutomations(filter?: { status?: string }): Array<{
    id: string;
    name: string;
    status: string;
    triggerConfig: string;
    spaces: string | null;
    model: string | null;
    notify: string;
    persistSession: boolean;
    autonomy: string;
    once: boolean;
    delivery: string | null;
    created: string;
    indexedAt: string;
  }> {
    let sql = "SELECT * FROM automations WHERE 1=1";
    const params: any[] = [];

    if (filter?.status) {
      sql += " AND status = ?";
      params.push(filter.status);
    }

    sql += " ORDER BY name";
    const rows = this.db.prepare(sql).all(...params) as any[];
    return rows.map((row) => this.rowToAutomation(row));
  }

  private rowToAutomation(row: any): {
    id: string;
    name: string;
    status: string;
    triggerConfig: string;
    spaces: string | null;
    model: string | null;
    notify: string;
    persistSession: boolean;
    autonomy: string;
    once: boolean;
    delivery: string | null;
    created: string;
    indexedAt: string;
  } {
    return {
      id: row.id,
      name: row.name,
      status: row.status,
      triggerConfig: row.trigger_config,
      spaces: row.spaces,
      model: row.model,
      notify: row.notify,
      persistSession: !!row.persist_session,
      autonomy: row.autonomy,
      once: !!row.once,
      delivery: row.delivery,
      created: row.created,
      indexedAt: row.indexed_at,
    };
  }

  // ── Job CRUD ────────────────────────────────────────────────────

  upsertJob(job: {
    id: string;
    automationId: string;
    status: string;
    created: string;
    completed?: string;
    summary?: string;
    context?: string;
    sdkSessionId?: string;
    runDir?: string;
  }): void {
    const stmt = this.db.prepare(`
      INSERT INTO jobs (id, automation_id, status, created, completed, summary, context, sdk_session_id, run_dir)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        status = excluded.status,
        completed = excluded.completed,
        summary = excluded.summary,
        context = excluded.context,
        sdk_session_id = excluded.sdk_session_id,
        run_dir = excluded.run_dir
    `);

    stmt.run(
      job.id,
      job.automationId,
      job.status,
      job.created,
      job.completed ?? null,
      job.summary ?? null,
      job.context ?? null,
      job.sdkSessionId ?? null,
      job.runDir ?? null,
    );
  }

  getJob(id: string): {
    id: string;
    automationId: string;
    status: string;
    created: string;
    completed: string | null;
    summary: string | null;
    context: string | null;
    sdkSessionId: string | null;
    runDir: string | null;
  } | null {
    const row = this.db
      .prepare("SELECT * FROM jobs WHERE id = ?")
      .get(id) as any;
    if (!row) return null;
    return this.rowToJob(row);
  }

  listJobs(filter?: {
    automationId?: string;
    status?: string;
    since?: string;
    limit?: number;
  }): Array<{
    id: string;
    automationId: string;
    status: string;
    created: string;
    completed: string | null;
    summary: string | null;
    context: string | null;
    sdkSessionId: string | null;
    runDir: string | null;
  }> {
    let sql = "SELECT * FROM jobs WHERE 1=1";
    const params: any[] = [];

    if (filter?.automationId) {
      sql += " AND automation_id = ?";
      params.push(filter.automationId);
    }
    if (filter?.status) {
      sql += " AND status = ?";
      params.push(filter.status);
    }
    if (filter?.since) {
      sql += " AND created >= ?";
      params.push(filter.since);
    }

    sql += " ORDER BY created DESC";

    if (filter?.limit) {
      sql += " LIMIT ?";
      params.push(filter.limit);
    }

    const rows = this.db.prepare(sql).all(...params) as any[];
    return rows.map((row) => this.rowToJob(row));
  }

  private rowToJob(row: any): {
    id: string;
    automationId: string;
    status: string;
    created: string;
    completed: string | null;
    summary: string | null;
    context: string | null;
    sdkSessionId: string | null;
    runDir: string | null;
  } {
    return {
      id: row.id,
      automationId: row.automation_id,
      status: row.status,
      created: row.created,
      completed: row.completed,
      summary: row.summary,
      context: row.context,
      sdkSessionId: row.sdk_session_id,
      runDir: row.run_dir,
    };
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
