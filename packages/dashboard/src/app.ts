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
import { existsSync, mkdirSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { AppEventMap } from "./app-events.js";
import { writeFrontmatter } from "./metadata/frontmatter.js";
import { ensureDecisionsFile } from "./spaces/decisions.js";

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
  CapabilityRegistry,
  scanCapabilities,
  resolveEnvPath,
  FileWatcher,
} from "@my-agent/core";
import type { ListSpacesFilter } from "@my-agent/core";
import type { HealthChangedEvent } from "@my-agent/core";
import { createBaileysPlugin } from "@my-agent/channel-whatsapp";
import type { BaileysPlugin } from "@my-agent/channel-whatsapp";
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
  addMcpServerFactory,
  setConnectionRegistry,
  setRunningTasksChecker,
} from "./agent/session-manager.js";
import { createSpaceToolsServer } from "./mcp/space-tools-server.js";
import { createSkillServer } from "./mcp/skill-server.js";
import { ConnectionRegistry } from "./ws/connection-registry.js";
import { AppChatService } from "./chat/chat-service.js";
import { AppAuthService } from "./auth/auth-service.js";
import { AppDebugService } from "./debug/app-debug-service.js";
import { migrateWorkPatternsToAutomations } from "./migrations/work-patterns-to-automations.js";
import { createDebriefAutomationAdapter } from "./mcp/debrief-automation-adapter.js";
import type { Automation } from "@my-agent/core";
import type { ConversationDatabase } from "./conversations/db.js";
import type { Conversation } from "./conversations/types.js";
import {
  AutomationManager,
  AutomationJobService,
  AutomationExecutor,
  AutomationProcessor,
  AutomationScheduler,
  AutomationSyncService,
  WatchTriggerService,
} from "./automations/index.js";
import { createAutomationServer } from "./mcp/automation-server.js";
import { VisualActionService } from "./visual/visual-action-service.js";
import { detectDesktopEnvironment } from "./desktop/desktop-capability-detector.js";
import { X11Backend } from "./desktop/x11-backend.js";
import { createDesktopServer } from "./mcp/desktop-server.js";
import { createDesktopActionServer } from "./mcp/desktop-action-server.js";
import {
  createDesktopRateLimiter,
  createDesktopAuditLogger,
} from "./hooks/desktop-hooks.js";
import type { DesktopEnvironment, DesktopBackend } from "@my-agent/core";
import { PlaywrightScreenshotBridge } from "./playwright/playwright-screenshot-bridge.js";
// Desktop action tools registered via desktop-action-server.ts (direct MCP, like Playwright)

