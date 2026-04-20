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
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
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
  loadChannelBindings,
  SpaceSyncService,
  CapabilityRegistry,
  scanCapabilities,
  resolveEnvPath,
  FileWatcher,
  CfrEmitter,
  CapabilityWatcher,
  RecoveryOrchestrator,
  OrphanWatchdog,
  reverify,
  loadModels,
  AckDelivery,
  createResilienceCopy,
  CapabilityInvoker,
} from "@my-agent/core";
import type { OrphanSweepReport, ResilienceCopy, AutomationNotifierLike } from "@my-agent/core";
import { RawMediaStore } from "./media/raw-media-store.js";
import type { ListSpacesFilter } from "@my-agent/core";
import type { HealthChangedEvent } from "@my-agent/core";
import { createBaileysPlugin } from "@my-agent/channel-whatsapp";
import type { BaileysPlugin } from "@my-agent/channel-whatsapp";
import {
  ConversationManager,
  AbbreviationQueue,
  ConversationSearchDB,
  ConversationSearchService,
  IdleTimerManager,
} from "./conversations/index.js";
import { AttachmentService } from "./conversations/attachments.js";
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
  setPendingBriefingProvider,
  setConversationTodoProvider,
  setVasStoreCallback,
  setCfrDetectorDeps,
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
import { HeartbeatService } from "./automations/heartbeat-service.js";
import { readTodoFile } from "./automations/todo-file.js";
import { PersistentNotificationQueue } from "./notifications/persistent-queue.js";
import { VisualActionService } from "./visual/visual-action-service.js";
import { PlaywrightScreenshotBridge } from "./playwright/playwright-screenshot-bridge.js";

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

// ── Orphan rescue injector (M9.6-S5) ────────────────────────────────────────

/**
 * Deps shape for `makeOrphanRescueInjector`. Structural so the function is
 * testable without importing App or ConversationManager concretely.
 */
export interface OrphanRescueDeps {
  conversationManager: {
    get(id: string): Promise<{ turnCount: number } | null | undefined>;
    getLastUserTurn(
      id: string,
    ): Promise<{ channel: string | undefined; timestamp: string } | null>;
  };
  chat: {
    sendSystemMessage(
      convId: string,
      prompt: string,
      turnNumber: number,
    ): AsyncIterable<{ type: string; text?: string }>;
  };
  conversationInitiator: {
    forwardToChannel(
      content: string,
      channelOverride?: string,
    ): Promise<{ delivered: boolean; reason?: string }>;
  } | null | undefined;
}

/**
 * Factory for the orphan-watchdog `systemMessageInjector`. Extracted so the
 * routing behaviour (reply on original channel, not preferred outbound) can be
 * tested directly against the real implementation instead of an inline copy.
 *
 * Mediator-framed: drains `sendSystemMessage`, then forwards the response on
 * the SAME CHANNEL the orphaned user turn arrived on (C1 routing fix).
 */
export function makeOrphanRescueInjector(
  deps: OrphanRescueDeps,
): (convId: string, prompt: string) => Promise<void> {
  return async (convId, prompt) => {
    const conv = await deps.conversationManager.get(convId);
    const nextTurn = (conv?.turnCount ?? 0) + 1;
    let response = "";
    for await (const event of deps.chat.sendSystemMessage(
      convId,
      prompt,
      nextTurn,
    )) {
      if (event.type === "text_delta" && event.text) {
        response += event.text;
      }
    }
    if (response) {
      const ci = deps.conversationInitiator;
      if (ci) {
        // Pass the orphaned turn's original channel as the override so a
        // WhatsApp voice note is rescued back to WhatsApp, not to the
        // preferred outbound channel (which may be "web").
        const lastUser = await deps.conversationManager.getLastUserTurn(convId);
        await ci.forwardToChannel(response, lastUser?.channel);
      }
    }
  };
}

