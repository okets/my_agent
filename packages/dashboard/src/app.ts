/**
 * App — Headless application core.
 *
 * Owns all services. Emits typed events on every state mutation.
 * Transport adapters (Fastify/WS, agents, tests) subscribe to events.
 *
 * Created by: M6.10-S2 (Extract App Class + Live Update Guarantee)
 * Design spec: docs/superpowers/specs/2026-03-16-headless-app-design.md
 */

import { EventEmitter } from "node:events";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { AppEventMap } from "./app-events.js";

import {
  resolveAuth,
  isHatched,
  loadConfig,
  loadPreferences,
  loadEmbeddingsConfig,
  CalendarScheduler,
  createCalDAVClient,
  loadCalendarConfig,
  loadCalendarCredentials,
  NotificationService,
  HealthMonitor,
  createHooks,
  MemoryDb,
  SyncService,
  SearchService,
  PluginRegistry,
  LocalEmbeddingsPlugin,
  OllamaEmbeddingsPlugin,
  initNotebook,
  migrateToNotebook,
  needsMigration,
  checkSkillsHealth,
  filterSkillsByTools,
  loadChannelBindings,
  SpaceSyncService,
} from "@my-agent/core";
import type { ListSpacesFilter } from "@my-agent/core";
import type { HealthChangedEvent } from "@my-agent/core";
import { createBaileysPlugin } from "@my-agent/channel-whatsapp";
import {
  ConversationManager,
  AbbreviationQueue,
  ConversationSearchDB,
  ConversationSearchService,
} from "./conversations/index.js";
import {
  TransportManager,
  MockTransportPlugin,
  ChannelMessageHandler,
} from "./channels/index.js";
import {
  TaskManager,
  TaskLogStorage,
  TaskExecutor,
  TaskProcessor,
  TaskScheduler,
  TaskSearchService,
} from "./tasks/index.js";
import { WorkLoopScheduler } from "./scheduler/work-loop-scheduler.js";
import { ConversationInitiator } from "./agent/conversation-initiator.js";
import { PostResponseHooks } from "./conversations/post-response-hooks.js";
import { SessionRegistry } from "./agent/session-registry.js";
import { StatePublisher } from "./state/state-publisher.js";
import { createEventHandler } from "./scheduler/event-handler.js";
import {
  initMcpServers,
  initPromptBuilder,
  getPromptBuilder,
  getSharedMcpServers,
  addMcpServer,
  setRunningTasksChecker,
} from "./agent/session-manager.js";
import { createTaskToolsServer } from "./mcp/task-tools-server.js";
import { createSpaceToolsServer } from "./mcp/space-tools-server.js";
import { createSkillServer } from "./mcp/skill-server.js";
import { ConnectionRegistry } from "./ws/connection-registry.js";
import { AppChatService } from "./chat/chat-service.js";
import { AppAuthService } from "./auth/auth-service.js";
import { AppDebugService } from "./debug/app-debug-service.js";
import type { Task, CreateTaskInput, Automation } from "@my-agent/core";
import type { ConversationDatabase } from "./conversations/db.js";
import type { Conversation } from "./conversations/types.js";
import {
  AutomationManager,
  AutomationJobService,
  AutomationExecutor,
  AutomationProcessor,
  AutomationScheduler,
  AutomationSyncService,
} from "./automations/index.js";
import { createAutomationServer } from "./mcp/automation-server.js";

// ─── Service Namespaces ──────────────────────────────────────────────────────
// Thin wrappers that delegate reads and emit App events on mutations.
// These are the ONLY way external code should mutate state.

type TaskUpdateChanges = Parameters<TaskManager["update"]>[1];

export class AppTaskService {
  constructor(
    private manager: TaskManager,
    private app: App,
  ) {}

  // Read-through
  list(filter?: Parameters<TaskManager["list"]>[0]) {
    return this.manager.list(filter);
  }
  findById(id: string) {
    return this.manager.findById(id);
  }
  getRunningTasksForConversation(convId: string) {
    return this.manager.getRunningTasksForConversation(convId);
  }
  getTasksForConversation(convId: string) {
    return this.manager.getTasksForConversation(convId);
  }

  // Mutations — emit events
  create(input: CreateTaskInput): Task {
    const task = this.manager.create(input);
    this.app.emit("task:created", task);
    return task;
  }

  update(id: string, changes: TaskUpdateChanges): void {
    this.manager.update(id, changes);
    const task = this.manager.findById(id);
    if (task) this.app.emit("task:updated", task);
  }

  delete(id: string): void {
    this.manager.delete(id);
    this.app.emit("task:deleted", id);
  }

  linkTaskToConversation(taskId: string, conversationId: string): void {
    this.manager.linkTaskToConversation(taskId, conversationId);
    const task = this.manager.findById(taskId);
    if (task) this.app.emit("task:updated", task);
  }
}

export class AppConversationService {
  constructor(
    private manager: ConversationManager,
    private app: App,
  ) {}

