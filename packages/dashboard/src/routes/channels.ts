import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { saveChannelToConfig } from "@my-agent/core";
import type { ChannelInstanceConfig } from "@my-agent/core";

export async function registerChannelRoutes(
  fastify: FastifyInstance,
): Promise<void> {
  // POST /api/channels — add a new channel
  fastify.post<{
    Body: {
      id: string;
      plugin: string;
      identity?: string;
    };
  }>("/api/channels", async (request, reply) => {
    const { id, plugin, identity } = request.body ?? {};
    if (!id || !plugin) {
      return reply
        .code(400)
        .send({ error: "Missing required fields: id, plugin" });
    }

    // Validate ID format (alphanumeric + underscores/hyphens)
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
      return reply.code(400).send({
        error:
          "Invalid channel ID. Use only letters, numbers, hyphens, and underscores.",
      });
    }

    // Check for duplicates
    const channelManager = fastify.channelManager;
    if (channelManager?.getChannelInfo(id)) {
      return reply.code(409).send({ error: `Channel "${id}" already exists` });
    }

    // Build channel config for YAML persistence
    const channelData: Record<string, unknown> = {
      plugin,
      role: "dedicated",
      processing: "immediate",
      auth_dir: join(fastify.agentDir, "auth", id),
    };
    if (identity) channelData.identity = identity;

    // Persist to config.yaml
    try {
      saveChannelToConfig(id, channelData, fastify.agentDir);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return reply
        .code(500)
        .send({ error: `Failed to save config: ${message}` });
    }

    // Build full ChannelInstanceConfig for runtime registration
    const authDir = join(fastify.agentDir, "auth", id);
    const config: ChannelInstanceConfig = {
      id,
      plugin,
      role: "dedicated",
      identity: identity ?? "",
      processing: "immediate",
      authDir,
      ownerIdentities: undefined,
      reconnect: {
        initialMs: 2000,
        maxMs: 30000,
        factor: 1.8,
        jitter: 0.25,
        maxAttempts: 50,
      },
      watchdog: { enabled: true, checkIntervalMs: 60000, timeoutMs: 1800000 },
      debounceMs: 0,
    };

    // Register at runtime if channelManager exists
    if (channelManager) {
      try {
        const info = await channelManager.addChannel(config);
        return reply.send(info);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return reply.code(500).send({ error: message });
      }
    }

    // No channel manager (agent not hatched) — config saved, will be picked up on restart
    return reply.send({
      id,
      plugin,
      role: "dedicated",
      identity: identity ?? "",
      status: "disconnected",
      statusDetail: {},
      icon: "",
      note: "Channel saved. Restart the dashboard to activate.",
    });
  });

  // GET /api/channels — list all channels with status
  fastify.get("/api/channels", async (_request, reply) => {
    const channelManager = fastify.channelManager;
    if (!channelManager) {
      return reply.send([]);
    }
    return reply.send(channelManager.getChannelInfos());
  });

  // GET /api/channels/:id/status — single channel status
  fastify.get<{ Params: { id: string } }>(
    "/api/channels/:id/status",
    async (request, reply) => {
      const channelManager = fastify.channelManager;
      if (!channelManager) {
        return reply.code(404).send({ error: "No channels configured" });
      }
      const info = channelManager.getChannelInfo(request.params.id);
      if (!info) {
        return reply.code(404).send({ error: "Channel not found" });
      }
      return reply.send(info);
    },
  );

  // GET /api/channels/:id/icon — SVG icon for channel plugin
  fastify.get<{ Params: { id: string } }>(
    "/api/channels/:id/icon",
    async (request, reply) => {
      const channelManager = fastify.channelManager;
      if (!channelManager) {
        return reply.code(404).send({ error: "No channels configured" });
      }
      const info = channelManager.getChannelInfo(request.params.id);
      if (!info) {
        return reply.code(404).send({ error: "Channel not found" });
      }
      return reply.type("image/svg+xml").send(info.icon);
    },
  );

  // POST /api/channels/:id/pair — trigger QR pairing
  // If channel is in error/logged_out state, clears auth to force fresh QR
  fastify.post<{ Params: { id: string } }>(
    "/api/channels/:id/pair",
    async (request, reply) => {
      const channelManager = fastify.channelManager;
      if (!channelManager) {
        return reply.code(404).send({ error: "No channels configured" });
      }
      const info = channelManager.getChannelInfo(request.params.id);
      if (!info) {
        return reply.code(404).send({ error: "Channel not found" });
      }
      if (info.statusDetail.connected) {
        return reply.code(409).send({ error: "Channel already connected" });
      }
      try {
        // Clear auth for fresh QR if channel is in error/logged_out state
        const needsFreshAuth =
          info.status === "error" || info.status === "logged_out";
        await channelManager.connectChannel(request.params.id, needsFreshAuth);
        return reply.send({ ok: true });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return reply.code(500).send({ error: message });
      }
    },
  );

  // POST /api/channels/:id/authorize — generate owner authorization token
  fastify.post<{ Params: { id: string } }>(
    "/api/channels/:id/authorize",
    async (request, reply) => {
      const handler = fastify.channelMessageHandler;
      if (!handler) {
        return reply.code(503).send({ error: "Channel system not ready" });
      }
      const channelManager = fastify.channelManager;
      if (!channelManager?.getChannelInfo(request.params.id)) {
        return reply.code(404).send({ error: "Channel not found" });
      }
      const token = handler.generateToken(request.params.id);
      return reply.send({ token });
    },
  );

  // POST /api/channels/:id/disconnect — disconnect a channel
  fastify.post<{ Params: { id: string } }>(
    "/api/channels/:id/disconnect",
    async (request, reply) => {
      const channelManager = fastify.channelManager;
      if (!channelManager) {
        return reply.code(404).send({ error: "No channels configured" });
      }
      const info = channelManager.getChannelInfo(request.params.id);
      if (!info) {
        return reply.code(404).send({ error: "Channel not found" });
      }
      try {
        await channelManager.disconnectChannel(request.params.id);
        return reply.send({ ok: true });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return reply.code(500).send({ error: message });
      }
    },
  );
}
