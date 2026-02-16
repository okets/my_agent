/**
 * Session Registry
 *
 * LRU cache of SessionManager instances per conversation.
 * Evicts least recently used sessions when limit is reached.
 */

import { SessionManager } from "./session-manager.js";
import { buildContextInjection } from "./context-builder.js";
import type { ConversationManager } from "../conversations/index.js";

const RECENT_TURNS_LIMIT = 10;

/**
 * Registry for managing SessionManager instances per conversation
 * with LRU eviction
 */
export class SessionRegistry {
  private sessions = new Map<string, SessionManager>();
  private accessOrder: string[] = [];
  private maxSessions: number;

  constructor(maxSessions: number = 5) {
    this.maxSessions = maxSessions;
  }

  /**
   * Get or create a session for a conversation
   *
   * @param conversationId - The conversation ID
   * @param manager - ConversationManager for loading history
   * @returns SessionManager (warm if cached, cold if new)
   */
  async getOrCreate(
    conversationId: string,
    manager: ConversationManager,
  ): Promise<SessionManager> {
    // Check if session exists (warm)
    if (this.sessions.has(conversationId)) {
      // Move to end of access order (most recently used)
      this.touchAccess(conversationId);
      return this.sessions.get(conversationId)!;
    }

    // Cold start - need to create new session with context injection
    const conversation = await manager.get(conversationId);

    if (!conversation) {
      throw new Error(`Conversation ${conversationId} not found`);
    }

    // Load recent turns and abbreviation for context
    const recentTurns = await manager.getRecentTurns(
      conversationId,
      RECENT_TURNS_LIMIT,
    );

    let contextInjection: string | null = null;

    if (recentTurns.length > 0 || conversation.abbreviation) {
      contextInjection = buildContextInjection(
        recentTurns,
        conversation.abbreviation,
        conversation.updated,
      );
    }

    // Create new session
    const session = new SessionManager(conversationId, contextInjection);

    // Evict LRU if at capacity
    if (this.sessions.size >= this.maxSessions) {
      this.evictLRU();
    }

    // Add to registry
    this.sessions.set(conversationId, session);
    this.accessOrder.push(conversationId);

    return session;
  }

  /**
   * Remove a session from the registry
   */
  remove(conversationId: string): void {
    const session = this.sessions.get(conversationId);
    if (session) {
      session.abort(); // Clean up any active queries
      this.sessions.delete(conversationId);
      this.accessOrder = this.accessOrder.filter((id) => id !== conversationId);
    }
  }

  /**
   * Get all sessions
   */
  getAll(): Map<string, SessionManager> {
    return new Map(this.sessions);
  }

  /**
   * Check if a conversation has a warm session
   */
  isWarm(conversationId: string): boolean {
    return this.sessions.has(conversationId);
  }

  /**
   * Update access order for LRU tracking
   */
  private touchAccess(conversationId: string): void {
    // Remove from current position
    this.accessOrder = this.accessOrder.filter((id) => id !== conversationId);
    // Add to end (most recently used)
    this.accessOrder.push(conversationId);
  }

  /**
   * Evict the least recently used session
   */
  private evictLRU(): void {
    if (this.accessOrder.length === 0) return;

    const lruId = this.accessOrder.shift()!;
    const session = this.sessions.get(lruId);

    if (session) {
      session.abort(); // Clean up
      this.sessions.delete(lruId);
      console.log(`Evicted LRU session for conversation ${lruId}`);
    }
  }

  /**
   * Get current session count
   */
  size(): number {
    return this.sessions.size;
  }

  /**
   * Clear all sessions
   */
  clear(): void {
    for (const session of this.sessions.values()) {
      session.abort();
    }
    this.sessions.clear();
    this.accessOrder = [];
  }
}
