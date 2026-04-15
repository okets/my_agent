/**
 * Conversation System — Manager
 *
 * High-level API for conversation management.
 * Coordinates transcript storage, database metadata, and FTS indexing.
 */

import { ulid } from "ulid";
import { TranscriptManager } from "./transcript.js";
import { ConversationDatabase } from "./db.js";
import type {
  Conversation,
  TranscriptTurn,
  TranscriptLine,
  TranscriptMeta,
  ListConversationsOptions,
  GetTurnsOptions,
} from "./types.js";

/**
 * Manages conversations across transcripts, database, and search index
 */
export class ConversationManager {
  private transcripts: TranscriptManager;
  private db: ConversationDatabase;

  /** Callback invoked when a conversation transitions to inactive (for extraction trigger) */
  onConversationInactive?: (conversationId: string) => void;

  /** Callback invoked after a turn is appended (for screenshot ref scanning) */
  onTurnAppended?: (conversationId: string, turn: TranscriptTurn) => void;

  constructor(agentDir: string) {
    this.transcripts = new TranscriptManager(agentDir);
    this.db = new ConversationDatabase(agentDir);
  }

  /**
   * Create a new conversation
   */
  async create(options?: {
    externalParty?: string;
    title?: string;
    model?: string | null;
  }): Promise<Conversation> {
    const now = new Date();
    const conversationId = `conv-${ulid()}`;

    const conversation: Conversation = {
      id: conversationId,
      title: options?.title ?? null,
      topics: [],
      created: now,
      updated: now,
      turnCount: 0,
      participants: ["user"],
      abbreviation: null,
      needsAbbreviation: false,
      manuallyNamed: false,
      lastRenamedAtTurn: null,
      lastExtractedAtTurn: null,
      model: options?.model ?? null,
      externalParty: options?.externalParty ?? null,
      isPinned: true,
      status: "current",
      lastUserMessageAt: null,
    };

    // Demote current conversation before creating new one
    const currentConv = this.db.getCurrent();
    if (currentConv) {
      this.db.updateConversation(currentConv.id, { status: "inactive" });
      this.onConversationInactive?.(currentConv.id);
    }

    // Create transcript file with metadata header
    const meta: TranscriptMeta = {
      type: "meta",
      id: conversationId,
      created: now.toISOString(),
      participants: ["user"],
    };

    this.transcripts.createTranscript(meta);

    // Insert into database
    this.db.insertConversation(conversation);

    return conversation;
  }

  /**
   * Get a conversation by ID
   */
  async get(id: string): Promise<Conversation | null> {
    return this.db.getConversation(id);
  }

  /**
   * List conversations with optional filtering
   */
  async list(options?: ListConversationsOptions): Promise<Conversation[]> {
    return this.db.listConversations(options);
  }

  /**
   * Get conversation by external party identifier (phone, email).
   * Only returns pinned conversations — unpinned ones don't receive channel messages.
   */
  async getByExternalParty(
    externalParty: string,
  ): Promise<Conversation | null> {
    return this.db.getByExternalParty(externalParty);
  }

  /**
   * Make a conversation the current one (demotes any existing current)
   */
  async makeCurrent(conversationId: string): Promise<void> {
    this.db.makeCurrent(conversationId);
  }

  /**
   * Get the current conversation, if any
   */
  async getCurrent(): Promise<Conversation | null> {
    return this.db.getCurrent();
  }

  /**
   * Append a turn to a conversation
   *
   * This updates:
   * - The JSONL transcript (append-only)
   * - The FTS index (real-time)
   * - The conversation metadata (turn count, updated timestamp)
   */
  async appendTurn(id: string, turn: TranscriptTurn): Promise<void> {
    // Append to transcript
    this.transcripts.appendTurn(id, turn);

    // Index in FTS
    this.db.indexTurn(
      id,
      turn.turnNumber,
      turn.content,
      turn.role,
      turn.timestamp,
    );

    // Update metadata (only increment on user messages to avoid double-counting)
    if (turn.role === "user") {
      this.db.incrementTurnCount(id);
      this.db.updateConversation(id, {
        lastUserMessageAt: new Date(turn.timestamp),
      });
    } else {
      // Just update the timestamp for assistant messages
      this.db.updateConversation(id, { updated: new Date(turn.timestamp) });
    }

    // Notify listeners (e.g., screenshot ref scanning)
    this.onTurnAppended?.(id, turn);
  }

  /**
   * Get turns from a conversation with pagination
   */
  async getTurns(
    id: string,
    options?: GetTurnsOptions,
  ): Promise<TranscriptTurn[]> {
    return this.transcripts.getTurns(id, options);
  }

  /**
   * Get the most recent N turns from a conversation
   *
   * Used for context injection on cold start.
   */
  async getRecentTurns(id: string, limit: number): Promise<TranscriptTurn[]> {
    return this.transcripts.getRecentTurns(id, limit);
  }