  // Read-through
  list(opts?: Parameters<ConversationManager["list"]>[0]) {
    return this.manager.list(opts);
  }
  get(id: string) {
    return this.manager.get(id);
  }
  getDb(): ReturnType<ConversationManager["getDb"]> {
    return this.manager.getDb();
  }
  getConversationDb(): ReturnType<ConversationManager["getConversationDb"]> {
    return this.manager.getConversationDb();
  }
  close() {
    return this.manager.close();
  }

  // Mutations — emit events
  async create(
    opts?: Parameters<ConversationManager["create"]>[0],
  ): Promise<Conversation> {
    const conv = await this.manager.create(opts);
    this.app.emit("conversation:created", conv);
    return conv;
  }

  async delete(id: string): Promise<void> {
    await this.manager.delete(id);
    this.app.emit("conversation:deleted", id);
  }

  async makeCurrent(id: string): Promise<void> {
    await this.manager.makeCurrent(id);
    this.app.emit("conversation:updated", id);
  }

  async unpin(id: string): Promise<void> {
    await this.manager.unpin(id);
    this.app.emit("conversation:updated", id);
  }

  // Delegate properties
  get onConversationInactive() {
    return this.manager.onConversationInactive;
  }
  set onConversationInactive(
    cb: ((oldConvId: string) => void) | undefined,
  ) {
    this.manager.onConversationInactive = cb;
  }
}

export class AppCalendarService {
  constructor(private app: App) {}

  /** Emit after any calendar mutation (create/update/delete via CalDAV client) */
  emitChanged(): void {
    this.app.emit("calendar:changed");
  }
}

export class AppMemoryService {
  constructor(private app: App) {}

  /** Emit after any memory state change (plugin activation, sync, etc.) */
  emitChanged(): void {
    this.app.emit("memory:changed");
  }
}

export class AppSpaceService {
  constructor(
    private db: ConversationDatabase,
    private app: App,
  ) {}

  list(filter?: ListSpacesFilter) {
    return this.db.listSpaces(filter);
  }

  findByName(name: string) {
    return this.db.getSpace(name);
  }
}

export class AppAutomationService {
  constructor(
    private manager: AutomationManager,
    private processor: AutomationProcessor,
    private jobService: AutomationJobService,
    private app: App,
  ) {}

  // Read-through
  list(filter?: { status?: string }) {
    return this.manager.list(filter);
  }
  findById(id: string) {
    return this.manager.findById(id);
  }
  read(id: string) {
    return this.manager.read(id);
  }
  listJobs(filter?: Parameters<AutomationJobService["listJobs"]>[0]) {
    return this.jobService.listJobs(filter);
  }
  getJob(id: string) {
    return this.jobService.getJob(id);
  }

  // Mutations — emit events
  create(input: Parameters<AutomationManager["create"]>[0]): Automation {
    const automation = this.manager.create(input);
    this.app.emit("automation:created", automation);
    return automation;
  }

  async fire(
    id: string,
    context?: Record<string, unknown>,
  ): Promise<void> {
    const automation = this.manager.findById(id);
    if (!automation) throw new Error(`Automation ${id} not found`);
    await this.processor.fire(automation, context);
  }

  async resume(jobId: string, userInput: string): Promise<void> {
    const job = this.jobService.getJob(jobId);
    if (!job) throw new Error(`Job ${jobId} not found`);
    if (job.status !== "needs_review") {
      throw new Error(`Job ${jobId} is ${job.status}, not in needs_review`);
    }
    const automation = this.manager.findById(job.automationId);
    if (!automation) throw new Error(`Automation ${job.automationId} not found`);
    this.jobService.updateJob(jobId, { status: "running" });
    await this.processor.fire(automation, {
      resumedFrom: jobId,
      userResponse: userInput,
    });
  }
}

// ─── App ─────────────────────────────────────────────────────────────────────

export interface AppOptions {
  agentDir: string;
  /**
   * Connection registry for WS broadcasts (adapter-layer dependency).
   * If omitted, StatePublisher is not created.
   */
  connectionRegistry?: ConnectionRegistry;
}

export class App extends EventEmitter {
  readonly agentDir: string;
  readonly isHatched: boolean;

  // Service namespaces (event-emitting wrappers)
  tasks!: AppTaskService;
  conversations!: AppConversationService;
  calendar!: AppCalendarService;
  memory!: AppMemoryService;
  spaces!: AppSpaceService;
  chat!: AppChatService;
  auth!: AppAuthService;
  debug!: AppDebugService;

  // Core services
  conversationManager!: ConversationManager;
  sessionRegistry!: SessionRegistry;

  // Task system
  taskManager: TaskManager | null = null;
  logStorage: TaskLogStorage | null = null;
  taskExecutor: TaskExecutor | null = null;
  taskProcessor: TaskProcessor | null = null;
  taskScheduler: TaskScheduler | null = null;
  taskSearchService: TaskSearchService | null = null;

  // Channels
  transportManager: TransportManager | null = null;
  channelMessageHandler: ChannelMessageHandler | null = null;

  // Calendar
  calendarScheduler: CalendarScheduler | null = null;

