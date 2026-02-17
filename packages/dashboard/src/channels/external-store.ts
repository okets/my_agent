/**
 * External Message Store
 *
 * Minimal SQLite storage for non-owner messages arriving on dedicated channels.
 * Placeholder for S3's full ExternalCommunication trust tier model.
 *
 * Uses the same database file as ConversationDatabase — caller must pass in
 * the shared Database instance.
 */

import type Database from "better-sqlite3";

export interface StoredExternalMessage {
  id: string;
  channelId: string;
  from: string;
  displayName: string | null;
  content: string;
  timestamp: string;
  status: string;
  rawJson: string | null;
}

export class ExternalMessageStore {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
    this.initialize();
  }

  private initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS external_messages (
        id TEXT PRIMARY KEY,
        channel_id TEXT NOT NULL,
        from_identity TEXT NOT NULL,
        display_name TEXT,
        content TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
        raw_json TEXT
      )
    `);

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_external_channel_from
      ON external_messages(channel_id, from_identity)
    `);
  }

  storeMessage(msg: {
    id: string;
    channelId: string;
    from: string;
    displayName?: string;
    content: string;
    timestamp: string;
    raw?: unknown;
  }): void {
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO external_messages
        (id, channel_id, from_identity, display_name, content, timestamp, status, raw_json)
      VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)
    `);

    stmt.run(
      msg.id,
      msg.channelId,
      msg.from,
      msg.displayName ?? null,
      msg.content,
      msg.timestamp,
      msg.raw !== undefined ? JSON.stringify(msg.raw) : null,
    );
  }

  getByParty(channelId: string, fromIdentity: string): StoredExternalMessage[] {
    const stmt = this.db.prepare(`
      SELECT
        id,
        channel_id   AS channelId,
        from_identity AS "from",
        display_name  AS displayName,
        content,
        timestamp,
        status,
        raw_json      AS rawJson
      FROM external_messages
      WHERE channel_id = ? AND from_identity = ?
      ORDER BY timestamp DESC
    `);

    return stmt.all(channelId, fromIdentity) as StoredExternalMessage[];
  }

  listPending(limit = 50): StoredExternalMessage[] {
    const stmt = this.db.prepare(`
      SELECT
        id,
        channel_id   AS channelId,
        from_identity AS "from",
        display_name  AS displayName,
        content,
        timestamp,
        status,
        raw_json      AS rawJson
      FROM external_messages
      WHERE status = 'pending'
      ORDER BY timestamp DESC
      LIMIT ?
    `);

    return stmt.all(limit) as StoredExternalMessage[];
  }
}