  /**
   * Get the most recent user turn (any channel) from a conversation.
   *
   * Returns `{ channel, timestamp }` for the latest user turn or null if no
   * user turns exist. Powers the routing presence rule (M10-S0).
   */
  async getLastUserTurn(
    id: string,
  ): Promise<{ channel: string | undefined; timestamp: string } | null> {
    return this.transcripts.getLastUserTurn(id);
  }

  /**
   * Read the full JSONL transcript (all line types — meta, turns, events).
   *
   * Used by consumers that need to correlate events with turns (e.g. the
   * abbreviation queue honoring `turn_corrected` events, or the orphan
   * watchdog checking for `watchdog_rescued` idempotency markers).
   */
  async getFullTranscript(id: string): Promise<TranscriptLine[]> {
    return this.transcripts.readFullTranscript(id);
  }

  /**
   * Append an arbitrary event line to the transcript.
   *
   * Used for event types that don't have a dedicated setter (e.g.
   * `turn_corrected`, `watchdog_rescued`, `watchdog_resolved_stale`).
   */
  async appendEvent(id: string, event: TranscriptLine): Promise<void> {
    this.transcripts.appendEvent(id, event);
  }

  /**
   * Get turns before a given timestamp (cursor-based pagination)
   */
  async getTurnsBefore(
    id: string,
    beforeTimestamp: string,
    limit: number,
  ): Promise<{ turns: TranscriptTurn[]; hasMore: boolean }> {
    return this.transcripts.getTurnsBefore(id, beforeTimestamp, limit);
  }

  /**
   * Set the abbreviation for a conversation
   *
   * Updates both the database and appends an abbreviation event to the transcript.
   */
  async setAbbreviation(id: string, text: string): Promise<void> {
    // Update database
    this.db.updateConversation(id, {
      abbreviation: text,
      needsAbbreviation: false,
    });

    // Append abbreviation event to transcript
    this.transcripts.appendEvent(id, {
      type: "event",
      event: "abbreviation",
      text,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Get conversations that need abbreviation
   */
  async getPendingAbbreviations(): Promise<string[]> {
    return this.db.getPendingAbbreviations();
  }

  /**
   * Mark a conversation as needing abbreviation
   */
  async markNeedsAbbreviation(id: string): Promise<void> {
    this.db.updateConversation(id, { needsAbbreviation: true });
  }

  /**
   * Update conversation title (auto-naming)
   */
  async setTitle(id: string, title: string): Promise<void> {
    this.db.updateConversation(id, { title });

    // Append title_assigned event to transcript
    this.transcripts.appendEvent(id, {
      type: "event",
      event: "title_assigned",
      title,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Update conversation title manually (user-initiated, protects from auto-rename)
   */
  async setTitleManual(id: string, title: string): Promise<void> {
    this.db.updateConversation(id, { title, manuallyNamed: true });

    // Append title_assigned event to transcript
    this.transcripts.appendEvent(id, {
      type: "event",
      event: "title_assigned",
      title,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Update conversation topics
   */
  async setTopics(id: string, topics: string[]): Promise<void> {
    this.db.updateConversation(id, { topics });

    // Append meta_update event to transcript
    this.transcripts.appendEvent(id, {
      type: "meta_update",
      topics,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Update conversation metadata fields directly
   */
  async update(
    id: string,
    updates: Partial<Omit<Conversation, "id" | "created">>,
  ): Promise<void> {
    this.db.updateConversation(id, updates);
  }

  /**
   * Set the model for a conversation
   */
  async setModel(id: string, model: string): Promise<void> {
    this.db.updateConversation(id, { model });
  }

  /**
   * Unpin a conversation (makes it no longer the active channel conversation).
   * Unpinned conversations can still be viewed/continued via web dashboard,
   * but channel messages will no longer route to them.
   */
  async unpin(id: string): Promise<void> {
    this.db.unpinConversation(id);
  }

  /**
   * Search conversations using FTS
   */
  async search(query: string, limit = 10) {
    return this.db.searchConversations(query, limit);
  }

  /**
   * Delete a conversation
   *
   * Removes:
   * - Database record and FTS entries
   * - JSONL transcript file
   * - Attachments folder (placeholder - T6 will implement AttachmentService)
   *
   * Note: Session cleanup (idle timer, abbreviation task, session registry)
   * should be handled by the caller (chat-handler.ts) before calling this.
   */
  async delete(id: string): Promise<void> {
    // Delete from database (conversations + turns_fts)
    this.db.deleteConversation(id);

    // Delete transcript file
    this.transcripts.deleteTranscript(id);

    // TODO (T6): Delete attachments folder via AttachmentService
    // For now, attachments are not implemented so nothing to clean up
  }

  /**
   * Expose the underlying database instance for shared access (e.g. ExternalMessageStore)
   */
  getDb(): import("better-sqlite3").Database {
    return this.db.getDb();
  }

  /**
   * Expose the ConversationDatabase instance for direct access to DB methods
   * (e.g., getTaskSdkSessionId, updateTaskSdkSessionId)
   */
  getConversationDb(): ConversationDatabase {
    return this.db;
  }

  /**
   * Close database connection
   */
  close(): void {
    this.db.close();
  }
}
