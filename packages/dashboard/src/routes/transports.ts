import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import {
  saveTransportToConfig,
  removeTransportFromConfig,
} from "@my-agent/core";
import type { TransportConfig } from "@my-agent/core";

export async function registerTransportRoutes(
  fastify: FastifyInstance,
): Promise<void> {
  // POST /api/channels — add a new channel
  fastify.post<{
    Body: {
      id: string;
      plugin: string;
      identity?: string;
      role?: "dedicated" | "personal";
    };
  }>("/api/transports", async (request, reply) => {
    const { id, plugin, identity, role } = request.body ?? {};
    if (!id || !plugin) {
      return reply
        .code(400)
        .send({ error: "Missing required fields: id, plugin" });
    }

    // Validate ID format (alphanumeric + underscores/hyphens)
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
      return reply.code(400).send({
        error:
          "Invalid transport ID. Use only letters, numbers, hyphens, and underscores.",
      });
    }

    // Validate role if provided
    const transportRole = role === "personal" ? "personal" : "dedicated";

    // Check for duplicates
    const transportManager = fastify.transportManager;
    if (transportManager?.getTransportInfo(id)) {
      return reply
        .code(409)
        .send({ error: `Transport "${id}" already exists` });
    }

    // Build channel config for YAML persistence
    const transportData: Record<string, unknown> = {
      plugin,
      role: transportRole,
      processing: "immediate",
      auth_dir: join(fastify.agentDir, "auth", id),
    };
    if (identity) transportData.identity = identity;

    // Persist to config.yaml
    try {
      saveTransportToConfig(id, transportData, fastify.agentDir);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return reply
        .code(500)
        .send({ error: `Failed to save config: ${message}` });
    }

    // Build full TransportConfig for runtime registration
    const authDir = join(fastify.agentDir, "auth", id);
    const config: TransportConfig = {
      id,
      plugin,
      role: transportRole,
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
      debounceMs: 0,
    };

    // Register at runtime if transportManager exists
    // Skip auto-connect — let user choose pairing method (QR or phone number)
    if (transportManager) {
      try {
        const info = await transportManager.addTransport(config, {
          skipConnect: true,
        });
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
      role: transportRole,
      identity: identity ?? "",
      status: "disconnected",
      statusDetail: {},
      icon: "",
      note: "Transport saved. Restart the dashboard to activate.",
    });
  });

  // GET /api/channels — list all channels with status
  fastify.get("/api/transports", async (_request, reply) => {
    const transportManager = fastify.transportManager;
    if (!transportManager) {
      return reply.send([]);
    }
    return reply.send(transportManager.getTransportInfos());
  });

  // GET /api/channels/:id/status — single channel status
  fastify.get<{ Params: { id: string } }>(
    "/api/transports/:id/status",
    async (request, reply) => {
      const transportManager = fastify.transportManager;
      if (!transportManager) {
        return reply.code(404).send({ error: "No transports configured" });
      }
      const info = transportManager.getTransportInfo(request.params.id);
      if (!info) {
        return reply.code(404).send({ error: "Transport not found" });
      }
      return reply.send(info);
    },
  );

  // GET /api/channels/:id/icon — SVG icon for channel plugin
  fastify.get<{ Params: { id: string } }>(
    "/api/transports/:id/icon",
    async (request, reply) => {
      const transportManager = fastify.transportManager;
      if (!transportManager) {
        return reply.code(404).send({ error: "No transports configured" });
      }
      const info = transportManager.getTransportInfo(request.params.id);
      if (!info) {
        return reply.code(404).send({ error: "Transport not found" });
      }
      return reply.type("image/svg+xml").send(info.icon);
    },
  );

  // POST /api/channels/:id/pair — trigger QR or phone number pairing
  // If channel is in error/logged_out state, clears auth to force fresh pairing
  fastify.post<{ Params: { id: string }; Body: { phoneNumber?: string } }>(
    "/api/transports/:id/pair",
    async (request, reply) => {
      const transportManager = fastify.transportManager;
      if (!transportManager) {
        return reply.code(404).send({ error: "No transports configured" });
      }
      const info = transportManager.getTransportInfo(request.params.id);
      if (!info) {
        return reply.code(404).send({ error: "Transport not found" });
      }
      if (info.statusDetail.connected) {
        return reply.code(409).send({ error: "Transport already connected" });
      }
      try {
        // Clear auth for fresh pairing if channel is in error/logged_out state
        const needsFreshAuth =
          info.status === "error" || info.status === "logged_out";

        // If phone number provided, suppress QR codes BEFORE connecting
        const phoneNumber = request.body?.phoneNumber;
        if (phoneNumber) {
          transportManager.suppressQrForTransport(request.params.id);
        }

        await transportManager.connectTransport(
          request.params.id,
          needsFreshAuth,
        );

        // If phone number provided, fire-and-forget pairing code request.
        // The code will arrive via WebSocket `transport_pairing_code` event.
        if (phoneNumber) {
          // Don't await — let it run async, code delivered via WS
          transportManager.requestPairingCode(request.params.id, phoneNumber);
        }
        // Without phone number, QR code arrives via WebSocket `transport_qr_code`

        return reply.send({ ok: true });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return reply.code(500).send({ error: message });
      }
    },
  );

  // POST /api/transports/:id/authorize — generate owner authorization token
  fastify.post<{ Params: { id: string } }>(
    "/api/transports/:id/authorize",
    async (request, reply) => {
      const handler = fastify.channelMessageHandler;
      if (!handler) {
        return reply.code(503).send({ error: "Transport system not ready" });
      }
      const transportManager = fastify.transportManager;
      if (!transportManager?.getTransportInfo(request.params.id)) {
        return reply.code(404).send({ error: "Transport not found" });
      }
      const token = handler.generateToken(request.params.id);
      return reply.send({ token });
    },
  );

  // POST /api/transports/:id/reauthorize — start re-authorization flow
  fastify.post<{ Params: { id: string } }>(
    "/api/transports/:id/reauthorize",
    async (request, reply) => {
      const handler = fastify.channelMessageHandler;
      if (!handler) {
        return reply.code(503).send({ error: "Transport system not ready" });
      }
      const transportManager = fastify.transportManager;
      if (!transportManager?.getTransportInfo(request.params.id)) {
        return reply.code(404).send({ error: "Transport not found" });
      }

      // Start re-auth: suspend channel, generate new token
      try {
        const token = await handler.startReauthorization(request.params.id);
        return reply.send({ token });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return reply.code(400).send({ error: message });
      }
    },
  );

  // POST /api/transports/:id/remove-owner — clear owner identity
  fastify.post<{ Params: { id: string } }>(
    "/api/transports/:id/remove-owner",
    async (request, reply) => {
      const transportManager = fastify.transportManager;
      if (!transportManager) {
        return reply.code(404).send({ error: "No transports configured" });
      }
      const info = transportManager.getTransportInfo(request.params.id);
      if (!info) {
        return reply.code(404).send({ error: "Transport not found" });
      }

      // Clear owner from runtime config
      transportManager.updateTransportConfig(request.params.id, {
        ownerIdentities: undefined,
        ownerJid: undefined,
      });

      // Persist to config.yaml
      try {
        saveTransportToConfig(
          request.params.id,
          { owner_identities: null, owner_jid: null },
          fastify.agentDir,
        );
      } catch (err) {
        console.error("[channels] Failed to persist owner removal:", err);
      }

      // Broadcast to all connected clients
      fastify.connectionRegistry.broadcastToAll({
        type: "transport_owner_removed",
        transportId: request.params.id,
      });

      return reply.send({ ok: true });
    },
  );

  // POST /api/channels/:id/disconnect — disconnect a channel
  fastify.post<{ Params: { id: string } }>(
    "/api/transports/:id/disconnect",
    async (request, reply) => {
      const transportManager = fastify.transportManager;
      if (!transportManager) {
        return reply.code(404).send({ error: "No transports configured" });
      }
      const info = transportManager.getTransportInfo(request.params.id);
      if (!info) {
        return reply.code(404).send({ error: "Transport not found" });
      }
      try {
        await transportManager.disconnectTransport(request.params.id);
        return reply.send({ ok: true });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return reply.code(500).send({ error: message });
      }
    },
  );

  // DELETE /api/channels/:id — remove a channel entirely
  fastify.delete<{ Params: { id: string } }>(
    "/api/transports/:id",
    async (request, reply) => {
      const transportManager = fastify.transportManager;
      if (!transportManager) {
        return reply.code(404).send({ error: "No transports configured" });
      }
      const info = transportManager.getTransportInfo(request.params.id);
      if (!info) {
        return reply.code(404).send({ error: "Transport not found" });
      }
      try {
        // Remove from runtime
        await transportManager.removeTransport(request.params.id);
        // Remove from config.yaml
        removeTransportFromConfig(request.params.id, fastify.agentDir);
        return reply.send({ ok: true });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return reply.code(500).send({ error: message });
      }
    },
  );
}