  // Notifications
  notificationService: NotificationService | null = null;

  // Work loop
  workLoopScheduler: WorkLoopScheduler | null = null;

  // Memory
  memoryDb: MemoryDb | null = null;
  syncService: SyncService | null = null;
  searchService: SearchService | null = null;
  pluginRegistry: PluginRegistry | null = null;

  // Conversations (advanced)
  conversationSearchService: ConversationSearchService | null = null;
  conversationSearchDb: ConversationSearchDB | null = null;
  abbreviationQueue: AbbreviationQueue | null = null;
  conversationInitiator: ConversationInitiator | null = null;

  // Post-processing
  postResponseHooks: PostResponseHooks | null = null;

  // State publishing
  statePublisher: StatePublisher | null = null;

  // Spaces
  spaceSyncService: SpaceSyncService | null = null;

  // Automations
  automations!: AppAutomationService;
  automationManager: AutomationManager | null = null;
  automationJobService: AutomationJobService | null = null;
  automationExecutor: AutomationExecutor | null = null;
  automationProcessor: AutomationProcessor | null = null;
  automationScheduler: AutomationScheduler | null = null;
  automationSyncService: AutomationSyncService | null = null;

  // Health
  healthMonitor: HealthMonitor | null = null;

  private constructor(agentDir: string, isHatched: boolean) {
    super();
    this.agentDir = agentDir;
    this.isHatched = isHatched;
    this.sessionRegistry = new SessionRegistry(5);
  }

