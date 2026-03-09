/**
 * Conversation Search Service (M6.7-S4)
 *
 * Higher-level service combining keyword (FTS5) + semantic (vector) search
 * with Reciprocal Rank Fusion (RRF) merging. Follows the same pattern as
 * the memory system's SearchService in @my-agent/core.
 */

import type { ConversationSearchDB, SearchResult } from "./search-db.js";
import type { EmbeddingsPlugin } from "@my-agent/core";

const RRF_K = 60; // Standard RRF constant (same as memory system)

export interface ConversationSearchResult {
  conversationId: string;
  turnNumber: number;
  content: string;
  timestamp: string;
  role: string;
  score: number;
}

export interface ConversationSearchServiceOptions {
  searchDb: ConversationSearchDB;
  getPlugin: () => EmbeddingsPlugin | null;
}

/**
 * Hybrid search result key: conversationId + turnNumber + role
 */
function resultKey(convId: string, turnNumber: number, role?: string): string {
  return `${convId}:${turnNumber}:${role ?? ""}`;
}

export class ConversationSearchService {
  private searchDb: ConversationSearchDB;
  private getPlugin: () => EmbeddingsPlugin | null;

  constructor(options: ConversationSearchServiceOptions) {
    this.searchDb = options.searchDb;
    this.getPlugin = options.getPlugin;
  }

  /**
   * Hybrid search: FTS5 keyword + vector semantic with RRF merge.
   * Falls back to FTS5-only if embeddings are unavailable.
   */
  async search(
    query: string,
    limit = 10,
  ): Promise<ConversationSearchResult[]> {
    const scores = new Map<string, number>();
    const resultData = new Map<
      string,
      { conversationId: string; turnNumber: number; content: string; timestamp: string; role: string }
    >();

    // FTS5 BM25 search
    const ftsResults = this.searchDb.searchKeyword(query, limit * 2);
    for (let i = 0; i < ftsResults.length; i++) {
      const r = ftsResults[i];
      // FTS doesn't store role separately — extract from prefixed content
      const role = r.content.startsWith("Assistant:") ? "assistant" : "user";
      const key = resultKey(r.conversationId, r.turnNumber, role);
      const rrfScore = 1 / (RRF_K + i + 1);
      scores.set(key, (scores.get(key) ?? 0) + rrfScore);
      if (!resultData.has(key)) {
        resultData.set(key, {
          conversationId: r.conversationId,
          turnNumber: r.turnNumber,
          content: r.content,
          timestamp: r.timestamp,
          role,
        });
      }
    }

    // Vector search (if embeddings available)
    const plugin = this.getPlugin();
    if (plugin && this.searchDb.isVectorReady()) {
      try {
        const isReady = await plugin.isReady();
        if (isReady) {
          const queryEmbedding = await plugin.embed(query);
          const vecResults = this.searchDb.searchVector(
            queryEmbedding,
            limit * 2,
          );

          for (let i = 0; i < vecResults.length; i++) {
            const r = vecResults[i];
            const key = resultKey(r.conversationId, r.turnNumber, r.role);
            const rrfScore = 1 / (RRF_K + i + 1);
            scores.set(key, (scores.get(key) ?? 0) + rrfScore);
            // Vector results don't have content — will be filled from FTS or left for caller to enrich
            if (!resultData.has(key)) {
              resultData.set(key, {
                conversationId: r.conversationId,
                turnNumber: r.turnNumber,
                content: "",
                timestamp: "",
                role: r.role,
              });
            }
          }
        }
      } catch (error) {
        console.warn(
          "[ConversationSearch] Vector search failed, using FTS5 only:",
          error instanceof Error ? error.message : String(error),
        );
      }
    }

    // Sort by RRF score descending, take top `limit`
    const sorted = [...scores.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit);

    return sorted.map(([key, score]) => {
      const data = resultData.get(key)!;
      return { ...data, score };
    });
  }

  /**
   * Index a single turn (FTS is handled by ConversationDatabase.indexTurn,
   * this handles embedding only). Fire-and-forget safe.
   */
  async indexTurn(
    conversationId: string,
    turnNumber: number,
    role: string,
    content: string,
  ): Promise<void> {
    const plugin = this.getPlugin();
    if (!plugin || !this.searchDb.isVectorReady()) return;

    try {
      const isReady = await plugin.isReady();
      if (!isReady) return;

      const embedding = await plugin.embed(content);
      this.searchDb.upsertEmbedding(
        conversationId,
        turnNumber,
        role,
        embedding,
      );
    } catch (error) {
      // Never block conversation flow on embedding failure
      console.warn(
        `[ConversationSearch] Failed to embed turn ${conversationId}:${turnNumber}:`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  /**
   * Index turns that have FTS entries but no embeddings.
   * Called on startup to catch up.
   *
   * @param getAllTurns - function that returns all turns from transcripts
   * @returns number of turns indexed
   */
  async indexMissing(
    getAllTurns: () => Array<{
      conversationId: string;
      turnNumber: number;
      role: string;
      content: string;
    }>,
  ): Promise<number> {
    const plugin = this.getPlugin();
    if (!plugin || !this.searchDb.isVectorReady()) return 0;

    try {
      const isReady = await plugin.isReady();
      if (!isReady) return 0;
    } catch {
      return 0;
    }

    const allTurns = getAllTurns();
    let indexed = 0;

    for (const turn of allTurns) {
      if (this.searchDb.hasEmbedding(turn.conversationId, turn.turnNumber)) {
        continue;
      }

      try {
        const embedding = await plugin.embed(turn.content);
        this.searchDb.upsertEmbedding(
          turn.conversationId,
          turn.turnNumber,
          turn.role,
          embedding,
        );
        indexed++;
      } catch (error) {
        console.warn(
          `[ConversationSearch] Failed to embed missing turn ${turn.conversationId}:${turn.turnNumber}:`,
          error instanceof Error ? error.message : String(error),
        );
      }
    }

    return indexed;
  }

  /**
   * Remove all vector data for a conversation.
   * FTS cleanup is handled by ConversationDatabase.deleteConversation().
   */
  removeConversation(conversationId: string): void {
    this.searchDb.removeTurns(conversationId);
  }

  /**
   * Check if semantic search is available.
   */
  async isSemanticAvailable(): Promise<boolean> {
    const plugin = this.getPlugin();
    if (!plugin || !this.searchDb.isVectorReady()) return false;
    try {
      return await plugin.isReady();
    } catch {
      return false;
    }
  }
}