// ─────────────────────────────────────────────────────────────────────────────

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

  // Deps wired at boot (M9.6-S2)
  idleTimerManager: IdleTimerManager | null = null;
  attachmentService: AttachmentService | null = null;

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
  notificationQueue: PersistentNotificationQueue | null = null;

  // Health
  healthMonitor: HealthMonitor | null = null;

  // Visual actions (screenshots)
  readonly visualActionService: VisualActionService;

  // Capabilities (M9-S1)
  capabilityRegistry: CapabilityRegistry | null = null;

  // Single gate for script-plug invocation (M9.6-S10)
  capabilityInvoker: CapabilityInvoker | null = null;

  // User-facing CFR copy, registry-aware (M9.6-S14). Replaced at boot with a
  // registry-backed instance once the CapabilityRegistry is initialised.
  resilienceCopy: ResilienceCopy = createResilienceCopy(new CapabilityRegistry());

  // Capability hot-reload watcher (M9.6-S3)
  capabilityWatcher: CapabilityWatcher | null = null;

  // Recovery Orchestrator (M9.6-S4)
  recoveryOrchestrator: RecoveryOrchestrator | null = null;

  // Ack delivery (M9.6-S6, exposed for capabilities health route in S19)
  ackDelivery: AckDelivery | null = null;

  // CFR (M9.6-S1)
  cfr!: CfrEmitter;
  rawMediaStore!: RawMediaStore;

  playwrightBridge: PlaywrightScreenshotBridge | null = null;

  private constructor(agentDir: string, isHatched: boolean) {
    super();
    this.agentDir = agentDir;
    this.isHatched = isHatched;
    this.sessionRegistry = new SessionRegistry(5);
    this.visualActionService = new VisualActionService(agentDir);
    this.cfr = new CfrEmitter();
    this.rawMediaStore = new RawMediaStore(agentDir);
  }

  /**
   * Create a fully initialized App instance.
   * Preserves the exact initialization order from the original index.ts:main().
   */
  static async create(options: AppOptions): Promise<App> {
    const { agentDir, connectionRegistry } = options;
    const hatched = isHatched(agentDir);
    const app = new App(agentDir, hatched);

    // Wire VAS store callback so PostToolUse hook can store screenshots
    setVasStoreCallback((image, metadata) => {
      const ss = app.visualActionService.store(image, metadata);
      return { id: ss.id, filename: ss.filename };
    });

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
      app.resilienceCopy = createResilienceCopy(registry);  // M9.6-S14

      // M9.6-S10 / S12: CapabilityInvoker — single gate for script-plug invocations.
      // S10 wired a placeholder originFactory; S12 replaces it with a live lookup
      // into the currently-streaming SessionManager's context map. Each brain
      // session populates `ConversationSessionContext` at turn-start (via
      // `setTurnContext()`) and promotes it into the session map on `session_init`.
      // The factory walks the SessionRegistry to find the one currently-active
      // session and returns its origin. Throws when no session is active — a
      // script-plug invocation outside a turn is a programming error (not a
      // runtime path).
      app.capabilityInvoker = new CapabilityInvoker({
        cfr: app.cfr,
        registry,
        originFactory: () => {
          for (const session of app.sessionRegistry.getAll().values()) {
            if (session.hasActiveSession()) {
              const origin = session.getCurrentOrigin();
              if (origin) return origin;
            }
          }
          throw new Error(
            "[CapabilityInvoker] originFactory called with no active brain session — " +
              "script-plug invocations must occur inside a streamMessage turn (S12).",
          );
        },
      });

      // M9.6-S12: wire CFR deps into SessionManager so each brain session
      // attaches a McpCapabilityCfrDetector at init time.
      setCfrDetectorDeps(app.cfr, registry);

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
            // Proactive health check: warn on enabled+broken or degraded capabilities (M9.6-S3)
            const unhealthy = registry.getHealth().filter((r) => r.issue);
            for (const r of unhealthy) {
              console.warn(
                `[Capabilities] WARN: ${r.name} (${r.type}) — ${r.issue}`,
              );
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

      // Capability hot-reload watcher (M9.6-S3)
      // Watches CAPABILITY.md, .enabled, config.yaml, .mcp.json — debounced 500ms.
      // Replaces the old FileWatcher (CAPABILITY.md only, untracked local var).
      app.capabilityWatcher = new CapabilityWatcher(
        capabilitiesDir,
        envPath,
        registry,
        (caps) => {
          app.emit("capability:changed", caps);
          getPromptBuilder()?.invalidateCache();
          console.log(`[Capabilities] Re-scanned: ${caps.length} capabilities`);
          // Emit again after testAll (called inside rescanNow) refreshes health
          app.emit("capability:changed", registry.list());
          getPromptBuilder()?.invalidateCache();
        },
      );
      await app.capabilityWatcher.start();

      // M9.6-S4: Recovery Orchestrator
      const KNOWN_TERMINAL = new Set([
        "done",
        "completed", // automation-executor sets "completed" for success; normalised to "done" below
        "failed",
        "needs_review",
        "interrupted",
        "cancelled",
      ]);

      // M9.6-S6: framework-owned ack delivery. Requires a TransportManager
      // (for channel-originated turns) and a ConnectionRegistry (for dashboard
      // turns). If either is missing at this point in boot, AckDelivery
      // falls back to console logging so the orchestrator never blocks.
      // Concrete AutomationNotifierLike — lazy reads conversationInitiator at
      // call time (CI is wired later in boot at ~line 1148).
      const automationNotifier: AutomationNotifierLike = {
        async notify({ automationId, jobId, outcome, message }) {
          const ci = app.conversationInitiator;
          if (!ci) {
            console.warn("[AutomationNotifier] ConversationInitiator not ready — notification skipped");
            return;
          }
          const prompt =
            `A capability recovery finished for automation ${automationId} (job ${jobId}).\n\n` +
            `Outcome: ${outcome}.\n\n${message}\n\n` +
            `You are the conversation layer — let the user know briefly.`;
          try {
            // Pre-M9.4-S4.1 this was `if (!alerted)` which never fired
            // (AlertResult is always a truthy object). Fixed FU-7 rollup:
            // fall back to initiate() only when alert() reports no_conversation,
            // and observe the initiate delivery outcome too.
            const alerted = await ci.alert(prompt);
            if (alerted.status === "no_conversation") {
              const init = await ci.initiate({ firstTurnPrompt: `[SYSTEM: ${prompt}]` });
              if (init.delivery.status !== "delivered") {
                const reason =
                  "reason" in init.delivery
                    ? init.delivery.reason
                    : init.delivery.status;
                console.warn(
                  `[AutomationNotifier] initiate-fallback deferred: ${reason}`,
                );
              }
            } else if (alerted.status !== "delivered") {
              const reason =
                "reason" in alerted ? alerted.reason : alerted.status;
              console.warn(
                `[AutomationNotifier] alert deferred: ${reason}`,
              );
            }
          } catch (err) {
            console.error("[AutomationNotifier] Failed to notify user:", err);
          }
        },
      };

      const ackDelivery =
        app.transportManager && connectionRegistry
          ? new AckDelivery(app.transportManager, connectionRegistry, automationNotifier)
          : null;

      app.ackDelivery = ackDelivery;

      app.recoveryOrchestrator = new RecoveryOrchestrator({
        spawnAutomation: async (spec) => {
          const models = loadModels(agentDir);
          const automation = app.automations.create({
            name: spec.name,
            instructions: spec.prompt,
            manifest: {
              name: spec.name,
              model: spec.model === "sonnet" ? models.sonnet : models.opus,
              autonomy: spec.autonomy === "cautious" ? "cautious" : "full",
              trigger: [{ type: "manual" }],
              once: true,
              job_type: spec.jobType,
              target_path: spec.targetPath,
            },
          });
          await app.automations.fire(automation.id);
          const jobs = app.automations.listJobs({ automationId: automation.id });
          const job = jobs[0];
          return { jobId: job.id, automationId: automation.id };
        },
        awaitAutomation: async (jobId, timeoutMs) => {
          const deadline = Date.now() + timeoutMs;
          while (Date.now() < deadline) {
            const job = app.automationJobService?.getJob(jobId);
            if (job && KNOWN_TERMINAL.has(job.status)) {
              const normalisedStatus =
                job.status === "completed" ? "done" : job.status;
              return {
                status: normalisedStatus as
                  | "done"
                  | "failed"
                  | "needs_review"
                  | "interrupted"
                  | "cancelled",
              };
            }
            if (job && !KNOWN_TERMINAL.has(job.status) && job.status !== "running" && job.status !== "pending") {
              console.warn(
                `[RecoveryOrchestrator] Unknown terminal status: ${job.status}`,
              );
              return { status: "failed" };
            }
            await new Promise((r) => setTimeout(r, 2000));
          }
          return { status: "failed" };
        },
        getJobRunDir: (jobId) =>
          app.automationJobService?.getJob(jobId)?.run_dir ?? null,
        capabilityRegistry: registry,
        watcher: app.capabilityWatcher!,
        invoker: app.capabilityInvoker ?? undefined,
        emitAck: async (failure, kind) => {
          // M9.6-S6: resolve the user-facing copy and deliver on the same
          // channel the triggering turn arrived on. Also append a
          // `capability_surrender` event to the conversation on surrender
          // kinds — the orphan watchdog uses this marker to avoid
          // re-driving a conversation that Nina has already bailed on.
          const rc = app.resilienceCopy;
          let text: string;
          if (kind === "attempt") {
            text = rc.ack(failure);
          } else if (kind === "status") {
            text = rc.status(failure);
          } else if (kind === "surrender") {
            text = rc.surrender(failure, "iteration-3");
          } else if (kind === "surrender-cooldown") {
            text = rc.surrender(failure, "surrender-cooldown");
          } else if (kind === "surrender-budget") {
            text = rc.surrender(failure, "budget");
          } else if (kind === "surrender-redesign-needed") {
            text = rc.surrender(failure, "redesign-needed");
          } else if (kind === "surrender-insufficient-context") {
            text = rc.surrender(failure, "insufficient-context");
          } else if (kind === "terminal-fixed") {
            text = rc.terminalAck(failure);
          } else {
            console.warn(`[CFR] emitAck: unhandled AckKind '${kind as string}' — falling back to terminalAck`);
            text = rc.terminalAck(failure);
          }

          const _origin = failure.triggeringInput.origin;
          const _convId = _origin.kind === "conversation" ? _origin.conversationId : "(non-conversation)";
          console.log(
            `[CFR] ack(${kind}) for ${failure.capabilityType} — conv ${_convId}`,
          );

          if (ackDelivery) {
            // M9.6-S12 Task 5: thread the ack kind through so automation-origin
            // terminal kinds trigger CFR_RECOVERY.md writing. session info is
            // not yet wired (Task 6 will pass it from the orchestrator's
            // FixSession); the writer falls back to an empty attempts table
            // when session is absent.
            await ackDelivery.deliver(failure, text, { kind });
          } else {
            console.warn(
              "[CFR] AckDelivery unavailable (TransportManager or ConnectionRegistry missing) — ack not delivered",
            );
          }

          // D4: on surrender, persist a marker event so the orphan watchdog
          // (M9.6-S5) does not re-drive this turn on the next boot.
          // surrender-cooldown does NOT write a new event — the original surrender
          // already wrote one. Writing again would be noise (S6-FU3).
          if (
            kind === "surrender" ||
            kind === "surrender-budget" ||
            kind === "surrender-redesign-needed" ||
            kind === "surrender-insufficient-context"
          ) {
            const _surrenderOrigin = failure.triggeringInput.origin;
            // M9.6-S12 Task 6d: non-conversation origins have no conversation
            // to attach a `capability_surrender` event to — their durable
            // record lives in CFR_RECOVERY.md (automation; written by Task 5
            // + Task 6b terminal drain) or console log (system). Early-return
            // keeps the hot path non-crashing; the full RESTORED_TERMINAL
            // surface is S13.
            if (_surrenderOrigin.kind !== "conversation") {
              return;
            }
            const { conversationId, turnNumber } = _surrenderOrigin;
            try {
              await app.conversationManager.appendEvent(conversationId, {
                type: "capability_surrender",
                capabilityType: failure.capabilityType,
                conversationId,
                turnNumber,
                reason:
                  kind === "surrender-budget" ? "budget-exhausted" :
                  kind === "surrender-redesign-needed" ? "redesign-needed" :
                  kind === "surrender-insufficient-context" ? "insufficient-context" :
                  "max-attempts",
                surrenderedAt: new Date().toISOString(),
              });
            } catch (err) {
              console.error(
                "[CFR] Failed to append capability_surrender event:",
                err,
              );
            }
          } else if (kind === "surrender-cooldown") {
            console.info(
              `[CFR] cooldown-hit surrender for ${failure.capabilityType} — ack delivered, no new event written`,
            );
          }
        },
        reprocessTurn: async (failure, recoveredContent) => {
          const { origin } = failure.triggeringInput;
          // M9.6-S12 Task 6d: non-conversation origins have no user turn to
          // re-process. The orchestrator's terminal drain (Task 6b) already
          // routed the recovery:
          //   - automation → CFR_RECOVERY.md via writeAutomationRecovery
          //   - system     → console log
          // Full RESTORED_TERMINAL state-machine wiring is S13; S12 just
          // makes this path non-crashing.
          if (origin.kind !== "conversation") {
            return;
          }
          const { conversationId, turnNumber, channel } = origin;
          const prompt = `You are the conversation layer. The user's original turn #${turnNumber} failed to transcribe; it actually said: "${recoveredContent}". Answer their question directly — don't acknowledge this system message.`;
          let response = "";
          for await (const event of app.chat.sendSystemMessage(
            conversationId,
            prompt,
            turnNumber,
          )) {
            if (event.type === "text_delta" && event.text) {
              response += event.text;
            }
          }
          if (response) {
            const ci = app.conversationInitiator;
            if (ci) {
              // FU4 (M9.6-S6): route the re-processed response back to the
              // original conversation's channel — not the preferred-outbound
              // default — so a WhatsApp-triggered CFR doesn't answer on
              // dashboard (or vice versa).
              const originChannel = channel.channelId || undefined;
              await ci.forwardToChannel(response, originChannel);
            }
          }
        },
        // M9.6-S12 Task 6b: wire AckDelivery.writeAutomationRecovery so the
        // terminal drain can land a CFR_RECOVERY.md record for every attached
        // automation origin — including the `outcome: "fixed"` case, which
        // doesn't flow through emitAck. Absent ackDelivery → the orchestrator
        // logs a warning and continues with the remaining drain steps.
        writeAutomationRecovery: ackDelivery
          ? (args) => {
              ackDelivery.writeAutomationRecovery(args);
            }
          : undefined,
        now: () => new Date().toISOString(),
      });

      app.cfr.on("failure", (f) => {
        app.recoveryOrchestrator!.handle(f).catch((err) =>
          console.error("[CFR] Orchestrator handle error:", err),
        );
      });
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
        return createBaileysPlugin({ ...cfg, agentDir });
      });

      // ChannelMessageHandler needs connectionRegistry for WS broadcasts.
      // Brain interaction is delegated to app.chat.sendMessage().
      if (connectionRegistry) {
        app.channelMessageHandler = new ChannelMessageHandler(
          {
            conversationManager: app.conversationManager,
            connectionRegistry,
            sendViaTransport: (transportId, to, message) =>
              app.transportManager!.send(transportId, to, message),
            sendTypingIndicator: (transportId, to) =>
              app.transportManager!.sendTypingIndicator(transportId, to),
            sendAudioUrlViaTransport: async (
              transportId: string,
              to: string,
              audioUrl: string,
            ): Promise<boolean> => {
              const plugins = app.transportManager!.getPlugins();
              const plugin = plugins.find((p) => p.id === transportId);
              if (!plugin || !("sendAudio" in plugin)) return false;
              const bp = plugin as BaileysPlugin;

              // audioUrl is "/api/assets/audio/<filename>" — resolve to agentDir/audio/<filename>
              const filename = audioUrl.split("/").pop();
              if (!filename) return false;
              const filePath = join(agentDir, "audio", filename);
              if (!existsSync(filePath)) {
                console.warn(`[App] sendAudioUrlViaTransport: file not found: ${filePath}`);
                return false;
              }

              try {
                const audioBuffer = readFileSync(filePath);
                await bp.sendAudio(to, audioBuffer);
                return true;
              } catch (err) {
                console.warn("[App] sendAudioUrlViaTransport failed:", err instanceof Error ? err.message : String(err));
                return false;
              }
            },
            sendTextViaTransport: async (
              transportId: string,
              to: string,
              text: string,
            ): Promise<boolean> => {
              try {
                await app.transportManager!.send(transportId, to, { content: text });
                return true;
              } catch (err) {
                console.warn("[App] sendTextViaTransport failed:", err instanceof Error ? err.message : String(err));
                return false;
              }
            },
            agentDir,
            app,
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
        recentAutomationAlerts,
        injectRecovery: async (conversationId, prompt, options) => {
          let response = "";
          for await (const event of app.chat.sendSystemMessage(
            conversationId,
            prompt,
            ((await app.conversationManager.get(conversationId))?.turnCount ?? 0) + 1,
          )) {
            if (event.type === "text_delta" && event.text) {
              response += event.text;
            }
          }

          // Send via outbound channel if available — but not for dashboard-originated messages
          if (response && options?.source !== "dashboard") {
            const ci = app.conversationInitiator;
            if (ci) {
              await ci.forwardToChannel(response);
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
            app,
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
      app.conversationInitiator = new ConversationInitiator({
        conversationManager: app.conversationManager,
        chatService: {
          async *sendSystemMessage(conversationId, prompt, turnNumber, options) {
            yield* app.chat.sendSystemMessage(
              conversationId,
              prompt,
              turnNumber,
              options,
            );
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

    // ── Orphaned-turn watchdog (M9.6-S5) ──
    // Boot-time sweep of the last 5 conversations. Any user turn with no
    // following assistant turn gets a mediator-framed rescue prompt (if
    // recent) or a watchdog_resolved_stale marker (if > 30 min old). Voice
    // placeholders with on-disk raw media go through STT reverify first.
    if (hatched) {
      const orphanWatchdog = new OrphanWatchdog({
        conversationLimit: 5,
        staleThresholdMs: 30 * 60 * 1000,
        rawMediaStore: app.rawMediaStore,
        conversationManager: app.conversationManager,
        reverify: app.capabilityRegistry && app.capabilityWatcher
          ? (failure) =>
              reverify(failure, app.capabilityRegistry!, app.capabilityWatcher!, app.capabilityInvoker ?? undefined)
          : undefined,
        systemMessageInjector: makeOrphanRescueInjector({
          conversationManager: app.conversationManager,
          chat: app.chat,
          conversationInitiator: app.conversationInitiator,
        }),
      });

      // Run once at boot — cap at 10s so a slow sweep never blocks startup.
      Promise.race<OrphanSweepReport>([
        orphanWatchdog.sweep(),
        new Promise<OrphanSweepReport>((_, reject) =>
          setTimeout(
            () => reject(new Error("orphan sweep timeout")),
            10_000,
          ),
        ),
      ])
        .then((report) => {
          console.log("[orphan-watchdog] sweep complete", report);
        })
        .catch((err) => {
          console.warn("[orphan-watchdog] sweep failed or timed out", err);
        });
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
        app.capabilityRegistry ?? undefined,
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
          hooks: createHooks("task", {
            agentDir,
            projectRoot: join(agentDir, ".."),
          }),
          visualService: app.visualActionService,
          onJobProgress: (jobId) => {
            const job = app.automationJobService?.getJob(jobId);
            if (job) {
              app.statePublisher?.publishJobs();
              app.emit("job:progress", job);
            }
          },
          capabilityRegistry: app.capabilityRegistry ?? undefined,
          // M9.6-S12: when present, executor attaches a per-job
          // McpCapabilityCfrDetector to the job's SDK hooks for MCP plug
          // failure detection (automation-origin CFRs).
          cfr: app.cfr,
        });

        // Persistent notification queue — heartbeat handles delivery
        const notificationQueue = new PersistentNotificationQueue(
          join(agentDir, "notifications"),
        );
        app.notificationQueue = notificationQueue;

        app.automationProcessor = new AutomationProcessor({
          automationManager: app.automationManager,
          executor: app.automationExecutor,
          jobService: app.automationJobService,
          agentDir,
          notificationQueue,
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
            const current = app.conversationManager
              .getConversationDb()
              .getCurrent();
            if (current?.id && recentAutomationAlerts) {
              recentAutomationAlerts.set(current.id, Date.now());
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
          const interruptedJobs = app.automationJobService!.listJobs({
            status: "interrupted",
          });
          const activeJobs = [
            ...runningJobs,
            ...pendingJobs,
            ...interruptedJobs,
          ];
          return activeJobs.map((job) => {
            const automation = app.automationManager!.findById(
              job.automationId,
            );
            const name = automation?.manifest.name ?? job.automationId;
            let progress = "";
            if (job.run_dir) {
              const todos = readTodoFile(join(job.run_dir, "todos.json"));
              if (todos.items.length > 0) {
                const done = todos.items.filter(
                  (i) => i.status === "done",
                ).length;
                const total = todos.items.length;
                const current = todos.items.find(
                  (i) => i.status === "in_progress",
                );
                progress = `, ${done}/${total} items done${current ? `, currently: "${current.text}"` : ""}`;
              }
            }
            return `"${name}" (${job.id}): ${job.status}${progress}`;
          });
        });
        console.log("[App] Running tasks checker wired to automation jobs");

        // Pending briefing provider — reads notification queue, marks delivered after shown
        setPendingBriefingProvider(() => {
          const pending = notificationQueue.listPending();
          if (pending.length === 0) return { lines: [], markDelivered: () => {} };

          const lines = pending.map((n) => {
            const progress =
              n.todos_completed != null && n.todos_total != null
                ? ` ${n.todos_completed}/${n.todos_total} items done.`
                : "";
            const incomplete =
              n.incomplete_items && n.incomplete_items.length > 0
                ? ` Remaining: ${n.incomplete_items.join(", ")}.`
                : "";
            const resumable =
              n.resumable ? " Resumable — ask the user whether to resume or discard." : "";
            return `${n.summary}${progress}${incomplete}${resumable}`;
          });

          const filenames = pending
            .map((n) => n._filename)
            .filter((f): f is string => !!f);

          return {
            lines,
            markDelivered: () => {
              for (const filename of filenames) {
                notificationQueue.markDelivered(filename);
              }
            },
          };
        });
        console.log("[App] Pending briefing provider wired to notification queue");

        // Conversation todo provider — reads conversation's todos.json
        setConversationTodoProvider((conversationId: string) => {
          const todoPath = join(
            agentDir,
            "conversations",
            conversationId,
            "todos.json",
          );
          const todoFile = readTodoFile(todoPath);
          return todoFile.items.map((item) => ({
            text: item.text,
            status: item.status,
          }));
        });
        console.log("[App] Conversation todo provider wired");

        // === Restart Recovery Sequence ===
        // Runs synchronously before heartbeat starts. Detects work interrupted by prior shutdown.

        // Step 1: Mark interrupted jobs
        const staleRunning = app.automationJobService.listJobs({
          status: "running",
        });
        const stalePending = app.automationJobService.listJobs({
          status: "pending",
        });
        const staleJobs = [...staleRunning, ...stalePending];

        let autoResumed = 0;
        let interrupted = 0;

        for (const job of staleJobs) {
          const automation = app.automationManager.findById(job.automationId);
          const todoFile = job.run_dir
            ? readTodoFile(join(job.run_dir, "todos.json"))
            : { items: [] };
          const completed = todoFile.items.filter(
            (i) => i.status === "done",
          ).length;
          const total = todoFile.items.length;
          const incomplete = todoFile.items
            .filter((i) => i.status !== "done")
            .map((i) => i.text);

          // Safety predicate: can this job be auto-resumed?
          // autonomy defaults to "full" when omitted (most ad-hoc jobs omit it)
          const canAutoResume =
            !!automation?.manifest.once &&
            (automation?.manifest.autonomy ?? "full") === "full" &&
            !!job.sdk_session_id &&
            job.status === "running";

          if (canAutoResume || job.status === "running") {
            console.log(
              `[Recovery] Job ${job.id}: once=${automation?.manifest.once}, autonomy=${automation?.manifest.autonomy ?? "full"}, session=${!!job.sdk_session_id}, canAutoResume=${canAutoResume}`,
            );
          }

          if (canAutoResume && automation) {
            autoResumed++;
            console.log(
              `[Recovery] Auto-resuming safe ad-hoc job: ${job.id} (${automation.manifest.name})`,
            );
            // DO NOT mark as interrupted first — executor.resume() sets status to "running"
            // Resume asynchronously — don't block the startup sequence
            app.automationExecutor
              .resume(
                job,
                "Auto-resumed after server restart. Continue where you left off.",
                job.sdk_session_id ?? null,
              )
              .then((result) => {
                app.statePublisher?.publishJobs();

                if (result.success && automation.manifest.notify === "immediate") {
                  notificationQueue.enqueue({
                    job_id: job.id,
                    automation_id: job.automationId,
                    type: "job_completed",
                    summary: `[${automation.manifest.name}] ${result.summary ?? "Completed after restart recovery."}`,
                    todos_completed: total,
                    todos_total: total,
                    created: new Date().toISOString(),
                    delivery_attempts: 0,
                  });
                }
              })
              .catch((err) => {
                console.error(`[Recovery] Auto-resume failed for ${job.id}:`, err);

                const freshTodo = job.run_dir
                  ? readTodoFile(join(job.run_dir, "todos.json"))
                  : { items: [] };
                const freshCompleted = freshTodo.items.filter(i => i.status === "done").length;
                const freshTotal = freshTodo.items.length;
                const freshIncomplete = freshTodo.items.filter(i => i.status !== "done").map(i => i.text);

                // executor.resume() sets status to "failed" internally.
                // Correct to "interrupted" so the user can manually resume later.
                app.automationJobService!.updateJob(job.id, {
                  status: "interrupted",
                  summary: `Auto-resume failed: ${err instanceof Error ? err.message : "unknown"}. ${freshCompleted}/${freshTotal} items done.`,
                });
                notificationQueue.enqueue({
                  job_id: job.id,
                  automation_id: job.automationId,
                  type: "job_interrupted",
                  summary: `Auto-resume failed for ${automation.manifest.name}. ${freshCompleted}/${freshTotal} items done.`,
                  todos_completed: freshCompleted,
                  todos_total: freshTotal,
                  incomplete_items: freshIncomplete.length > 0 ? freshIncomplete : undefined,
                  resumable: !!job.sdk_session_id,
                  created: new Date().toISOString(),
                  delivery_attempts: 0,
                });
                app.statePublisher?.publishJobs();
              });
            continue; // Skip the interrupt+notify path
          }

          // Not safe to auto-resume — mark interrupted and notify (existing behavior)
          interrupted++;
          app.automationJobService.updateJob(job.id, {
            status: "interrupted",
            summary: `Interrupted by restart. ${completed}/${total} items done.`,
          });

          notificationQueue.enqueue({
            job_id: job.id,
            automation_id: job.automationId,
            type: "job_interrupted",
            summary: `Job interrupted by restart. ${completed}/${total} items done.`,
            todos_completed: completed,
            todos_total: total,
            incomplete_items: incomplete,
            resumable: !!job.sdk_session_id,
            created: new Date().toISOString(),
            delivery_attempts: 0,
          });
        }

        if (autoResumed > 0 || interrupted > 0) {
          console.log(
            `[Recovery] ${autoResumed} auto-resumed, ${interrupted} interrupted`,
          );
        }

        // Step 2: Disable stale once-automations (spec says delete, but disable is equivalent)
        const allAutomations = app.automationManager.list();
        let disabledOnce = 0;
        for (const auto of allAutomations) {
          if (auto.manifest.once && auto.manifest.status === "disabled") {
            // Already disabled from prior run — skip
            continue;
          }
          if (auto.manifest.once) {
            // Check if all jobs for this automation are completed
            const jobs = app.automationJobService.listJobs({
              automationId: auto.id,
              status: "completed",
            });
            if (jobs.length > 0) {
              app.automationManager.disable(auto.id);
              disabledOnce++;
            }
          }
        }
        if (disabledOnce > 0) {
          console.log(
            `[Recovery] Disabled ${disabledOnce} completed once-automation(s)`,
          );
        }

        // Step 3: Re-scan capabilities (may have been mid-modification at shutdown)
        if (app.capabilityRegistry) {
          try {
            const capDir = join(agentDir, "capabilities");
            const envFile = resolveEnvPath(agentDir);
            const freshCaps = await scanCapabilities(capDir, envFile);
            app.capabilityRegistry.load(freshCaps);
            console.log(
              `[Recovery] Capability rescan: ${freshCaps.length} capabilities`,
            );
          } catch (err) {
            console.warn("[Recovery] Capability rescan failed:", err);
          }
        }

        // Step 4: Start heartbeat (picks up notifications from Step 1)
        // Heartbeat service — stale job detection + notification delivery
        const heartbeatService = new HeartbeatService({
          jobService: app.automationJobService,
          notificationQueue,
          get conversationInitiator() {
            return app.conversationInitiator ?? null;
          },
          staleThresholdMs: 5 * 60 * 1000,
          tickIntervalMs: 30 * 1000,
          capabilityHealthIntervalMs: 60 * 60 * 1000,
          registry: connectionRegistry, // M9.4-S5 B7: WS broadcast for handoff_pending
          agentDir, // M9.1-S9: audit-log liveness signal
          resolveStaleThresholdMs: (automationId: string) => {
            const automation = app.automationManager?.findById(automationId);
            return automation?.manifest.health?.stale_threshold_ms ?? null;
          },
        });
        // M9.4-S5 B2: wire heartbeat into processor for fast-path drain.
        // Must be set BEFORE start() so the first drainNow path is wired.
        app.automationProcessor?.setHeartbeat(heartbeatService);
        heartbeatService.start();

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
          executor: app.automationExecutor,
          onStateChanged: () => {
            app.statePublisher?.publishJobs();
            app.statePublisher?.publishAutomations();
          },
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

        // Mount failure -> alert user via the notification queue so transient
        // transport failures retry (same path as automation completions).
        watchTriggerService.on("mount_failure", async ({ path, attempts }) => {
          const prompt = `A filesystem watch on "${path}" has failed after ${attempts} retry attempts. The mount may be down.\n\nYou are the conversation layer — let the user know about this infrastructure issue briefly. Don't be dramatic, just inform them so they can check if needed.`;
          notificationQueue.enqueue({
            job_id: `infra-mount-${Date.now()}`,
            automation_id: "_infra",
            type: "infra_alert",
            summary: prompt,
            created: new Date().toISOString(),
            delivery_attempts: 0,
          });
          // Fast-path drain; failures are non-fatal (next 30 s tick retries).
          heartbeatService.drainNow().catch((err) => {
            console.warn("[app] mount_failure drainNow failed:", err);
          });
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
          // M9.2-S9: filterSkillsByTools call removed — it's now pure (no side effects).
          // Skill filtering is handled by the session manager via SystemPromptBuilder.excludeSkills.
          app.emit("skills:changed");
        },
        onSkillChanged: () => {
          app.emit("skills:changed");
        },
      });
      addMcpServer("skills", skillServer);
    }

    // ── Desktop control (M9.5-S3: registry-based; M9.5-S7: listByProvides) ──
    {
      // Registry path: if a desktop-control capability is installed and enabled, wire factory
      const desktopCap = app.capabilityRegistry
        ?.listByProvides('desktop-control')
        .filter((c) => c.interface === 'mcp' && c.entrypoint && c.status === 'available' && c.enabled)[0]

      if (desktopCap) {
        // Factory: return stdio config so the SDK spawns the process itself.
        // Resolve entrypoint args to absolute paths (SDK may not support cwd).
        const entrypointParts = desktopCap.entrypoint!.split(/\s+/)
        const resolvedArgs = entrypointParts.slice(1).map((arg) =>
          arg.startsWith('.') || (!arg.startsWith('/') && arg.includes('/'))
            ? join(desktopCap.path, arg)
            : arg,
        )
        addMcpServerFactory('desktop-x11', async () => {
          console.log(`[Desktop] Factory invoked — spawning MCP server`)
          return {
          command: entrypointParts[0],
          args: resolvedArgs,
          cwd: desktopCap.path,
          env: Object.fromEntries(
            Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined),
          ),
        }})

        console.log(`[Desktop] desktop-control: 1 registry capability — ${desktopCap.name} (cmd: ${entrypointParts[0]} ${resolvedArgs.join(' ')})`)
      } else {
        console.log('[Desktop] desktop-control: no capabilities — desktop tools unavailable')
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
      agentDir: app.agentDir,
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

    // ── Boot-time deps wiring (M9.6-S2) ──
    // Wire chat-service deps at App construction so WhatsApp (and other channel
    // plugins) can process media without waiting for a browser WS connection.
    // The IdleTimerManager starts with a no-op viewer-count callback; the WS
    // handler upgrades it to the real ConnectionRegistry on first connect.
    app.attachmentService = new AttachmentService(agentDir);
    app.idleTimerManager = app.abbreviationQueue
      ? new IdleTimerManager(app.abbreviationQueue, () => 0)
      : null;
    app.chat.setDeps({
      abbreviationQueue: app.abbreviationQueue,
      idleTimerManager: app.idleTimerManager,
      attachmentService: app.attachmentService,
      conversationSearchService: app.conversationSearchService,
      postResponseHooks: app.postResponseHooks,
      log: (msg) => console.log(msg),
      logError: (err, msg) => console.error(msg, err),
    });

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
    // Stop idle timers before draining the queue to prevent late enqueues (M9.6-S2)
    this.idleTimerManager?.shutdown();
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
    if (this.capabilityWatcher) {
      await this.capabilityWatcher.stop();
      console.log("CapabilityWatcher stopped.");
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
