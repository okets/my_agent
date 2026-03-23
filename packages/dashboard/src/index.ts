/**
 * Dashboard entry point.
 *
 * Creates the headless App (owns all services), then wires the Fastify adapter
 * (HTTP/WS transport) on top. Business logic lives in App; this file is pure
 * adapter wiring.
 *
 * M6.10-S2: Extracted from original 1029-line index.ts.
 */

import { findAgentDir, toDisplayStatus } from "@my-agent/core";
import { App } from "./app.js";
import { createServer } from "./server.js";
import { ConnectionRegistry } from "./ws/connection-registry.js";

// Clear CLAUDECODE env var so the Agent SDK can spawn claude subprocesses.
delete process.env.CLAUDECODE;

process.on("unhandledRejection", (reason) => {
  const msg =
    reason instanceof Error ? reason.message : String(reason ?? "unknown");
  console.error(`[Server] Unhandled rejection: ${msg}`);
  if (reason instanceof Error && reason.stack) {
    console.error(`[Server] Stack: ${reason.stack}`);
  }
});

async function main() {
  const agentDir = findAgentDir();

  // Create connection registry (adapter-layer, shared between App and Fastify)
  const connectionRegistry = new ConnectionRegistry();

  // Create headless App (owns all services, emits events on mutations)
  const app = await App.create({ agentDir, connectionRegistry });

  // Create Fastify adapter (HTTP + WebSocket transport)
  const port = parseInt(process.env.PORT ?? "4321", 10);
  const server = await createServer({ agentDir, connectionRegistry });

  // Wire App → Fastify
  server.app = app;
  server.isHatched = app.isHatched;
  server.conversationManager = app.conversationManager;
  server.abbreviationQueue = app.abbreviationQueue;
  server.transportManager = app.transportManager;
  server.channelMessageHandler = app.channelMessageHandler;
  server.calendarScheduler = app.calendarScheduler;
  server.notificationService = app.notificationService;
  server.statePublisher = app.statePublisher;
  server.memoryDb = app.memoryDb;
  server.syncService = app.syncService;
  server.searchService = app.searchService;
  server.pluginRegistry = app.pluginRegistry;
  server.conversationSearchService = app.conversationSearchService;
  server.workLoopScheduler = app.workLoopScheduler;
  server.conversationInitiator = app.conversationInitiator;
  server.postResponseHooks = app.postResponseHooks;

  // ── Adapter: Channel events → WS broadcasts ──
  app.on("channel:status_changed", (transportId, status) => {
    connectionRegistry.broadcastToAll({
      type: "transport_status_changed",
      transportId,
      status: toDisplayStatus(status),
      reconnectAttempts: status.reconnectAttempts,
    });
  });
  app.on("channel:qr_code", (transportId, qrDataUrl) => {
    connectionRegistry.broadcastToAll({
      type: "transport_qr_code",
      transportId,
      qrDataUrl,
    });
  });
  app.on("channel:pairing_code", (transportId, pairingCode) => {
    connectionRegistry.broadcastToAll({
      type: "transport_pairing_code",
      transportId,
      pairingCode,
    });
  });
  app.on("channel:paired", (transportId) => {
    connectionRegistry.broadcastToAll({
      type: "transport_paired",
      transportId,
    });
  });

  // ── Adapter: Notification events → WS broadcasts ──
  app.on("notification:created", (notification) => {
    connectionRegistry.broadcastToAll({
      type: "notification",
      notification: {
        id: notification.id,
        type: notification.type,
        taskId: notification.taskId,
        created: notification.created.toISOString(),
        status: notification.status,
        ...(notification.type === "notify" && {
          message: notification.message,
          importance: notification.importance,
        }),
        ...(notification.type === "request_input" && {
          question: notification.question,
          options: notification.options,
          response: notification.response,
          respondedAt: notification.respondedAt?.toISOString(),
        }),
        ...(notification.type === "escalate" && {
          problem: notification.problem,
          severity: notification.severity,
        }),
      },
    });
  });

  // ── Start server ──
  try {
    await server.listen({ port, host: "0.0.0.0" });
    console.log(`\nDashboard running at http://localhost:${port}`);
    console.log("Press Ctrl+C to stop\n");
  } catch (err) {
    console.error("Failed to start server:", err);
    process.exit(1);
  }

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    console.log(`\n${signal} received, shutting down gracefully...`);
    try {
      await app.shutdown();
      await server.close();
      console.log("Server closed.");
      process.exit(0);
    } catch (err) {
      console.error("Error during shutdown:", err);
      process.exit(1);
    }
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
