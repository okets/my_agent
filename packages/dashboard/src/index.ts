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
  HealthMonitor,
  // Memory system (M6-S2)
  MemoryDb,
  SyncService,
  SearchService,
  PluginRegistry,
  LocalEmbeddingsPlugin,
  OllamaEmbeddingsPlugin,
  initNotebook,
  migrateToNotebook,
  needsMigration,
} from "@my-agent/core";
import type { HealthChangedEvent } from "@my-agent/core";
import { join } from "node:path";
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
import {
  TaskManager,
  TaskLogStorage,
  TaskExecutor,
  TaskProcessor,
  TaskScheduler,
} from "./tasks/index.js";
import { connectionRegistry, sessionRegistry } from "./ws/chat-handler.js";
import { StatePublisher } from "./state/state-publisher.js";

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
  let taskExecutor: TaskExecutor | null = null;
  let taskProcessor: TaskProcessor | null = null;
  let taskScheduler: TaskScheduler | null = null;
  let notificationService: NotificationService | null = null;

  if (hatched) {
    // TaskManager needs the database from ConversationManager
    const db = conversationManager.getDb();
    taskManager = new TaskManager(db, agentDir);
    logStorage = new TaskLogStorage(agentDir);

    // Initialize task executor
    taskExecutor = new TaskExecutor({
      taskManager,
      logStorage,
      agentDir,
    });

    // Initialize notification service (before task processor so it can be passed in)
    notificationService = new NotificationService();

    // Initialize task processor (handles immediate task execution)
    // onTaskMutated is a lazy callback — server.statePublisher is set after this block
    taskProcessor = new TaskProcessor({
      taskManager,
      executor: taskExecutor,
      conversationManager,
      connectionRegistry,
      channelManager,
      notificationService,
      onTaskMutated: () => server.statePublisher?.publishTasks(),
    });

    // Initialize task scheduler (polls for due scheduled tasks)
    taskScheduler = new TaskScheduler({
      taskManager,
      processor: taskProcessor,
      pollIntervalMs: 30_000, // 30 seconds
    });

    // Start the task scheduler
    taskScheduler.start();

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

    console.log("Task system initialized with processor and scheduler");
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
  server.taskProcessor = taskProcessor;
  server.taskScheduler = taskScheduler;

  // Initialize StatePublisher — live state sync to all connected dashboard clients
  if (hatched) {
    const statePublisher = new StatePublisher({
      connectionRegistry,
      taskManager,
      conversationManager,
      getCalendarClient: () => {
        try {
          const calConfig = loadCalendarConfig(agentDir);
          const credentials = loadCalendarCredentials(agentDir);
          if (!calConfig || !credentials) return null;
          return createCalDAVClient(calConfig, credentials);
        } catch {
          return null;
        }
      },
    });
    server.statePublisher = statePublisher;
    console.log("StatePublisher initialized");
  } else {
    server.statePublisher = null;
  }

  // Initialize memory system (M6-S2)
  let memoryDb: MemoryDb | null = null;
  let syncService: SyncService | null = null;
  let searchService: SearchService | null = null;
  let pluginRegistry: PluginRegistry | null = null;

  if (hatched) {
    try {
      // Initialize notebook folder structure
      await initNotebook(agentDir);

      // Migrate any existing files if needed
      if (await needsMigration(agentDir)) {
        const migrated = await migrateToNotebook(agentDir);
        if (migrated.length > 0) {
          console.log(`Migrated ${migrated.length} file(s) to notebook/`);
        }
      }

      // Create plugin registry and register available plugins
      pluginRegistry = new PluginRegistry();
      pluginRegistry.register(new LocalEmbeddingsPlugin(agentDir));
      pluginRegistry.register(
        new OllamaEmbeddingsPlugin({
          host: process.env.OLLAMA_HOST ?? "http://localhost:11434",
          model: "nomic-embed-text",
        }),
      );

      // Create memory database
      memoryDb = new MemoryDb(agentDir);

      // Create sync service (watches notebook files)
      const notebookDir = join(agentDir, "notebook");
      syncService = new SyncService({
        notebookDir,
        db: memoryDb,
        getPlugin: () => pluginRegistry?.getActive() ?? null,
      });

      // Create search service (hybrid FTS5 + vector)
      searchService = new SearchService({
        db: memoryDb,
        getPlugin: () => pluginRegistry?.getActive() ?? null,
        getDegradedHealth: () => pluginRegistry?.getDegradedHealth() ?? null,
      });

      // Try to restore previously active embeddings plugin
      const indexMeta = memoryDb.getIndexMeta();
      if (indexMeta.embeddingsPlugin) {
        const savedPluginId = indexMeta.embeddingsPlugin;
        const savedPlugin = pluginRegistry.get(savedPluginId);
        if (savedPlugin) {
          try {
            await savedPlugin.initialize();
            const isReady = await savedPlugin.isReady();
            if (isReady) {
              await pluginRegistry.setActive(savedPluginId);
              // Re-initialize vector table with saved dimensions
              const dims = savedPlugin.getDimensions();
              if (dims) {
                memoryDb.initVectorTable(dims);
              }
              console.log(
                `Restored embeddings plugin: ${savedPluginId} (${savedPlugin.modelName})`,
              );
            } else {
              // Plugin initialized but not ready — enter degraded mode
              pluginRegistry.setIntended(savedPluginId);
              const health = await savedPlugin.healthCheck();
              pluginRegistry.setDegraded(
                health.healthy
                  ? {
                      healthy: false,
                      message: "Plugin not ready after initialization",
                      since: new Date(),
                    }
                  : { ...health, since: health.since ?? new Date() },
              );
              // Preserve existing vector table from saved dimensions
              if (indexMeta.dimensions) {
                memoryDb.initVectorTable(indexMeta.dimensions);
              }
              console.warn(
                `Embeddings plugin ${savedPluginId} not ready — entering degraded mode`,
              );
            }
          } catch (err) {
            // Plugin failed to initialize — enter degraded mode
            const errMsg = err instanceof Error ? err.message : String(err);
            pluginRegistry.setIntended(savedPluginId);
            pluginRegistry.setDegraded({
              healthy: false,
              message: errMsg,
              resolution:
                errMsg.toLowerCase().includes("connect") ||
                errMsg.toLowerCase().includes("fetch failed")
                  ? "Start the Ollama Docker container or check that the host is reachable."
                  : "Check the embeddings plugin configuration.",
              since: new Date(),
            });
            // Preserve existing vector table from saved dimensions
            if (indexMeta.dimensions) {
              memoryDb.initVectorTable(indexMeta.dimensions);
            }
            console.warn(
              `Failed to restore embeddings plugin ${savedPluginId} — entering degraded mode: ${errMsg}`,
            );
          }
        } else {
          console.warn(
            `Saved embeddings plugin ${savedPluginId} not found — continuing without embeddings`,
          );
        }
      }

      // Run initial sync on startup
      const syncResult = await syncService.fullSync();
      console.log(
        `Memory system initialized (${syncResult.added} files indexed, ${syncResult.errors.length} errors)`,
      );

      // Start file watcher
      syncService.startWatching();

      // Publish memory state to dashboard on every sync event
      syncService.on("sync", () => {
        server.statePublisher?.publishMemory();
      });

      console.log("Memory file watcher started");
    } catch (err) {
      console.warn(
        "Failed to initialize memory system:",
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  server.memoryDb = memoryDb;
  server.syncService = syncService;
  server.searchService = searchService;
  server.pluginRegistry = pluginRegistry;

  // Connect memory services to state publisher for live updates
  if (server.statePublisher) {
    server.statePublisher.setMemoryServices(memoryDb, pluginRegistry);
  }

  // ── HealthMonitor — unified plugin health polling ──
  let healthMonitor: HealthMonitor | null = null;
  if (pluginRegistry && memoryDb && syncService) {
    healthMonitor = new HealthMonitor({
      defaultIntervalMs: 60_000,
      healthConfig: config.health,
    });

    // Register embeddings plugins
    for (const plugin of pluginRegistry.list()) {
      healthMonitor.register(plugin);
    }

    // Register channel plugins
    if (channelManager) {
      for (const plugin of channelManager.getPlugins()) {
        healthMonitor.register(plugin);
      }
    }

    // Wire health change events
    healthMonitor.on(
      "health_changed",
      async (event: HealthChangedEvent) => {
        if (event.pluginType === "embeddings") {
          // ── Embeddings: detection + recovery ──
          if (event.current.healthy && event.previous && !event.previous.healthy) {
            // Recovery: degraded → healthy (only when the intended plugin itself reports healthy)
            const intendedId = pluginRegistry!.getIntendedPluginId();
            if (intendedId && intendedId === event.pluginId) {
              const plugin = pluginRegistry!.get(intendedId);
              if (plugin) {
                try {
                  await plugin.initialize();
                  const isReady = await plugin.isReady();
                  if (isReady) {
                    await pluginRegistry!.setActive(intendedId);
                    const dims = plugin.getDimensions();
                    if (dims && memoryDb) {
                      memoryDb.initVectorTable(dims);
                    }
                    console.log(
                      `[HealthMonitor] Embeddings recovered: ${intendedId} (${plugin.modelName})`,
                    );
                    syncService!.fullSync().catch(() => {});
                  }
                } catch {
                  // Recovery attempt failed — will retry next poll
                }
              }
            }
          } else if (!event.current.healthy && (!event.previous || event.previous.healthy)) {
            // Detection: healthy → degraded (only when the active plugin itself fails)
            const active = pluginRegistry!.getActive();
            if (active && active.id === event.pluginId) {
              pluginRegistry!.setIntended(active.id);
              pluginRegistry!.setDegraded({
                ...event.current,
                since: event.current.since ?? new Date(),
              });
              console.warn(
                `[HealthMonitor] Embeddings plugin ${active.id} failed health check — entering degraded mode`,
              );
            }
          }
          server.statePublisher?.publishMemory();
        }

        if (event.pluginType === "channel") {
          // ── Channels: observation-only logging ──
          if (!event.current.healthy) {
            console.warn(
              `[HealthMonitor] Channel ${event.pluginId} health check failed: ${event.current.message ?? "unknown"}`,
            );
          }
        }
      },
    );

    await healthMonitor.start();
    console.log("HealthMonitor started");
  }

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
      // Stop task scheduler
      if (taskScheduler) {
        taskScheduler.stop();
        console.log("Task scheduler stopped.");
      }

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

      // Stop health monitor
      if (healthMonitor) {
        healthMonitor.stop();
        console.log("HealthMonitor stopped.");
      }

      // Stop memory file watcher and close database
      if (syncService) {
        syncService.stopWatching();
        console.log("Memory file watcher stopped.");
      }
      if (memoryDb) {
        memoryDb.close();
        console.log("Memory database closed.");
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