  /**
   * Create a fully initialized App instance.
   * Preserves the exact initialization order from the original index.ts:main().
   */
  static async create(options: AppOptions): Promise<App> {
    const { agentDir, connectionRegistry } = options;
    const hatched = isHatched(agentDir);
    const app = new App(agentDir, hatched);

    // ── Auth ──
    if (hatched) {
      try {
        resolveAuth(agentDir);
        console.log("Authentication configured.");
      } catch (err) {
        console.warn(
          "Warning: Authentication not configured. Use the hatching wizard to set up auth.",
        );
        console.warn(
          "Error:",
          err instanceof Error ? err.message : String(err),
        );
      }
    } else {
      console.log(
        "Agent not hatched yet. Hatching wizard will be available in the web UI.",
      );
    }

    // ── SystemPromptBuilder (M6.6-S1) ──
    // Must happen before any SessionManager so all sessions share the same cache.
    if (hatched) {
      const brainDir = join(agentDir, "brain");
      initPromptBuilder(brainDir, agentDir, {
        getNotebookLastUpdated: () => {
          try {
            return app.memoryDb?.getStatus().lastSync ?? null;
          } catch {
            return null;
          }
        },
      });
    }

    // ── ConversationManager ──
    app.conversationManager = new ConversationManager(agentDir);

    // Startup cleanup: delete any empty conversations left from previous runs
    {
      const allConvs = await app.conversationManager.list();
      const emptyConvs = allConvs.filter((c) => c.turnCount === 0);
      for (const conv of emptyConvs) {
        await app.conversationManager.delete(conv.id);
      }
      if (emptyConvs.length > 0) {
        console.log(
          `Cleaned up ${emptyConvs.length} empty conversation(s) on startup`,
        );
      }
    }

    // ── AbbreviationQueue ──
    if (hatched) {
      try {
        const apiKey =
          process.env.ANTHROPIC_API_KEY ||
          process.env.CLAUDE_CODE_OAUTH_TOKEN ||
          "";

        if (apiKey) {
          app.abbreviationQueue = new AbbreviationQueue(
            app.conversationManager,
            apiKey,
            agentDir,
          );
          await app.abbreviationQueue.retryPending();

          const queue = app.abbreviationQueue;
          app.conversationManager.onConversationInactive = (oldConvId) => {
            queue.enqueue(oldConvId);
          };
        } else {
          console.warn(
            "No API key available - abbreviation queue will not start",
          );
        }
      } catch (err) {
        console.warn("Failed to initialize abbreviation queue:", err);
      }
    }

    // ── Transport system ──
    const config = loadConfig();

    if (hatched) {
      app.transportManager = new TransportManager();

      app.transportManager.registerPlugin("mock", () => {
        return new MockTransportPlugin();
      });
      app.transportManager.registerPlugin("baileys", (cfg) =>
        createBaileysPlugin(cfg),
      );

      // ChannelMessageHandler needs connectionRegistry + sessionRegistry.
      // sessionRegistry is App-owned. connectionRegistry comes from adapter.
      if (connectionRegistry) {
        app.channelMessageHandler = new ChannelMessageHandler(
          {
            conversationManager: app.conversationManager,
            sessionRegistry: app.sessionRegistry,
            connectionRegistry,
            sendViaTransport: (transportId, to, message) =>
              app.transportManager!.send(transportId, to, message),
            sendTypingIndicator: (transportId, to) =>
              app.transportManager!.sendTypingIndicator(transportId, to),
            agentDir,
            app,
            get postResponseHooks() {
              return app.postResponseHooks;
            },
          },
          config.channels,
        );

        app.transportManager.onMessage((transportId, messages) => {
          app.channelMessageHandler!.handleMessages(transportId, messages).catch(
            (err) => {
              console.error(
                `[Transports] Error handling messages from ${transportId}:`,
                err,
              );
            },
          );
        });
      }

      // Transport events → App events (coupling point #1 — broken)
      app.transportManager.onStatusChange((transportId, status) => {
        app.emit("channel:status_changed", transportId, status);
      });
      app.transportManager.onQrCode((transportId, qrDataUrl) => {
        app.emit("channel:qr_code", transportId, qrDataUrl);
      });
      app.transportManager.onPairingCode((transportId, pairingCode) => {
        app.emit("channel:pairing_code", transportId, pairingCode);
      });
      app.transportManager.onPaired((transportId) => {
        app.emit("channel:paired", transportId);
      });

      // Initialize pre-configured transports
      const transportCount = Object.keys(config.transports).length;
      if (transportCount > 0) {
        await app.transportManager.initAll(config.transports);
        console.log(
          `Transport system initialized with ${transportCount} transport(s)`,
        );
      } else {
        console.log("Transport system ready (no transports configured yet)");
      }
    }

    // ── Task system ──
    if (hatched) {
      const db = app.conversationManager.getDb();
      app.taskManager = new TaskManager(db, agentDir);
      app.logStorage = new TaskLogStorage(agentDir);

      app.taskExecutor = new TaskExecutor({
        taskManager: app.taskManager,
        logStorage: app.logStorage,
        agentDir,
        db: app.conversationManager.getConversationDb(),
        get mcpServers() {
          return getSharedMcpServers() ?? undefined;
        },
        hooks: createHooks("task", { agentDir }),
      });

      app.notificationService = new NotificationService();

      // TaskProcessor — onTaskMutated is lazy (statePublisher set later)
      app.taskProcessor = new TaskProcessor({
        taskManager: app.taskManager,
        executor: app.taskExecutor,
        conversationManager: app.conversationManager,
        connectionRegistry: connectionRegistry ?? new ConnectionRegistry(),
        transportManager: app.transportManager,
        notificationService: app.notificationService,
        taskUpdater: (id, changes) => app.tasks?.update(id, changes),
        get conversationInitiator() {
          return app.conversationInitiator ?? null;
        },
      });

      app.taskScheduler = new TaskScheduler({
        taskManager: app.taskManager,
        processor: app.taskProcessor,
        pollIntervalMs: 30_000,
      });
      app.taskScheduler.start();

      // Notification events → App events (coupling point #2 — broken)
      app.notificationService.on("notification", (event) => {
        app.emit("notification:created", event.notification);
      });

      console.log("Task system initialized with processor and scheduler");

      // Post-response hooks
      app.postResponseHooks = new PostResponseHooks({
        taskManager: app.taskManager,
        log: (msg) => console.log(msg),
        logError: (err, msg) => console.error(msg, err),
      });
    }

    // ── Calendar scheduler ──
    if (hatched && app.taskManager && app.logStorage) {
      try {
        const calConfig = loadCalendarConfig(agentDir);
        const credentials = loadCalendarCredentials(agentDir);

        if (calConfig && credentials) {
          const caldavClient = createCalDAVClient(calConfig, credentials);

          const eventHandler = createEventHandler({
            conversationManager: app.conversationManager,
            taskManager: app.taskManager,
            logStorage: app.logStorage,
            agentDir,
            db: app.conversationManager.getConversationDb(),
          });

          app.calendarScheduler = new CalendarScheduler(caldavClient, {
            pollIntervalMs: 60_000,
            lookAheadMinutes: 5,
            onEventFired: eventHandler,
            firedEventsPath: `${agentDir}/runtime/fired-events.json`,
          });

          await app.calendarScheduler.start();
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

    // ── ConversationInitiator (M6.9-S3) ──
    if (hatched && app.transportManager) {
      const convDb = app.conversationManager.getConversationDb();
      app.conversationInitiator = new ConversationInitiator({
        conversationManager: app.conversationManager,
        sessionFactory: {
          async *injectSystemTurn(conversationId, prompt) {
            const sdkSessionId = convDb.getSdkSessionId(conversationId);
            const sm = await app.sessionRegistry.getOrCreate(
              conversationId,
              sdkSessionId,
            );
            yield* sm.injectSystemTurn(prompt);
          },
          async *streamNewConversation(conversationId, prompt) {
            const sm = await app.sessionRegistry.getOrCreate(conversationId);
            yield* sm.streamMessage(prompt || "");
          },
        },
        channelManager: {
          async send(transportId, to, message) {
            await app.transportManager!.send(transportId, to, message);
          },
          getTransportConfig(id) {
            const config = app.transportManager!.getTransportConfig(id);
            if (!config) return undefined;
            // ownerJid moved from transport config to channel binding after
            // the TransportManager refactor — resolve it from the binding
            if (!config.ownerJid) {
              const bindings = loadChannelBindings(agentDir);
              const binding = bindings.find((b) => b.transport === id);
              if (binding?.ownerJid) {
                return { ...config, ownerJid: binding.ownerJid };
              }
            }
            return config;
          },
          getTransportInfos() {
            return app.transportManager!.getTransportInfos();
          },
        },
        getOutboundChannel: () => loadPreferences(agentDir).outboundChannel,
      });
      console.log("[ConversationInitiator] Initialized");
    }

    // ── WorkLoopScheduler (M6.6-S2) ──
    if (hatched) {
      try {
        const db = app.conversationManager.getDb();
        app.workLoopScheduler = new WorkLoopScheduler({
          db,
          agentDir,
          pollIntervalMs: 60_000,
          notificationService: app.notificationService ?? undefined,
          conversationInitiator: app.conversationInitiator ?? undefined,
          taskManager: app.taskManager ?? undefined,
        });
        await app.workLoopScheduler.start();
        console.log("Work loop scheduler started");
      } catch (err) {
        console.warn(
          "Failed to initialize work loop scheduler:",
          err instanceof Error ? err.message : String(err),
        );
      }
    }

    // Wire fact extraction → work loop logging (M6.6-S3)
    if (app.abbreviationQueue && app.workLoopScheduler) {
      const scheduler = app.workLoopScheduler;
      app.abbreviationQueue.onExtractionComplete = (result) => {
        scheduler.logExternalRun(
          "fact-extraction",
          result.durationMs,
          `Extracted ${result.newFactCount} new facts from conversation ${result.conversationId}`,
          result.error,
        );
      };
    }

    // ── StatePublisher ──
    if (hatched && connectionRegistry) {
      app.statePublisher = new StatePublisher({
        connectionRegistry,
        taskManager: app.taskManager,
        conversationManager: app.conversationManager,
        spacesDb: app.conversationManager.getConversationDb(),
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
      app.statePublisher.subscribeToApp(app);
      console.log("StatePublisher initialized");
    }

    // ── Memory system (M6-S2) ──
    if (hatched) {
      try {
        await initNotebook(agentDir);

        if (await needsMigration(agentDir)) {
          const migrated = await migrateToNotebook(agentDir);
          if (migrated.length > 0) {
            console.log(`Migrated ${migrated.length} file(s) to notebook/`);
          }
        }

        app.pluginRegistry = new PluginRegistry();
        app.pluginRegistry.register(new LocalEmbeddingsPlugin(agentDir));

        const embeddingsConfig = loadEmbeddingsConfig(agentDir);

        const ollamaPlugin = new OllamaEmbeddingsPlugin({
          host:
            embeddingsConfig.plugin === "ollama"
              ? (embeddingsConfig.host ?? "http://localhost:11434")
              : "http://localhost:11434",
          model: embeddingsConfig.model ?? "nomic-embed-text",
          onDegraded: (health) => {
            if (app.pluginRegistry) {
              app.pluginRegistry.setDegraded(health);
              app.emit("memory:changed");
            }
          },
        });
        app.pluginRegistry.register(ollamaPlugin);

        if (
          process.env.OLLAMA_HOST &&
          embeddingsConfig.plugin === "ollama"
        ) {
          console.log(
            `Using embeddings config: plugin=${embeddingsConfig.plugin}, host=${embeddingsConfig.host}`,
          );
        }

        app.memoryDb = new MemoryDb(agentDir);

        const notebookDir = join(agentDir, "notebook");
        app.syncService = new SyncService({
          notebookDir,
          db: app.memoryDb,
          getPlugin: () => app.pluginRegistry?.getActive() ?? null,
          excludePatterns: ["knowledge/extracted/**"],
        });

        app.searchService = new SearchService({
          db: app.memoryDb,
          getPlugin: () => app.pluginRegistry?.getActive() ?? null,
          getDegradedHealth: () =>
            app.pluginRegistry?.getDegradedHealth() ?? null,
        });

        // Restore embeddings plugin
        const configPluginId =
          embeddingsConfig.plugin === "ollama"
            ? "embeddings-ollama"
            : "embeddings-local";

        const indexMeta = app.memoryDb.getIndexMeta();
        const savedPluginId = indexMeta.embeddingsPlugin ?? null;
        const restorePluginId =
          savedPluginId && savedPluginId !== configPluginId
            ? configPluginId
            : (savedPluginId ?? configPluginId);

        if (savedPluginId && savedPluginId !== configPluginId) {
          console.log(
            `[Embeddings] Config changed: ${savedPluginId} → ${configPluginId}, switching plugin`,
          );
        }

        if (restorePluginId) {
          const savedPlugin = app.pluginRegistry.get(restorePluginId);
          if (savedPlugin) {
            try {
              await savedPlugin.initialize();
              const isReady = await savedPlugin.isReady();
              if (isReady) {
                await app.pluginRegistry.setActive(restorePluginId);
                const dims = savedPlugin.getDimensions();
                if (dims) {
                  const { modelChanged } = app.memoryDb.resetVectorIndex(
                    restorePluginId,
                    savedPlugin.modelName,
                    dims,
                  );
                  if (modelChanged) {
                    console.log(
                      `[Embeddings] Model changed — memory vector index reset (${dims} dims)`,
                    );
                  }
                }
                console.log(
                  `Restored embeddings plugin: ${restorePluginId} (${savedPlugin.modelName})`,
                );
              } else {
                app.pluginRegistry.setIntended(restorePluginId);
                const health = await savedPlugin.healthCheck();
                app.pluginRegistry.setDegraded(
                  health.healthy
                    ? {
                        healthy: false,
                        message: "Plugin not ready after initialization",
                        since: new Date(),
                      }
                    : { ...health, since: health.since ?? new Date() },
                );
                if (indexMeta.dimensions) {
                  app.memoryDb.initVectorTable(indexMeta.dimensions);
                }
                console.warn(
                  `Embeddings plugin ${restorePluginId} not ready — entering degraded mode`,
                );
              }
            } catch (err) {
              const errMsg =
                err instanceof Error ? err.message : String(err);
              app.pluginRegistry.setIntended(restorePluginId);
              app.pluginRegistry.setDegraded({
                healthy: false,
                message: errMsg,
                resolution:
                  errMsg.toLowerCase().includes("connect") ||
                  errMsg.toLowerCase().includes("fetch failed")
                    ? "Start the Ollama Docker container or check that the host is reachable."
                    : "Check the embeddings plugin configuration.",
                since: new Date(),
              });
              if (indexMeta.dimensions) {
                app.memoryDb.initVectorTable(indexMeta.dimensions);
              }
              console.warn(
                `Failed to restore embeddings plugin ${restorePluginId} — entering degraded mode: ${errMsg}`,
              );
            }
          } else {
            console.warn(
              `Embeddings plugin ${restorePluginId} not found — continuing without embeddings`,
            );
          }
        }

        // Initial sync
        const syncResult = await app.syncService.fullSync();
        console.log(
          `Memory system initialized (${syncResult.added} files indexed, ${syncResult.errors.length} errors)`,
        );

        // Start file watcher
        app.syncService.startWatching();

        // SyncService events → App events + cache invalidation
        app.syncService.on("sync", () => {
          app.emit("memory:changed");
          getPromptBuilder()?.invalidateCache();
          app.workLoopScheduler?.reloadPatterns().catch(() => {});
        });

        console.log("Memory file watcher started");
      } catch (err) {
        console.warn(
          "Failed to initialize memory system:",
          err instanceof Error ? err.message : String(err),
        );
      }
    }

    // ── Conversation Search (M6.7-S4) ──
    if (app.conversationManager) {
      try {
        const rawDb = app.conversationManager.getDb();
        app.conversationSearchDb = new ConversationSearchDB(rawDb);

        const activePlugin = app.pluginRegistry?.getActive() ?? null;
        if (activePlugin) {
          const dims = activePlugin.getDimensions();
          if (dims) {
            app.conversationSearchDb.initVectorTable(dims);
            console.log(
              `[ConversationSearch] Vector table initialized (${dims} dims)`,
            );
          }
        }

        app.conversationSearchService = new ConversationSearchService({
          searchDb: app.conversationSearchDb,
          getPlugin: () => app.pluginRegistry?.getActive() ?? null,
        });

        console.log("[ConversationSearch] Service initialized");
      } catch (err) {
        console.warn(
          "[ConversationSearch] Failed to initialize:",
          err instanceof Error ? err.message : String(err),
        );
      }
    }

    // ── MCP servers ──
    if (app.searchService) {
      const notebookDir = join(agentDir, "notebook");
      initMcpServers(
        app.searchService,
        notebookDir,
        app.conversationSearchService ?? undefined,
        app.conversationManager ?? undefined,
        app.workLoopScheduler ?? undefined,
      );
    }

    // Skills health check (M6.8-S2)
    if (hatched) {
      await checkSkillsHealth(agentDir);
    }

    // ── TaskSearch (M6.9-S5) ──
    if (app.taskManager) {
      try {
        const rawDb = app.conversationManager.getDb();
        app.taskSearchService = new TaskSearchService({
          db: rawDb,
          getPlugin: () => app.pluginRegistry?.getActive() ?? null,
        });

        const activePlugin = app.pluginRegistry?.getActive() ?? null;
        if (activePlugin) {
          const dims = activePlugin.getDimensions();
          if (dims) {
            app.taskSearchService.initVectorTable(dims);
            console.log(
              `[TaskSearch] Vector table initialized (${dims} dims)`,
            );
          }
        }

        const searchSvc = app.taskSearchService;
        app.taskManager.onTaskCreated = (task) => {
          searchSvc
            .indexTask({
              id: task.id,
              title: task.title,
              instructions: task.instructions,
            })
            .catch(() => {});
        };

        console.log("[TaskSearch] Service initialized");
      } catch (err) {
        console.warn(
          "[TaskSearch] Failed to initialize:",
          err instanceof Error ? err.message : String(err),
        );
      }
    }

    // ── Task-tools MCP server ──
    if (app.taskManager && app.taskProcessor) {
      const taskToolsServer = createTaskToolsServer({
        taskManager: app.taskManager,
        taskProcessor: app.taskProcessor,
        agentDir,
        taskSearchService: app.taskSearchService ?? undefined,
      });
      addMcpServer("task-tools", taskToolsServer);

      setRunningTasksChecker((conversationId: string) => {
        const running =
          app.taskManager!.getRunningTasksForConversation(conversationId);
        return running.map((t) => `"${t.title}" (${t.id})`);
      });
    }

    // ── SpaceSyncService + space-tools MCP (M7-S1) ──
    if (hatched) {
      try {
        const spacesDir = join(agentDir, "spaces");
        mkdirSync(spacesDir, { recursive: true });
        const db = app.conversationManager.getConversationDb();

        app.spaceSyncService = new SpaceSyncService({
          spacesDir,
          onSpaceChanged: (payload) => {
            db.upsertSpace({
              name: payload.name,
              path: payload.path,
              tags: payload.tags,
              runtime: payload.runtime,
              entry: payload.entry,
              io: payload.io,
              maintenance: payload.maintenance,
              description: payload.description,
              indexedAt: payload.indexedAt,
            });
            app.emit("space:updated", payload);
          },
          onSpaceDeleted: (name) => {
            db.deleteSpace(name);
            app.emit("space:deleted", name);
          },
        });

        await app.spaceSyncService.fullSync();
        app.spaceSyncService.start();
        console.log("SpaceSyncService initialized");

        const spaceToolsServer = createSpaceToolsServer({ agentDir, db });
        addMcpServer("space-tools", spaceToolsServer);
      } catch (err) {
        console.warn(
          "Failed to initialize spaces:",
          err instanceof Error ? err.message : String(err),
        );
      }
    }

    // ── Automation system (M7-S3) ──
    if (hatched) {
      try {
        const automationsDir = join(agentDir, "automations");
        const convDb = app.conversationManager.getConversationDb();

        app.automationManager = new AutomationManager(automationsDir, convDb);
        app.automationJobService = new AutomationJobService(
          automationsDir,
          convDb,
        );

        app.automationExecutor = new AutomationExecutor({
          automationManager: app.automationManager,
          jobService: app.automationJobService,
          agentDir,
          db: convDb,
          get mcpServers() {
            return getSharedMcpServers() ?? undefined;
          },
          hooks: createHooks("task", { agentDir }),
        });

        app.automationProcessor = new AutomationProcessor({
          automationManager: app.automationManager,
          executor: app.automationExecutor,
          jobService: app.automationJobService,
          onJobMutated: () => {
            // StatePublisher will subscribe via app events
          },
          get conversationInitiator() {
            return app.conversationInitiator ?? null;
          },
        });

        // Sync service — watch automation manifests
        app.automationSyncService = new AutomationSyncService({
          automationsDir,
          manager: app.automationManager,
        });

        // Wire sync events to prompt cache invalidation + App events
        app.automationSyncService.on("automation:updated", (automation) => {
          getPromptBuilder()?.invalidateCache();
          app.emit("automation:updated", automation);
        });
        app.automationSyncService.on("automation:removed", (id) => {
          getPromptBuilder()?.invalidateCache();
          app.emit("automation:deleted", id);
        });

        await app.automationSyncService.start();

        // Scheduler — cron-based triggers
        app.automationScheduler = new AutomationScheduler({
          processor: app.automationProcessor,
          automationManager: app.automationManager,
          jobService: app.automationJobService,
          agentDir,
          pollIntervalMs: 60_000,
        });
        await app.automationScheduler.start();

        // Service namespace
        app.automations = new AppAutomationService(
          app.automationManager,
          app.automationProcessor,
          app.automationJobService,
          app,
        );

        // Register automation-tools MCP server
        const automationToolsServer = createAutomationServer({
          automationManager: app.automationManager,
          processor: app.automationProcessor,
          jobService: app.automationJobService,
        });
        addMcpServer("automation-tools", automationToolsServer);

        console.log(
          "Automation system initialized (sync + scheduler + MCP tools)",
        );
      } catch (err) {
        console.warn(
          "Failed to initialize automation system:",
          err instanceof Error ? err.message : String(err),
        );
      }
    }

    // ── Skill MCP server (M6.8-S5) ──
    {
      const skillServer = createSkillServer({
        agentDir,
        onSkillCreated: async () => {
          const conversationTools = [
            "Read",
            "Glob",
            "Grep",
            "WebSearch",
            "WebFetch",
            "Skill",
          ];
          await filterSkillsByTools(agentDir, conversationTools);
        },
        onSkillChanged: () => {
          app.emit("skills:changed");
        },
      });
      addMcpServer("skills", skillServer);
    }

    // Connect memory services to state publisher
    if (app.statePublisher) {
      app.statePublisher.setMemoryServices(
        app.memoryDb,
        app.pluginRegistry,
      );
    }

    // ── HealthMonitor ──
    if (app.pluginRegistry && app.memoryDb && app.syncService) {
      app.healthMonitor = new HealthMonitor({
        defaultIntervalMs: 60_000,
        healthConfig: config.health,
      });

      for (const plugin of app.pluginRegistry.list()) {
        app.healthMonitor.register(plugin);
      }

      if (app.transportManager) {
        for (const plugin of app.transportManager.getPlugins()) {
          app.healthMonitor.register(plugin);
        }
      }

      app.healthMonitor.on(
        "health_changed",
        async (event: HealthChangedEvent) => {
          if (event.pluginType === "embeddings") {
            if (
              event.current.healthy &&
              event.previous &&
              !event.previous.healthy
            ) {
              // Recovery: degraded → healthy
              const intendedId = app.pluginRegistry!.getIntendedPluginId();
              if (intendedId && intendedId === event.pluginId) {
                const plugin = app.pluginRegistry!.get(intendedId);
                if (plugin) {
                  try {
                    await plugin.initialize();
                    const isReady = await plugin.isReady();
                    if (isReady) {
                      await app.pluginRegistry!.setActive(intendedId);
                      const dims = plugin.getDimensions();
                      if (dims && app.memoryDb) {
                        app.memoryDb.initVectorTable(dims);
                      }
                      if (dims && app.conversationSearchDb) {
                        app.conversationSearchDb.initVectorTable(dims);
                      }
                      console.log(
                        `[HealthMonitor] Embeddings recovered: ${intendedId} (${plugin.modelName})`,
                      );
                      app.syncService!.fullSync().catch(() => {});
                    }
                  } catch {
                    // Recovery attempt failed — will retry next poll
                  }
                }
              }
            } else if (
              !event.current.healthy &&
              (!event.previous || event.previous.healthy)
            ) {
              // Detection: healthy → degraded
              const active = app.pluginRegistry!.getActive();
              if (active && active.id === event.pluginId) {
                app.pluginRegistry!.setIntended(active.id);
                app.pluginRegistry!.setDegraded({
                  ...event.current,
                  since: event.current.since ?? new Date(),
                });
                console.warn(
                  `[HealthMonitor] Embeddings plugin ${active.id} failed health check — entering degraded mode`,
                );
              }
            }
            app.emit("memory:changed");
          }

          if (event.pluginType === "channel") {
            if (!event.current.healthy) {
              console.warn(
                `[HealthMonitor] Channel ${event.pluginId} health check failed: ${event.current.message ?? "unknown"}`,
              );
            }
          }
        },
      );

      await app.healthMonitor.start();
      console.log("HealthMonitor started");
    }

    // ── Service namespaces (event-emitting wrappers) ──
    if (app.taskManager) {
      app.tasks = new AppTaskService(app.taskManager, app);
    }
    app.conversations = new AppConversationService(app.conversationManager, app);
    app.calendar = new AppCalendarService(app);
    app.memory = new AppMemoryService(app);
    app.spaces = new AppSpaceService(
      app.conversationManager.getConversationDb(),
      app,
    );
    app.chat = new AppChatService(app);
    app.auth = new AppAuthService(app);
    app.debug = new AppDebugService(agentDir);

    return app;
  }

  /**
   * Graceful shutdown — stop all services in reverse initialization order.
   */
  async shutdown(): Promise<void> {
    if (this.workLoopScheduler) {
      await this.workLoopScheduler.stop();
      console.log("Work loop scheduler stopped.");
    }
    if (this.taskScheduler) {
      this.taskScheduler.stop();
      console.log("Task scheduler stopped.");
    }
    if (this.calendarScheduler) {
      this.calendarScheduler.stop();
      console.log("Calendar scheduler stopped.");
    }
    if (this.transportManager) {
      await this.transportManager.disconnectAll();
    }
    if (this.abbreviationQueue) {
      await this.abbreviationQueue.drain();
    }
    if (this.healthMonitor) {
      this.healthMonitor.stop();
      console.log("HealthMonitor stopped.");
    }
    if (this.spaceSyncService) {
      await this.spaceSyncService.stop();
      console.log("SpaceSyncService stopped.");
    }
    if (this.automationScheduler) {
      await this.automationScheduler.stop();
      console.log("AutomationScheduler stopped.");
    }
    if (this.automationSyncService) {
      await this.automationSyncService.stop();
      console.log("AutomationSyncService stopped.");
    }
    if (this.syncService) {
      this.syncService.stopWatching();
      console.log("Memory file watcher stopped.");
    }
    if (this.memoryDb) {
      this.memoryDb.close();
      console.log("Memory database closed.");
    }
    this.conversationManager.close();
  }

  // ─── Typed EventEmitter overrides ──────────────────────────────────────────

  override emit<K extends keyof AppEventMap>(
    event: K,
    ...args: AppEventMap[K]
  ): boolean {
    return super.emit(event as string, ...args);
  }

  override on<K extends keyof AppEventMap>(
    event: K,
    listener: (...args: AppEventMap[K]) => void,
  ): this {
    return super.on(event as string, listener as (...args: unknown[]) => void);
  }
}