// ─── Service Namespaces ──────────────────────────────────────────────────────
// Thin wrappers that delegate reads and emit App events on mutations.
// These are the ONLY way external code should mutate state.

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
    // Remove screenshot refs for this conversation (S3.5)
    this.app.visualActionService?.removeRefs(`conv/${id}`);
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
  set onConversationInactive(cb: ((oldConvId: string) => void) | undefined) {
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
    private agentDir: string,
  ) {}

  list(filter?: ListSpacesFilter) {
    return this.db.listSpaces(filter);
  }

  findByName(name: string) {
    return this.db.getSpace(name);
  }

  create(input: {
    name: string;
    tags?: string[];
    path?: string;
    runtime?: string;
    entry?: string;
    description?: string;
  }): string {
    const spacesDir = join(this.agentDir, "spaces");
    if (!existsSync(spacesDir)) {
      mkdirSync(spacesDir, { recursive: true });
    }
    const spaceDir = join(spacesDir, input.name);
    if (existsSync(spaceDir)) {
      throw new Error(`Space "${input.name}" already exists`);
    }
    mkdirSync(spaceDir, { recursive: true });
    const frontmatter: Record<string, unknown> = {
      name: input.name,
      created: new Date().toISOString(),
    };
    if (input.tags?.length) frontmatter.tags = input.tags;
    if (input.path) frontmatter.path = input.path;
    if (input.runtime) frontmatter.runtime = input.runtime;
    if (input.entry) frontmatter.entry = input.entry;
    writeFrontmatter(
      join(spaceDir, "SPACE.md"),
      frontmatter,
      input.description ?? "",
    );
    ensureDecisionsFile(spaceDir);
    return spaceDir;
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

  async fire(id: string, context?: Record<string, unknown>): Promise<void> {
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
    if (!automation)
      throw new Error(`Automation ${job.automationId} not found`);
    await this.processor.resume(automation, job, userInput);
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

  // Channels
  transportManager: TransportManager | null = null;
  channelMessageHandler: ChannelMessageHandler | null = null;

  // Calendar
  calendarScheduler: CalendarScheduler | null = null;

  // Notifications
  notificationService: NotificationService | null = null;

  // Work loop

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
  watchTriggerService: WatchTriggerService | null = null;

  // Health
  healthMonitor: HealthMonitor | null = null;

  // Visual actions (screenshots)
  readonly visualActionService: VisualActionService;

  // Capabilities (M9-S1)
  capabilityRegistry: CapabilityRegistry | null = null;

  // Desktop control (M8-S2)
  desktopEnv: DesktopEnvironment | null = null;
  desktopBackend: DesktopBackend | null = null;
  desktopRateLimiter: ReturnType<typeof createDesktopRateLimiter> | null = null;
  desktopAuditLogger: ReturnType<typeof createDesktopAuditLogger> | null = null;
  playwrightBridge: PlaywrightScreenshotBridge | null = null;

  private constructor(agentDir: string, isHatched: boolean) {
    super();
    this.agentDir = agentDir;
    this.isHatched = isHatched;
    this.sessionRegistry = new SessionRegistry(5);
    this.visualActionService = new VisualActionService(agentDir);
  }

  /**
   * Create a fully initialized App instance.
   * Preserves the exact initialization order from the original index.ts:main().
   */
  static async create(options: AppOptions): Promise<App> {
    const { agentDir, connectionRegistry } = options;
    const hatched = isHatched(agentDir);
    const app = new App(agentDir, hatched);

    // Shared map for collision suppression between conversation + automation watchdogs (M9-S3.1)
    const recentAutomationAlerts = new Map<string, number>();

    // ── Wire connection registry for model broadcasts (M9-S3) ──
    if (connectionRegistry) {
      setConnectionRegistry(connectionRegistry);
    }

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

    // ── Capability Registry (M9-S1) ──
    // Scan before SystemPromptBuilder so capabilities are available in the prompt.
    if (hatched) {
      const capabilitiesDir = join(agentDir, "capabilities");
      const envPath = resolveEnvPath(agentDir);
      const registry = new CapabilityRegistry();
      app.capabilityRegistry = registry;

      try {
        const { mkdirSync } = await import("node:fs");
        mkdirSync(capabilitiesDir, { recursive: true });
        const caps = await scanCapabilities(capabilitiesDir, envPath);
        registry.load(caps);
        console.log(
          `[Capabilities] Discovered ${caps.length} capabilities: ${caps.map((c) => `${c.name} [${c.status}]`).join(", ") || "none"}`,
        );

        // Non-blocking: test all available capabilities on startup (D4)
        registry
          .testAll()
          .then(() => {
            const tested = registry
              .list()
              .filter((c) => c.health !== "untested");
            if (tested.length > 0) {
              console.log(
                `[Capabilities] Startup tests complete: ${tested.map((c) => `${c.name} [${c.health}${c.lastTestLatencyMs != null ? `, ${(c.lastTestLatencyMs / 1000).toFixed(1)}s` : ""}${c.degradedReason ? `: ${c.degradedReason}` : ""}]`).join(", ")}`,
              );
              app.emit("capability:changed", registry.list());
              getPromptBuilder()?.invalidateCache();
            }
          })
          .catch((err) => {
            console.warn(
              "[Capabilities] Startup test failed:",
              err instanceof Error ? err.message : String(err),
            );
          });
      } catch (err) {
        console.warn(
          "[Capabilities] Scan failed:",
          err instanceof Error ? err.message : String(err),
        );
      }

      // Register MCP capabilities (interface: mcp with .mcp.json)
      for (const cap of registry.list()) {
        if (
          cap.interface === "mcp" &&
          cap.mcpConfig &&
          cap.status === "available"
        ) {
          try {
            // MCP config from .mcp.json follows SDK's McpServerConfig shape
            addMcpServer(
              cap.name,
              cap.mcpConfig as Parameters<typeof addMcpServer>[1],
            );
            console.log(`[Capabilities] Registered MCP server: ${cap.name}`);
          } catch (err) {
            console.warn(
              `[Capabilities] Failed to register MCP server ${cap.name}:`,
              err instanceof Error ? err.message : String(err),
            );
          }
        }
      }

      // File watcher for capability changes
      const capWatcher = new FileWatcher({
        watchDir: capabilitiesDir,
        includePattern: "**/CAPABILITY.md",
        debounceMs: 5000,
        usePolling: true,
        pollInterval: 5000,
      });

      const handleCapabilityChange = async () => {
        try {
          const caps = await scanCapabilities(capabilitiesDir, envPath);
          registry.load(caps);
          app.emit("capability:changed", caps);
          getPromptBuilder()?.invalidateCache();
          console.log(`[Capabilities] Re-scanned: ${caps.length} capabilities`);

          // Non-blocking: test newly available capabilities (D3)
          registry
            .testAll()
            .then(() => {
              const tested = registry
                .list()
                .filter((c) => c.health !== "untested");
              if (tested.length > 0) {
                app.emit("capability:changed", registry.list());
                getPromptBuilder()?.invalidateCache();
              }
            })
            .catch(() => {
              /* logged inside testAll */
            });
        } catch (err) {
          console.warn(
            "[Capabilities] Re-scan failed:",
            err instanceof Error ? err.message : String(err),
          );
        }
      };

      capWatcher.on("file:changed", handleCapabilityChange);
      capWatcher.on("file:deleted", handleCapabilityChange);
      capWatcher.start();
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
        getCapabilities: () => app.capabilityRegistry?.list() ?? [],
      });
    }

    // ── ConversationManager ──
    app.conversationManager = new ConversationManager(agentDir);

    // Wire screenshot ref scanning — when a turn contains screenshot URLs, add refs (S3.5)
    const screenshotUrlPattern =
      /\/api\/assets\/screenshots\/(ss-[a-f0-9-]+)\.png/g;
    app.conversationManager.onTurnAppended = (conversationId, turn) => {
      if (!turn.content) return;
      const ref = `conv/${conversationId}`;
      const batch: Array<{ id: string; ref: string }> = [];
      for (const match of turn.content.matchAll(screenshotUrlPattern)) {
        batch.push({ id: match[1], ref });
      }
      if (batch.length > 0) {
        app.visualActionService.addRefs(batch);
      }
    };

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
      app.transportManager.registerPlugin("baileys", (cfg) => {
        const plugin = createBaileysPlugin({ ...cfg, agentDir });
        wireAudioCallbacks(plugin, app);
        return plugin;
      });

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
            sendAudioViaTransport: async (transportId, to, text) => {
              // Get the plugin and check if it supports voice replies
              const plugins = app.transportManager!.getPlugins();
              const plugin = plugins.find((p) => p.id === transportId);
              if (
                !plugin ||
                !("onSendVoiceReply" in plugin) ||
                !("sendAudio" in plugin)
              ) {
                return false;
              }
              const bp = plugin as BaileysPlugin;
              if (!bp.onSendVoiceReply) return false;
              const audioBuffer = await bp.onSendVoiceReply(text, to);
              if (!audioBuffer) return false;
              await bp.sendAudio(to, audioBuffer);
              return true;
            },
            agentDir,
            app,
            get postResponseHooks() {
              return app.postResponseHooks;
            },
          },
          config.channels,
        );

        app.transportManager.onMessage((transportId, messages) => {
          app
            .channelMessageHandler!.handleMessages(transportId, messages)
            .catch((err) => {
              console.error(
                `[Transports] Error handling messages from ${transportId}:`,
                err,
              );
            });
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

    // ── Notifications + Post-response hooks ──
    if (hatched) {
      app.notificationService = new NotificationService();

      // Notification events → App events
      app.notificationService.on("notification", (event) => {
        app.emit("notification:created", event.notification);
      });

      // Post-response hooks
      app.postResponseHooks = new PostResponseHooks({
        log: (msg) => console.log(msg),
        logError: (err, msg) => console.error(msg, err),
        getAutomationHints: () =>
          app.conversationManager.getConversationDb().getAutomationHints(),
        fireAutomation: async (id, context) =>
          app.automations?.fire(id, context),
        getRecentJobsForAutomation: (id, withinMs) =>
          app.conversationManager
            .getConversationDb()
            .getRecentJobCount(id, withinMs),
        visualAugmentation: {
          visualService: app.visualActionService,
          conversationManager: app.conversationManager,
          connectionRegistry: connectionRegistry!,
          log: (msg) => console.log(msg),
          sendToChannel: async (content: string) => {
            // Send via the conversation initiator's outbound channel
            const ci = app.conversationInitiator;
            if (!ci) return;
            // Use the same channel send path as the conversation initiator
            await (ci as any).trySendViaChannel(content);
          },
        },
        recentAutomationAlerts,
        injectRecovery: async (conversationId, prompt, options) => {
          const convDb = app.conversationManager.getConversationDb();
          const sdkSessionId = convDb.getSdkSessionId(conversationId);
          const sm = await app.sessionRegistry.getOrCreate(
            conversationId,
            sdkSessionId,
          );
          if (sm.isStreaming()) {
            console.log(
              `[ResponseWatchdog] Session busy for ${conversationId}, skipping recovery`,
            );
            return null;
          }

          let response = "";
          for await (const event of sm.injectSystemTurn(prompt)) {
            if (event.type === "text_delta" && event.text) {
              response += event.text;
            }
          }

          if (response) {
            const conv = await app.conversationManager.get(conversationId);
            await app.conversationManager.appendTurn(conversationId, {
              type: "turn",
              role: "assistant",
              content: response,
              timestamp: new Date().toISOString(),
              turnNumber: (conv?.turnCount ?? 0) + 1,
            });
            // Broadcast to WebSocket clients
            connectionRegistry?.broadcastToConversation?.(conversationId, {
              type: "conversation_updated",
              conversationId,
              turn: {
                role: "assistant" as const,
                content: response,
                timestamp: new Date().toISOString(),
                turnNumber: (conv?.turnCount ?? 0) + 1,
              },
            });
            // Send via outbound channel if available — but not for dashboard-originated messages (#2)
            if (options?.source !== "dashboard") {
              const ci = app.conversationInitiator;
              if (ci) {
                await (ci as any).trySendViaChannel(response);
              }
            }
          }
          console.log(
            `[ResponseWatchdog] Recovery for ${conversationId}: ${response.length} chars`,
          );
          return response || null;
        },
      });
    }

    // ── Calendar scheduler ──
    if (hatched) {
      try {
        const calConfig = loadCalendarConfig(agentDir);
        const credentials = loadCalendarCredentials(agentDir);

        if (calConfig && credentials) {
          const caldavClient = createCalDAVClient(calConfig, credentials);

          const eventHandler = createEventHandler({
            conversationManager: app.conversationManager,
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
          isStreaming(conversationId) {
            const sm = app.sessionRegistry.get(conversationId);
            return sm?.isStreaming() ?? false;
          },
          async queueNotification(conversationId, prompt) {
            const sdkSessionId = convDb.getSdkSessionId(conversationId);
            const sm = await app.sessionRegistry.getOrCreate(
              conversationId,
              sdkSessionId,
            );
            sm.queueNotification(prompt);
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

    // WorkLoopScheduler removed in M7-S6 — jobs are now automation manifests
    // executed via AutomationExecutor + built-in handler registry

    // ── StatePublisher ──
    if (hatched && connectionRegistry) {
      app.statePublisher = new StatePublisher({
        connectionRegistry,
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

      // Wire VisualActionService → StatePublisher for live screenshot events
      app.visualActionService.onScreenshot((screenshot) => {
        app.statePublisher!.publishScreenshot({
          id: screenshot.id,
          filename: screenshot.filename,
          url: app.visualActionService.url(screenshot),
          timestamp: screenshot.timestamp,
          source: screenshot.source,
          description: screenshot.description,
          width: screenshot.width,
          height: screenshot.height,
          refs: screenshot.refs,
        });
      });
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

        if (process.env.OLLAMA_HOST && embeddingsConfig.plugin === "ollama") {
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
              const errMsg = err instanceof Error ? err.message : String(err);
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
      // Create debrief adapter backed by automation system (lazy — scheduler may init later)
      const debriefAdapter = createDebriefAutomationAdapter(
        () => app.automationJobService,
        agentDir,
        () => app.conversationManager?.getConversationDb() ?? null,
      );

      initMcpServers(
        app.searchService,
        notebookDir,
        app.conversationSearchService ?? undefined,
        app.conversationManager ?? undefined,
        debriefAdapter,
      );
    }

    // Skills health check (M6.8-S2)
    if (hatched) {
      await checkSkillsHealth(agentDir);
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

    // ── Migration: work-patterns → automations (M7-S6) ──
    if (hatched) {
      try {
        const migrated = migrateWorkPatternsToAutomations(agentDir);
        if (migrated > 0) {
          console.log(
            `[Migration] Created ${migrated} automation manifest(s) from work-patterns`,
          );
        }
      } catch (err) {
        console.warn(
          "[Migration] work-patterns migration failed:",
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
          // Workers must NOT use shared MCP servers — they're bound to the brain's
          // transport and crash with "Already connected" errors. The executor creates
          // fresh chart/image servers when needed. Keep undefined for resume path too.
          mcpServers: undefined,
          hooks: createHooks("task", { agentDir }),
          visualService: app.visualActionService,
        });

        app.automationProcessor = new AutomationProcessor({
          automationManager: app.automationManager,
          executor: app.automationExecutor,
          jobService: app.automationJobService,
          agentDir,
          onJobEvent: (event, job) => {
            app.statePublisher?.publishJobs();
            app.emit(event, job);
            // On job completion, scan summary for screenshot URLs and add refs (S3.5)
            if (
              (event === "job:completed" || event === "job:needs_review") &&
              job.summary
            ) {
              const jobSsPattern =
                /\/api\/assets\/screenshots\/(ss-[a-f0-9-]+)\.png/g;
              const ref = `job/${job.automationId}/${job.id}`;
              const batch: Array<{ id: string; ref: string }> = [];
              for (const match of job.summary.matchAll(jobSsPattern)) {
                batch.push({ id: match[1], ref });
              }
              if (batch.length > 0) {
                app.visualActionService.addRefs(batch);
              }
            }
          },
          get conversationInitiator() {
            return app.conversationInitiator ?? null;
          },
          onAlertDelivered: () => {
            // Set timestamp for collision suppression with conversation watchdog.
            // Uses the active conversation ID since that's what ci.alert() targets.
            const active = app.conversationManager
              .getConversationDb()
              .getActiveConversation?.(15);
            if (active?.id && recentAutomationAlerts) {
              recentAutomationAlerts.set(active.id, Date.now());
            }
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
          // Remove screenshot refs for this automation's jobs (S3.5)
          app.visualActionService.removeRefs(`job/${id}`);
          app.emit("automation:deleted", id);
        });

        await app.automationSyncService.start();

        // Prune expired run directories on startup (7-day retention)
        const pruned = app.automationJobService.pruneExpiredRunDirs();
        if (pruned > 0) {
          console.log(`[App] Pruned ${pruned} expired run directories`);
        }

        // Cleanup unreferenced screenshots on startup + daily (S3.5)
        const screenshotsCleaned = app.visualActionService.cleanup();
        if (screenshotsCleaned > 0) {
          console.log(
            `[App] Cleaned up ${screenshotsCleaned} unreferenced screenshot(s)`,
          );
        }
        setInterval(
          () => {
            const cleaned = app.visualActionService.cleanup();
            if (cleaned > 0) {
              console.log(
                `[App] Daily cleanup: removed ${cleaned} unreferenced screenshot(s)`,
              );
            }
          },
          24 * 60 * 60 * 1000,
        );

        // Scheduler — cron-based triggers
        app.automationScheduler = new AutomationScheduler({
          processor: app.automationProcessor,
          automationManager: app.automationManager,
          jobService: app.automationJobService,
          agentDir,
          pollIntervalMs: 60_000,
          get conversationInitiator() {
            return app.conversationInitiator ?? null;
          },
        });
        await app.automationScheduler.start();

        // Wire running tasks checker — populates activeWorkingAgents in system prompt
        setRunningTasksChecker((_conversationId: string) => {
          const runningJobs = app.automationJobService!.listJobs({
            status: "running",
          });
          const pendingJobs = app.automationJobService!.listJobs({
            status: "pending",
          });
          const activeJobs = [...runningJobs, ...pendingJobs];
          return activeJobs.map((job) => {
            const automation = app.automationManager!.findById(
              job.automationId,
            );
            const name = automation?.manifest.name ?? job.automationId;
            return `${name} (job ${job.id}, status: ${job.status})`;
          });
        });
        console.log("[App] Running tasks checker wired to automation jobs");

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

        // WatchTriggerService — filesystem-based triggers
        const watchTriggerService = new WatchTriggerService(
          {
            getWatchTriggers: () => convDb.getWatchTriggers(),
            fireAutomation: async (id, context) =>
              app.automations.fire(id, context),
            log: (msg) => console.log(msg),
            logError: (err, msg) => console.error(msg, err),
          },
          5000,
        );
        await watchTriggerService.start();
        app.watchTriggerService = watchTriggerService;

        // Re-sync watchers when automation manifests change
        app.automationSyncService.on("sync", () => watchTriggerService.sync());

        // Mount failure -> alert user
        watchTriggerService.on("mount_failure", async ({ path, attempts }) => {
          if (app.conversationInitiator) {
            const prompt = `A filesystem watch on "${path}" has failed after ${attempts} retry attempts. The mount may be down.\n\nYou are the conversation layer — let the user know about this infrastructure issue briefly. Don't be dramatic, just inform them so they can check if needed.`;
            const alerted = await app.conversationInitiator.alert(prompt, {
              sourceChannel: "dashboard",
            });
            if (!alerted) {
              await app.conversationInitiator.initiate({
                firstTurnPrompt: `[SYSTEM: ${prompt}]`,
              });
            }
          }
        });

        console.log(
          "Automation system initialized (sync + scheduler + watch triggers + MCP tools)",
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

    // ── Desktop control (M8-S2) ──
    {
      const desktopEnv = detectDesktopEnvironment();
      app.desktopEnv = desktopEnv;

      // Create backend
      let backend: DesktopBackend | null = null;
      if (desktopEnv.backend === "x11") {
        backend = new X11Backend({
          hasXdotool: desktopEnv.tools.xdotool,
          hasMaim: desktopEnv.tools.maim,
          hasWmctrl: desktopEnv.tools.wmctrl,
        });
        app.desktopBackend = backend;
      }

      // Safety hooks — standalone utilities for MCP tool handlers
      app.desktopRateLimiter = createDesktopRateLimiter({ maxPerMinute: 30 });
      app.desktopAuditLogger = createDesktopAuditLogger((entry) => {
        console.log(
          `[Desktop] audit: ${entry.tool} at ${entry.timestamp}${entry.instruction ? ` — ${entry.instruction.slice(0, 80)}` : ""}`,
        );
      });

      // Register desktop info/capabilities MCP server (always — returns helpful errors if no backend)
      const enabledFlagPath = join(agentDir, ".desktop-enabled");
      const desktopServer = createDesktopServer({
        backend,
        visualService: app.visualActionService,
        rateLimiter: app.desktopRateLimiter ?? undefined,
        auditLogger: app.desktopAuditLogger ?? undefined,
        isEnabled: () => existsSync(enabledFlagPath),
      });
      addMcpServer("desktop-tools", desktopServer);

      // Register direct desktop action tools (click, type, screenshot, etc.)
      // Factory pattern: each session gets a fresh MCP server instance
      // (in-process SDK servers can only bind to one transport at a time)
      if (backend) {
        const desktopBackend = backend;
        const desktopVas = app.visualActionService;
        const isDesktopEnabled = () => existsSync(enabledFlagPath);
        addMcpServerFactory("desktop-actions", () =>
          createDesktopActionServer({
            backend: desktopBackend,
            vas: desktopVas,
            isEnabled: isDesktopEnabled,
          }),
        );
        console.log(
          "[Desktop] Direct action tools registered (desktop_click, desktop_type, etc.)",
        );
      }

      // Log desktop status
      if (desktopEnv.hasDisplay) {
        console.log(
          `[Desktop] ${desktopEnv.displayServer} detected, backend: ${desktopEnv.backend ?? "none"}, ` +
            `capabilities: screenshot=${desktopEnv.capabilities.screenshot}, mouse=${desktopEnv.capabilities.mouse}, ` +
            `keyboard=${desktopEnv.capabilities.keyboard}, windowMgmt=${desktopEnv.capabilities.windowManagement}`,
        );
        if (desktopEnv.setupNeeded.length > 0) {
          console.log(
            `[Desktop] Setup needed: ${desktopEnv.setupNeeded.join("; ")}`,
          );
        }
      } else {
        console.log(
          "[Desktop] No display detected — desktop tools will return helpful errors",
        );
      }
    }

    // Register Playwright screenshot bridge MCP server (M8-S3)
    // Provides browser_screenshot_and_store tool that stores via VAS
    // The existing @playwright/mcp (stdio) stays registered for navigation/interaction
    app.playwrightBridge = new PlaywrightScreenshotBridge(
      app.visualActionService,
    );
    const playwrightScreenshotServer = app.playwrightBridge.createMcpServer();
    addMcpServer("playwright-screenshot", playwrightScreenshotServer);
    console.log("[App] Playwright screenshot bridge MCP server registered");

    // Register chart + image-fetch MCP servers (M8-S4.1: purpose-built tools)
    const { createChartServer } = await import("./mcp/chart-server.js");
    const chartServer = createChartServer({
      visualService: app.visualActionService,
    });
    addMcpServer("chart-tools", chartServer);

    const { createImageFetchServer } =
      await import("./mcp/image-fetch-server.js");
    const imageFetchServer = createImageFetchServer({
      visualService: app.visualActionService,
    });
    addMcpServer("image-fetch-tools", imageFetchServer);
    console.log("[App] Chart + image-fetch MCP servers registered");

    // Connect memory + automation services to state publisher
    if (app.statePublisher) {
      app.statePublisher.setMemoryServices(app.memoryDb, app.pluginRegistry);
      app.statePublisher.setAutomationServices(
        app.automationManager,
        app.automationJobService,
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
    app.conversations = new AppConversationService(
      app.conversationManager,
      app,
    );
    app.calendar = new AppCalendarService(app);
    app.memory = new AppMemoryService(app);
    app.spaces = new AppSpaceService(
      app.conversationManager.getConversationDb(),
      app,
      agentDir,
    );
    app.chat = new AppChatService(app);
    app.auth = new AppAuthService(app);
    app.debug = new AppDebugService(agentDir);

    // ── Legacy directory warnings ──
    const legacyDirs = ["tasks", "inbox"].filter((d) =>
      existsSync(join(agentDir, d)),
    );
    if (legacyDirs.length > 0) {
      console.warn(
        `[App] Legacy directories found: ${legacyDirs.map((d) => `${d}/`).join(", ")}. ` +
          "These are no longer used — safe to delete manually.",
      );
    }

    return app;
  }

  /**
   * Graceful shutdown — stop all services in reverse initialization order.
   */
  async shutdown(): Promise<void> {
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
    if (this.watchTriggerService) {
      await this.watchTriggerService.stop();
      console.log("WatchTriggerService stopped.");
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

// ─────────────────────────────────────────────────────────────────
// Audio callback wiring (WhatsApp voice notes ↔ capability registry)
// ─────────────────────────────────────────────────────────────────

const execFileAsync = promisify(execFile);

function wireAudioCallbacks(plugin: BaileysPlugin, app: App): void {
  // STT: transcribe incoming voice notes
  plugin.onAudioMessage = async (audioPath: string, _jid: string) => {
    const cap = app.capabilityRegistry?.get("audio-to-text");
    if (!cap || cap.status !== "available") {
      return { error: "no transcription capability configured" };
    }

    const scriptPath = join(cap.path, "scripts", "transcribe.sh");
    try {
      const { stdout } = await execFileAsync(scriptPath, [audioPath], {
        timeout: 30000,
      });
      const result = JSON.parse(stdout.trim());
      return { text: result.text || stdout.trim() };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn("[WhatsApp] Voice note transcription failed:", msg);
      return { error: `transcription failed: ${msg}` };
    }
  };

  // TTS: synthesize voice replies
  plugin.onSendVoiceReply = async (text: string, _jid: string) => {
    const cap = app.capabilityRegistry?.get("text-to-audio");
    if (!cap || cap.status !== "available") return null;

    const { prepareForSpeech } = await import("./chat/chat-service.js");
    const spokenText = prepareForSpeech(text);
    if (!spokenText.trim()) return null;

    const scriptPath = join(cap.path, "scripts", "synthesize.sh");
    const outputDir = join(tmpdir(), "wa-tts");
    mkdirSync(outputDir, { recursive: true });
    const outputFile = join(outputDir, `tts-${randomUUID()}.ogg`);

    try {
      await execFileAsync(scriptPath, [spokenText, outputFile], { timeout: 30000 });
      const buffer = readFileSync(outputFile);
      try {
        unlinkSync(outputFile);
      } catch {}
      return buffer;
    } catch (err: unknown) {
      console.warn(
        "[WhatsApp] Voice reply synthesis failed:",
        err instanceof Error ? err.message : String(err),
      );
      return null;
    }
  };
}
