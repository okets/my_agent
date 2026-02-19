import {
  findAgentDir,
  resolveAuth,
  isHatched,
  loadConfig,
  toDisplayStatus,
  CalendarScheduler,
  createCalDAVClient,
  loadCalendarConfig,
  loadCalendarCredentials,
  NotificationService,
} from "@my-agent/core";
import { createEventHandler } from "./scheduler/event-handler.js";
import { createBaileysPlugin } from "@my-agent/channel-whatsapp";
import { createServer } from "./server.js";
import {
  ConversationManager,
  AbbreviationQueue,
} from "./conversations/index.js";
import {
  ChannelManager,
  MockChannelPlugin,
  ChannelMessageHandler,
} from "./channels/index.js";
import { TaskManager, TaskLogStorage } from "./tasks/index.js";
import { connectionRegistry, sessionRegistry } from "./ws/chat-handler.js";

// Clear CLAUDECODE env var so the Agent SDK can spawn claude subprocesses.
// When the dashboard is started from within a Claude Code session (e.g. during dev),
// this var would otherwise block nested claude processes.
delete process.env.CLAUDECODE;

async function main() {
  // Find agent directory
  const agentDir = findAgentDir();

  // Check if agent is hatched
  const hatched = isHatched(agentDir);

  // Try to resolve auth (warn but don't crash if not configured)
  if (hatched) {
    try {
      resolveAuth(agentDir);
      console.log("Authentication configured.");
    } catch (err) {
      console.warn(
        "Warning: Authentication not configured. Use the hatching wizard to set up auth.",
      );
      console.warn("Error:", err instanceof Error ? err.message : String(err));
    }
  } else {
    console.log(
      "Agent not hatched yet. Hatching wizard will be available in the web UI.",
    );
  }

  // Create shared ConversationManager
  const conversationManager = new ConversationManager(agentDir);

  // Initialize abbreviation queue (only if hatched and auth available)
  let abbreviationQueue: AbbreviationQueue | null = null;

  if (hatched) {
    try {
      const apiKey =
        process.env.ANTHROPIC_API_KEY ||
        process.env.CLAUDE_CODE_OAUTH_TOKEN ||
        "";

      if (apiKey) {
        abbreviationQueue = new AbbreviationQueue(conversationManager, apiKey);
        await abbreviationQueue.retryPending();
      } else {
        console.warn(
          "No API key available - abbreviation queue will not start",
        );
      }
    } catch (err) {
      console.warn("Failed to initialize abbreviation queue:", err);
    }
  }

  // Create and start server
  const port = parseInt(process.env.PORT ?? "4321", 10);
  const server = await createServer({ agentDir });
  server.isHatched = hatched;
  server.conversationManager = conversationManager;
  server.abbreviationQueue = abbreviationQueue;

  // Initialize channel system (always when hatched, even with no channels yet)
  let channelManager: ChannelManager | null = null;
  const config = loadConfig();

  if (hatched) {
    channelManager = new ChannelManager();

    // Register built-in plugin factories
    channelManager.registerPlugin("mock", (cfg) => {
      const plugin = new MockChannelPlugin();
      return plugin;
    });
    channelManager.registerPlugin("baileys", (cfg) => createBaileysPlugin(cfg));

    // Wire message handler
    const messageHandler = new ChannelMessageHandler({
      conversationManager,
      sessionRegistry,
      connectionRegistry,
      sendViaChannel: (channelId, to, message) =>
        channelManager!.send(channelId, to, message),
      getChannelConfig: (channelId) =>
        channelManager!.getChannelConfig(channelId),
      updateChannelConfig: (channelId, update) =>
        channelManager!.updateChannelConfig(channelId, update),
      agentDir,
    });

    channelManager.onMessage((channelId, messages) => {
      messageHandler.handleMessages(channelId, messages).catch((err) => {
        console.error(
          `[Channels] Error handling messages from ${channelId}:`,
          err,
        );
      });
    });

    // Wire status change → WS broadcast
    channelManager.onStatusChange((channelId, status) => {
      connectionRegistry.broadcastToAll({
        type: "channel_status_changed",
        channelId,
        status: toDisplayStatus(status),
        reconnectAttempts: status.reconnectAttempts,
      });
    });

    // Wire QR code → WS broadcast
    channelManager.onQrCode((channelId, qrDataUrl) => {
      connectionRegistry.broadcastToAll({
        type: "channel_qr_code",
        channelId,
        qrDataUrl,
      });
    });

    // Wire pairing success → WS broadcast
    channelManager.onPaired((channelId) => {
      connectionRegistry.broadcastToAll({
        type: "channel_paired",
        channelId,
      });
    });

    // Initialize any pre-configured channels
    const channelCount = Object.keys(config.channels).length;
    if (channelCount > 0) {
      await channelManager.initAll(config.channels);
      console.log(`Channel system initialized with ${channelCount} channel(s)`);
    } else {
      console.log("Channel system ready (no channels configured yet)");
    }

    server.channelManager = channelManager;
    server.channelMessageHandler = messageHandler;
  }

  // Initialize task system (only if hatched)
  let taskManager: TaskManager | null = null;
  let logStorage: TaskLogStorage | null = null;
  let notificationService: NotificationService | null = null;

  if (hatched) {
    // TaskManager needs the database from ConversationManager
    const db = conversationManager.getDb();
    taskManager = new TaskManager(db, agentDir);
    logStorage = new TaskLogStorage(agentDir);

    // Initialize notification service
    notificationService = new NotificationService();

    // Wire notification events to WebSocket broadcasts
    notificationService.on("notification", (event) => {
      const notification = event.notification;
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

    console.log("Task system initialized");
  }

  server.notificationService = notificationService;

  // Initialize calendar scheduler (only if hatched)
  let calendarScheduler: CalendarScheduler | null = null;

  if (hatched && taskManager && logStorage) {
    try {
      const calConfig = loadCalendarConfig(agentDir);
      const credentials = loadCalendarCredentials(agentDir);

      if (calConfig && credentials) {
        const caldavClient = createCalDAVClient(calConfig, credentials);

        // Create event handler that spawns task executions (M5-S2)
        const eventHandler = createEventHandler({
          conversationManager,
          taskManager,
          logStorage,
          agentDir,
        });

        calendarScheduler = new CalendarScheduler(caldavClient, {
          pollIntervalMs: 60_000, // 1 minute
          lookAheadMinutes: 5,
          onEventFired: eventHandler,
          firedEventsPath: `${agentDir}/runtime/fired-events.json`,
        });

        await calendarScheduler.start();
        console.log("Calendar scheduler started (polling every 60s)");
      } else {
        console.log("Calendar not configured - scheduler not started");
      }
    } catch (err) {
      console.warn(
        "Failed to initialize calendar scheduler:",
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  server.calendarScheduler = calendarScheduler;
  server.taskManager = taskManager;
  server.logStorage = logStorage;

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
      // Stop calendar scheduler
      if (calendarScheduler) {
        calendarScheduler.stop();
        console.log("Calendar scheduler stopped.");
      }

      // Disconnect all channels first (clears reconnect + watchdog timers)
      if (channelManager) {
        await channelManager.disconnectAll();
      }

      // Drain abbreviation queue
      if (abbreviationQueue) {
        await abbreviationQueue.drain();
      }

      // Then close server
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
