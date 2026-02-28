/**
 * Memory API Routes (M6-S3)
 *
 * User-facing memory endpoints for dashboard UI.
 * Complements the debug/admin endpoints with UI-friendly responses.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { existsSync, readdirSync } from "fs";
import { join } from "path";
import {
  saveEmbeddingsConfig,
  type YamlEmbeddingsConfig,
} from "@my-agent/core";

/**
 * Attempt lazy recovery of a degraded embeddings plugin.
 * Called at the top of search/rebuild handlers so the user
 * gets fresh results if the service came back between health checks.
 */
async function tryLazyRecovery(fastify: FastifyInstance): Promise<void> {
  const pluginRegistry = fastify.pluginRegistry;
  if (!pluginRegistry?.isDegraded()) return;

  const intendedId = pluginRegistry.getIntendedPluginId();
  if (!intendedId) return;

  const plugin = pluginRegistry.get(intendedId);
  if (!plugin) return;

  try {
    await plugin.initialize();
    const isReady = await plugin.isReady();
    if (isReady) {
      await pluginRegistry.setActive(intendedId);
      const dims = plugin.getDimensions();
      if (dims && fastify.memoryDb) {
        fastify.memoryDb.initVectorTable(dims);
      }
      fastify.log.info(`[Memory] Lazy recovery succeeded: ${intendedId}`);
      // Re-embed files that arrived while degraded (non-blocking)
      fastify.syncService?.fullSync().catch(() => {});
      fastify.statePublisher?.publishMemory();
    }
  } catch {
    // Still degraded — leave state as-is, liveness loop will retry
  }
}

/**
 * Register memory routes
 */
