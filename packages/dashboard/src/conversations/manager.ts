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

  constructor(agentDir: string) {
    this.transcripts = new TranscriptManager(agentDir);
    this.db = new ConversationDatabase(agentDir);
  }

  /**
   * Create a new conversation
   */
  async create(channel: "web" | "whatsapp" | "email"): Promise<Conversation> {
    const now = new Date();
    const conversationId = `conv-${ulid()}`;

    const conversation: Conversation = {
      id: conversationId,
      channel,
      title: null,
      topics: [],
      created: now,
      updated: now,
      turnCount: 0,
      participants: ["user"],
      abbreviation: null,
      needsAbbreviation: false,
    };

    // Create transcript file with metadata header
    const meta: TranscriptMeta = {
      type: "meta",
      id: conversationId,
      channel,
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
   * Get the most recent conversation for a channel
   */
  async getMostRecent(channel: string): Promise<Conversation | null> {
    return this.db.getMostRecent(channel);
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
    } else {
      // Just update the timestamp for assistant messages
      this.db.updateConversation(id, { updated: new Date(turn.timestamp) });
    }
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
   * Update conversation title
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
   * Search conversations using FTS
   */
  async search(query: string, limit = 10) {
    return this.db.searchConversations(query, limit);
  }

  /**
   * Close database connection
   */
  close(): void {
    this.db.close();
  }
}
