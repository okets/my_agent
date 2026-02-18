/**
 * Admin API Routes
 *
 * Mutating operations for test scenarios and debugging.
 * All routes are localhost-only.
 *
 * @see docs/design/debug-api.md
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { join } from "node:path";
import { writeFile, rm, unlink } from "node:fs/promises";
import { invalidateCalendarContextCache } from "@my-agent/core";

/**
 * Localhost-only middleware
 */
function localhostOnly(
  request: FastifyRequest,
  reply: FastifyReply,
  done: () => void,
) {
  const ip = request.ip;
  const isLocalhost =
    ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";

  if (!isLocalhost) {
    reply.code(403).send({ error: "Admin API is localhost-only" });
    return;
  }
  done();
}

/**
 * Register admin routes
 */
export async function registerAdminRoutes(
  fastify: FastifyInstance,
): Promise<void> {
  // Apply localhost-only middleware to all admin routes
  fastify.addHook("onRequest", localhostOnly);

  /**
   * POST /caches/:name/invalidate
   *
   * Force invalidate a specific cache
   */
  fastify.post<{ Params: { name: string } }>(
    "/caches/:name/invalidate",
    async (request, reply) => {
      const { name } = request.params;

      switch (name) {
        case "calendar-context":
          invalidateCalendarContextCache();
          fastify.log.info("[Admin] Invalidated calendar context cache");
          return { ok: true, cache: name };

        case "caldav-calendars":
          // CalDAV client cache is per-instance, we can't invalidate globally
          // but we can note that it will refresh on next access
          fastify.log.info(
            "[Admin] CalDAV calendars cache will refresh on next access",
          );
          return {
            ok: true,
            cache: name,
            note: "Per-instance cache, will refresh on next access",
          };

        case "dedup":
          // Dedup cache is per-channel instance
          fastify.log.warn(
            "[Admin] Dedup cache invalidation not supported (per-channel)",
          );
          return {
            ok: false,
            cache: name,
            error: "Dedup cache is per-channel, cannot invalidate globally",
          };

        case "debouncer":
          // Debouncer is per-channel instance
          fastify.log.warn(
            "[Admin] Debouncer invalidation not supported (per-channel)",
          );
          return {
            ok: false,
            cache: name,
            error: "Debouncer is per-channel, cannot invalidate globally",
          };

        default:
          return reply.code(400).send({
            error: `Unknown cache: ${name}`,
            available: [
              "calendar-context",
              "caldav-calendars",
              "dedup",
              "debouncer",
            ],
          });
      }
    },
  );

  /**
   * POST /hatching/reset
   *
   * Clear hatching state - return to pre-hatched state
   * DESTRUCTIVE: Requires X-Confirm-Destructive header
   */
  fastify.post("/hatching/reset", async (request, reply) => {
    const confirmHeader = request.headers["x-confirm-destructive"];
    if (confirmHeader !== "true") {
      return reply.code(400).send({
        error:
          "Destructive operation requires X-Confirm-Destructive: true header",
      });
    }

    const agentDir = fastify.agentDir;
    const removed: string[] = [];

    // Remove .hatched marker
    try {
      await unlink(join(agentDir, ".hatched"));
      removed.push(".hatched");
    } catch {
      // Doesn't exist
    }

    // Remove auth.json
    try {
      await unlink(join(agentDir, "auth.json"));
      removed.push("auth.json");
    } catch {
      // Doesn't exist
    }

    // Remove brain/CLAUDE.md
    try {
      await unlink(join(agentDir, "brain/CLAUDE.md"));
      removed.push("brain/CLAUDE.md");
    } catch {
      // Doesn't exist
    }

    // Remove brain/memory/core/ contents
    try {
      await rm(join(agentDir, "brain/memory/core"), { recursive: true });
      removed.push("brain/memory/core/");
    } catch {
      // Doesn't exist
    }

    // Update server state
    fastify.isHatched = false;

    fastify.log.info(
      `[Admin] Reset hatching state, removed: ${removed.join(", ")}`,
    );

    return { ok: true, removed };
  });

  /**
   * POST /conversation/:id/delete
   *
   * Delete a conversation
   */
  fastify.post<{ Params: { id: string } }>(
    "/conversation/:id/delete",
    async (request, reply) => {
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

      await conversationManager.delete(id);
      fastify.log.info(`[Admin] Deleted conversation ${id}`);

      return { ok: true, conversationId: id };
    },
  );

  /**
   * POST /conversation/:id/rename
   *
   * Rename a conversation
   */
  fastify.post<{ Params: { id: string }; Body: { title: string } }>(
    "/conversation/:id/rename",
    async (request, reply) => {
      const { id } = request.params;
      const { title } = request.body || {};

      if (!title || typeof title !== "string") {
        return reply.code(400).send({ error: "title is required" });
      }

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

      const trimmedTitle = title.slice(0, 100);
      await conversationManager.setTitleManual(id, trimmedTitle);
      fastify.log.info(
        `[Admin] Renamed conversation ${id} to "${trimmedTitle}"`,
      );

      return { ok: true, conversationId: id, title: trimmedTitle };
    },
  );

  /**
   * POST /notebook/:name/write
   *
   * Write to a notebook file
   */
  fastify.post<{ Params: { name: string }; Body: { content: string } }>(
    "/notebook/:name/write",
    async (request, reply) => {
      const { name } = request.params;
      const { content } = request.body || {};

      // Only allow specific notebook files
      const allowedFiles = [
        "external-communications",
        "reminders",
        "standing-orders",
      ];
      if (!allowedFiles.includes(name)) {
        return reply.code(400).send({
          error: `Invalid notebook: ${name}`,
          available: allowedFiles,
        });
      }

      if (typeof content !== "string") {
        return reply.code(400).send({ error: "content is required" });
      }

      const filePath = join(fastify.agentDir, "runtime", `${name}.md`);

      try {
        await writeFile(filePath, content, "utf-8");
        fastify.log.info(
          `[Admin] Wrote ${content.length} chars to notebook ${name}`,
        );

        return { ok: true, notebook: name, chars: content.length };
      } catch (err) {
        fastify.log.error(err, `[Admin] Failed to write notebook ${name}`);
        return reply.code(500).send({
          error:
            err instanceof Error ? err.message : "Failed to write notebook",
        });
      }
    },
  );

  /**
   * POST /inject-message
   *
   * Inject a message into conversation context (for testing)
   * Note: This modifies the transcript directly, not the SDK session
   */
  fastify.post<{
    Body: {
      conversationId: string;
      role: "user" | "assistant" | "system";
      content: string;
    };
  }>("/inject-message", async (request, reply) => {
    const { conversationId, role, content } = request.body || {};

    if (!conversationId || !role || !content) {
      return reply.code(400).send({
        error: "conversationId, role, and content are required",
      });
    }

    if (!["user", "assistant", "system"].includes(role)) {
      return reply.code(400).send({
        error: "role must be user, assistant, or system",
      });
    }

    const conversationManager = fastify.conversationManager;

    if (!conversationManager) {
      return reply
        .code(503)
        .send({ error: "Conversation manager not initialized" });
    }

    const conversation = await conversationManager.get(conversationId);
    if (!conversation) {
      return reply.code(404).send({ error: "Conversation not found" });
    }

    // Append turn to transcript
    const turnNumber = conversation.turnCount + 1;
    await conversationManager.appendTurn(conversationId, {
      type: "turn",
      role: role as "user" | "assistant",
      content,
      timestamp: new Date().toISOString(),
      turnNumber,
    });

    fastify.log.info(
      `[Admin] Injected ${role} message into conversation ${conversationId}`,
    );

    return { ok: true, turnNumber };
  });

  /**
   * POST /channel/:id/simulate-message
   *
   * Inject a fake inbound channel message for testing
   */
  fastify.post<{
    Params: { id: string };
    Body: { from: string; content: string };
  }>("/channel/:id/simulate-message", async (request, reply) => {
    const { id } = request.params;
    const { from, content } = request.body || {};

    if (!from || !content) {
      return reply.code(400).send({ error: "from and content are required" });
    }

    const channelMessageHandler = fastify.channelMessageHandler;
    if (!channelMessageHandler) {
      return reply
        .code(503)
        .send({ error: "Channel message handler not initialized" });
    }

    const channelManager = fastify.channelManager;
    if (!channelManager) {
      return reply.code(503).send({ error: "Channel manager not initialized" });
    }

    // Check if channel exists
    const channels = channelManager.getChannelInfos();
    const channel = channels.find((c) => c.id === id);
    if (!channel) {
      return reply.code(404).send({ error: `Channel not found: ${id}` });
    }

    // Create simulated incoming message
    const simulatedMessage = {
      id: `sim-${Date.now()}`,
      channelId: id,
      from,
      content,
      timestamp: new Date(),
    };

    // Process through the message handler
    try {
      await channelMessageHandler.handleMessages(id, [simulatedMessage]);
      fastify.log.info(
        `[Admin] Simulated message on channel ${id} from ${from}`,
      );

      return {
        ok: true,
        messageId: simulatedMessage.id,
        channelId: id,
      };
    } catch (err) {
      fastify.log.error(
        err,
        `[Admin] Failed to simulate message on channel ${id}`,
      );
      return reply.code(500).send({
        error:
          err instanceof Error ? err.message : "Failed to simulate message",
      });
    }
  });
}