export async function registerMemoryRoutes(
  fastify: FastifyInstance,
): Promise<void> {
  /**
   * GET /api/memory/search
   *
   * Search notebook and daily logs (UI-friendly format)
   * Returns grouped results ready for display
   */
  fastify.get<{
    Querystring: {
      q: string;
      maxResults?: string;
    };
  }>("/search", async (request, reply) => {
    // Try lazy recovery before searching
    await tryLazyRecovery(fastify);

    const searchService = fastify.searchService;

    if (!searchService) {
      return reply.code(503).send({
        error: "Search service not initialized",
        notebook: [],
        daily: [],
      });
    }

    const { q, maxResults } = request.query;

    if (!q || !q.trim()) {
      return {
        query: "",
        notebook: [],
        daily: [],
        totalResults: 0,
      };
    }

    try {
      const results = await searchService.recall(q.trim(), {
        maxResults: maxResults ? parseInt(maxResults, 10) : 15,
        minScore: 0, // Let UI decide what to show
      });

      return {
        query: q.trim(),
        notebook: results.notebook.map((r) => ({
          path: r.filePath,
          heading: r.heading,
          snippet: r.snippet,
          score: Math.round(r.score * 100) / 100,
          lines: r.lines,
        })),
        daily: results.daily.map((r) => ({
          path: r.filePath,
          heading: r.heading,
          snippet: r.snippet,
          score: Math.round(r.score * 100) / 100,
          lines: r.lines,
        })),
        totalResults: results.notebook.length + results.daily.length,
        ...(results.degraded && { degraded: results.degraded }),
      };
    } catch (err) {
      fastify.log.error(err, "[Memory] Search failed");
      return reply.code(500).send({
        error: err instanceof Error ? err.message : "Search failed",
        notebook: [],
        daily: [],
      });
    }
  });

  /**
   * GET /api/memory/status
   *
   * Memory system status for settings UI
   */
  fastify.get("/status", async (request, reply) => {
    const memoryDb = fastify.memoryDb;
    const pluginRegistry = fastify.pluginRegistry;
    const syncService = fastify.syncService;

    if (!memoryDb) {
      return {
        initialized: false,
        error: "Memory system not initialized",
      };
    }

    const status = memoryDb.getStatus();
    const active = pluginRegistry?.getActive();
    const available = pluginRegistry?.list() || [];
    const degradedHealth = pluginRegistry?.getDegradedHealth();
    const intendedId = pluginRegistry?.getIntendedPluginId();
    const intendedPlugin = intendedId ? pluginRegistry?.get(intendedId) : null;

    // Determine 4-state plugin status (M6-S9)
    let pluginState: "not_set_up" | "connecting" | "active" | "error" =
      "not_set_up";
    if (active) {
      pluginState = "active";
    } else if (degradedHealth) {
      pluginState = "error";
    } else if (intendedId) {
      pluginState = "connecting";
    }

    return {
      initialized: true,
      pluginState, // M6-S9: 4-state status for header icon
      activePlugin: active
        ? {
            id: active.id,
            name: active.name,
            model: active.modelName,
          }
        : null,
      index: {
        filesIndexed: status.filesIndexed,
        totalChunks: status.totalChunks,
        lastSync: status.lastSync,
        hasVectorIndex: status.dimensions !== null,
      },
      embeddings: {
        active: active
          ? {
              id: active.id,
              name: active.name,
              model: active.modelName,
              dimensions: active.getDimensions(),
            }
          : null,
        degraded: degradedHealth
          ? {
              pluginId: intendedId ?? "unknown",
              pluginName: intendedPlugin?.name ?? "Unknown",
              model: intendedPlugin?.modelName ?? "unknown",
              error: degradedHealth.message ?? "Plugin unhealthy",
              resolution:
                degradedHealth.resolution ?? "Check plugin configuration.",
              since:
                degradedHealth.since?.toISOString() ?? new Date().toISOString(),
            }
          : null,
        available: available.map((p) => ({
          id: p.id,
          name: p.name,
          model: p.modelName,
          settings: p.getSettings?.(),
        })),
        ready: status.embeddingsReady,
        // Check if local model is cached (for "Delete Local Model" visibility)
        localModelCached: (() => {
          const agentDir = (memoryDb as any)?.agentDir as string | undefined;
          if (!agentDir) return false;
          const modelsDir = join(agentDir, "cache", "models");
          if (!existsSync(modelsDir)) return false;
          // Check if directory has any files
          try {
            const files = readdirSync(modelsDir);
            return files.length > 0;
          } catch {
            return false;
          }
        })(),
      },
    };
  });

  /**
   * POST /api/memory/rebuild
   *
   * Rebuild memory index (user-facing, simplified)
   */
  fastify.post("/rebuild", async (request, reply) => {
    // Try lazy recovery before rebuilding
    await tryLazyRecovery(fastify);

    const syncService = fastify.syncService;

    if (!syncService) {
      return reply.code(503).send({
        error: "Sync service not initialized",
      });
    }

    try {
      fastify.log.info("[Memory] Starting index rebuild...");
      const result = await syncService.rebuild();

      // Publish live update to all connected clients
      fastify.statePublisher?.publishMemory();

      const degraded = fastify.pluginRegistry?.getDegradedHealth();
      return {
        success: true,
        filesIndexed: result.added,
        errors: result.errors.length,
        durationMs: result.duration,
        ...(degraded && {
          warning:
            "Embeddings plugin is degraded — rebuild indexed text only (no new vectors).",
        }),
      };
    } catch (err) {
      fastify.log.error(err, "[Memory] Rebuild failed");
      return reply.code(500).send({
        error: err instanceof Error ? err.message : "Rebuild failed",
      });
    }
  });

  /**
   * POST /api/memory/sync
   *
   * Incremental sync — only indexes new/changed files (does NOT clear existing index)
   */
  fastify.post("/sync", async (request, reply) => {
    // Try lazy recovery before syncing
    await tryLazyRecovery(fastify);

    const syncService = fastify.syncService;

    if (!syncService) {
      return reply.code(503).send({
        error: "Sync service not initialized",
      });
    }

    try {
      fastify.log.info("[Memory] Starting incremental sync...");
      const result = await syncService.fullSync();

      // Publish live update to all connected clients
      fastify.statePublisher?.publishMemory();

      const degraded = fastify.pluginRegistry?.getDegradedHealth();
      return {
        success: true,
        added: result.added,
        updated: result.updated,
        removed: result.removed,
        errors: result.errors.length,
        durationMs: result.duration,
        ...(degraded && {
          warning:
            "Embeddings plugin is degraded — sync indexed text only (no new vectors).",
        }),
      };
    } catch (err) {
      fastify.log.error(err, "[Memory] Sync failed");
      return reply.code(500).send({
        error: err instanceof Error ? err.message : "Sync failed",
      });
    }
  });

  /**
   * GET /api/memory/conversations/search
   *
   * Search conversation transcripts (FTS)
   * Separate from notebook search to keep results clean
   */
  fastify.get<{
    Querystring: {
      q: string;
      maxResults?: string;
      channel?: string;
    };
  }>("/conversations/search", async (request, reply) => {
    const conversationManager = fastify.conversationManager;

    if (!conversationManager) {
      return reply.code(503).send({
        error: "Conversation manager not initialized",
        results: [],
      });
    }

    const { q, maxResults, channel } = request.query;

    if (!q || !q.trim()) {
      return {
        query: "",
        results: [],
        totalResults: 0,
      };
    }

    try {
      // Access the database directly for FTS search
      const db = conversationManager.getDb();
      const limit = maxResults ? parseInt(maxResults, 10) : 10;

      // Build FTS query - wrap in quotes for phrase matching if contains spaces
      const ftsQuery = q.includes(" ") ? `"${q}"` : q;

      const rawResults = db
        .prepare(
          `
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
        `,
        )
        .all(ftsQuery, limit) as Array<{
        conversationId: string;
        turnNumber: number;
        content: string;
        timestamp: string;
        rank: number;
      }>;

      // Enrich with conversation metadata
      const results = await Promise.all(
        rawResults.map(async (r) => {
          const conv = await conversationManager.get(r.conversationId);
          return {
            conversationId: r.conversationId,
            conversationTitle: conv?.title || "Untitled",
            channel: conv?.channel || "unknown",
            turnNumber: r.turnNumber,
            snippet: r.content.slice(0, 200),
            timestamp: r.timestamp,
          };
        }),
      );

      // Filter by channel if specified
      const filtered = channel
        ? results.filter((r) => r.channel === channel)
        : results;

      return {
        query: q.trim(),
        results: filtered,
        totalResults: filtered.length,
      };
    } catch (err) {
      fastify.log.error(err, "[Memory] Conversation search failed");
      return reply.code(500).send({
        error: err instanceof Error ? err.message : "Search failed",
        results: [],
      });
    }
  });

  /**
   * POST /api/memory/embeddings/activate
   *
   * Switch embeddings plugin
   */
  fastify.post<{ Body: { pluginId: string; ollamaHost?: string } }>(
    "/embeddings/activate",
    async (request, reply) => {
      const pluginRegistry = fastify.pluginRegistry;

      if (!pluginRegistry) {
        return reply.code(503).send({
          error: "Plugin registry not initialized",
        });
      }

      const { pluginId, ollamaHost } = request.body || {};

      if (!pluginId) {
        return reply.code(400).send({ error: "pluginId is required" });
      }

      // Handle "none" to disable embeddings
      if (pluginId === "none") {
        await pluginRegistry.setActive(null);
        // Clear persisted meta so plugin isn't restored on restart
        fastify.memoryDb?.setIndexMeta({
          embeddingsPlugin: null,
          embeddingsModel: null,
          dimensions: null,
        });
        fastify.log.info("[Memory] Disabled embeddings");
        fastify.statePublisher?.publishMemory();
        return { success: true, pluginId: null };
      }

      const plugin = pluginRegistry.get(pluginId);
      if (!plugin) {
        const available = pluginRegistry.list().map((p) => p.id);
        return reply.code(404).send({
          error: `Plugin not found: ${pluginId}`,
          available,
        });
      }

      try {
        // Configure Ollama host if provided
        if (pluginId === "ollama" && ollamaHost && "setHost" in plugin) {
          (plugin as { setHost: (host: string) => void }).setHost(ollamaHost);
        }

        // Initialize the plugin
        await plugin.initialize();

        // Check if ready
        const isReady = await plugin.isReady();
        if (!isReady) {
          return reply.code(503).send({
            error: "Plugin not ready after initialization",
            pluginId,
            note: "Model may still be downloading",
          });
        }

        // Set as active
        await pluginRegistry.setActive(pluginId);

        // Reset vector index if plugin/model changed (clears stale embeddings)
        let warning: string | undefined;
        const dims = plugin.getDimensions();
        if (dims && fastify.memoryDb) {
          const { modelChanged } = fastify.memoryDb.resetVectorIndex(
            pluginId,
            plugin.modelName,
            dims,
          );
          if (modelChanged) {
            warning =
              "Embeddings model changed. Vector index cleared — rebuild needed.";
            fastify.log.warn(`[Memory] ${warning}`);
          }
        }

        fastify.log.info(`[Memory] Activated embeddings plugin: ${pluginId}`);

        // Publish live update to all connected clients
        fastify.statePublisher?.publishMemory();

        return {
          success: true,
          pluginId,
          name: plugin.name,
          model: plugin.modelName,
          dimensions: dims,
          ...(warning && { warning }),
        };
      } catch (err) {
        fastify.log.error(
          err,
          `[Memory] Failed to activate plugin ${pluginId}`,
        );
        return reply.code(500).send({
          error:
            err instanceof Error ? err.message : "Plugin activation failed",
        });
      }
    },
  );

  /**
   * GET /api/memory/embeddings/ollama/models
   *
   * List available models from an Ollama server.
   * Used by UI to populate model dropdown after user enters host.
   */
  fastify.get<{
    Querystring: { host?: string };
  }>("/embeddings/ollama/models", async (request, reply) => {
    const host = request.query.host || "http://localhost:11434";

    try {
      const response = await fetch(`${host}/api/tags`, {
        method: "GET",
        signal: AbortSignal.timeout(5000),
      });

      if (!response.ok) {
        return reply.code(502).send({
          error: `Ollama server returned HTTP ${response.status}`,
          models: [],
        });
      }

      const data = (await response.json()) as {
        models: Array<{ name: string; size: number; modified_at: string }>;
      };

      // Return all models (no filtering — user responsibility to pick embedding model)
      const models = data.models.map((m) => ({
        name: m.name,
        size: m.size,
      }));

      return { models, host };
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to connect to Ollama";
      fastify.log.warn(`[Memory] Failed to list Ollama models: ${message}`);
      return reply.code(502).send({
        error: `Cannot reach Ollama server at ${host}`,
        models: [],
      });
    }
  });

  /**
   * POST /api/memory/embeddings/config
   *
   * Save embeddings configuration to config.yaml
   */
  fastify.post<{
    Body: YamlEmbeddingsConfig;
  }>("/embeddings/config", async (request, reply) => {
    const { plugin, host, model } = request.body || {};

    if (!plugin || !["ollama", "local", "disabled"].includes(plugin)) {
      return reply.code(400).send({
        error: "Invalid plugin. Must be 'ollama', 'local', or 'disabled'.",
      });
    }

    const config: YamlEmbeddingsConfig = { plugin };
    if (plugin === "ollama") {
      config.host = host ?? "http://localhost:11434";
      config.model = model ?? "nomic-embed-text";
    }

    try {
      // Get agent directory from memoryDb (it knows the agentDir)
      const agentDir = (fastify.memoryDb as any)?.agentDir as
        | string
        | undefined;
      saveEmbeddingsConfig(config, agentDir);

      // Update running plugin if Ollama
      if (plugin === "ollama" && fastify.pluginRegistry) {
        const ollamaPlugin = fastify.pluginRegistry.get("embeddings-ollama");
        if (ollamaPlugin?.configure) {
          await ollamaPlugin.configure({
            host: config.host,
            model: config.model,
          });
        }
      }

      fastify.log.info(
        `[Memory] Saved embeddings config: ${JSON.stringify(config)}`,
      );
      return reply.send({ success: true, config });
    } catch (err) {
      fastify.log.error(err, "[Memory] Failed to save embeddings config");
      return reply.code(500).send({
        error: "Failed to save embeddings config",
      });
    }
  });
}
