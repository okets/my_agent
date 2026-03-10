/**
 * Conversation Search & Browse Routes (M6.7-S4)
 *
 * User-facing REST endpoints for conversation search (hybrid FTS5 + semantic)
 * and read-only conversation browsing. Separate from the admin routes
 * (which are localhost-only) and the memory routes (which handle notebook search).
 *
 * Prefix: /api/conversations
 */

import type { FastifyInstance } from "fastify";
import type { ConversationSearchService } from "../conversations/search-service.js";

/**
 * Register conversation search and browse routes
 */
export async function registerConversationSearchRoutes(
  fastify: FastifyInstance,
): Promise<void> {
  /**
   * GET /api/conversations/search?q=<query>&limit=10
   *
   * Hybrid search (FTS5 + vector) across conversation turns.
   * Returns enriched results with conversation metadata.
   */
  fastify.get<{
    Querystring: { q?: string; limit?: string };
  }>("/search", async (request, reply) => {
    const conversationSearchService = fastify.conversationSearchService;

    if (!conversationSearchService) {
      return reply.code(503).send({
        error: "Conversation search service not initialized",
        results: [],
        totalResults: 0,
      });
    }

    const { q, limit: limitStr } = request.query;

    if (!q || !q.trim()) {
      return { results: [], totalResults: 0 };
    }

    const limit = limitStr ? parseInt(limitStr, 10) : 10;
    const clampedLimit = Math.max(1, Math.min(limit, 100));

    try {
      const rawResults = await conversationSearchService.search(
        q.trim(),
        clampedLimit,
      );

      // Enrich with conversation metadata
      const conversationManager = fastify.conversationManager;
      const results = await Promise.all(
        rawResults.map(async (r) => {
          const conv = conversationManager
            ? await conversationManager.get(r.conversationId)
            : null;
          return {
            conversationId: r.conversationId,
            conversationTitle: conv?.title ?? "Untitled",
            channel: conv?.channel ?? "unknown",
            turnNumber: r.turnNumber,
            role: r.role,
            snippet: r.content.slice(0, 200),
            timestamp: r.timestamp,
            score: Math.round(r.score * 10000) / 10000,
          };
        }),
      );

      return { results, totalResults: results.length };
    } catch (err) {
      fastify.log.error(err, "[ConversationSearch] Search failed");
      return reply.code(500).send({
        error: err instanceof Error ? err.message : "Search failed",
        results: [],
        totalResults: 0,
      });
    }
  });

  /**
   * GET /api/conversations/:id
   *
   * Fetch a full conversation with all turns (read-only preview).
   * Used by the Home widget (S5) to display conversation detail.
   */
  fastify.get<{
    Params: { id: string };
  }>("/:id", async (request, reply) => {
    const { id } = request.params;
    const conversationManager = fastify.conversationManager;

    if (!conversationManager) {
      return reply
        .code(503)
        .send({ error: "Conversation manager not initialized" });
    }

    const conversation = await conversationManager.get(id);
    if (!conversation) {
      return reply.code(404).send({ error: "Conversation not found" });
    }

    const turns = await conversationManager.getTurns(id);

    return {
      id: conversation.id,
      title: conversation.title,
      status: conversation.status,
      channel: conversation.channel,
      turnCount: conversation.turnCount,
      turns: turns.map((t) => ({
        role: t.role,
        content:
          typeof t.content === "string" ? t.content : JSON.stringify(t.content),
        timestamp: t.timestamp,
        channel: t.channel ?? null,
        turnNumber: t.turnNumber,
      })),
    };
  });

  /**
   * GET /api/conversations
   *
   * List all conversations with metadata and a preview of the latest turn.
   */
  fastify.get<{
    Querystring: { channel?: string; limit?: string };
  }>("/", async (request, reply) => {
    const conversationManager = fastify.conversationManager;

    if (!conversationManager) {
      return reply
        .code(503)
        .send({ error: "Conversation manager not initialized" });
    }

    const { channel, limit: limitStr } = request.query;
    const limit = limitStr ? parseInt(limitStr, 10) : undefined;

    try {
      const conversations = await conversationManager.list({ channel, limit });

      const result = await Promise.all(
        conversations.map(async (conv) => {
          // Get the most recent turn for preview
          let preview: string | null = null;
          try {
            const recentTurns = await conversationManager.getRecentTurns(
              conv.id,
              1,
            );
            if (recentTurns.length > 0) {
              const content = recentTurns[0].content;
              const text =
                typeof content === "string" ? content : JSON.stringify(content);
              preview = text.slice(0, 100);
            }
          } catch {
            // Preview is optional — skip on error
          }

          return {
            id: conv.id,
            title: conv.title,
            status: conv.status,
            channel: conv.channel,
            turnCount: conv.turnCount,
            preview,
            updated: conv.updated.toISOString(),
          };
        }),
      );

      return { conversations: result };
    } catch (err) {
      fastify.log.error(err, "[ConversationSearch] List failed");
      return reply.code(500).send({
        error: err instanceof Error ? err.message : "Failed to list",
      });
    }
  });
}
