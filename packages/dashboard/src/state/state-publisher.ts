/**
 * StatePublisher
 *
 * Pushes full entity-collection snapshots to all connected WebSocket clients.
 * Used for live dashboard panels (Tasks, Calendar, Conversations).
 *
 * Debounces each entity type independently (100ms window) to batch rapid
 * mutations (e.g. a task processor updating status multiple times in a loop)
 * into a single broadcast.
 */

import type { WebSocket } from "@fastify/websocket";
import { existsSync, readdirSync } from "fs";
import { join } from "path";
import path from "path";
import { readTodoFile } from "../automations/todo-file.js";
import type { ConnectionRegistry } from "../ws/connection-registry.js";
import type {
  CalendarEventSnapshot,
  ConversationMeta,
  MemoryStats,
  SpaceSnapshot,
  AutomationSnapshot,
  JobSnapshot,
  ScreenshotSnapshot,
} from "../ws/protocol.js";
import type {
  CalendarEvent,
  createCalDAVClient,
  MemoryDb,
  PluginRegistry,
  Automation,
} from "@my-agent/core";
import type { ConversationManager } from "../conversations/index.js";
import type { ConversationDatabase } from "../conversations/db.js";
import type { AutomationManager } from "../automations/automation-manager.js";
import type { AutomationJobService } from "../automations/automation-job-service.js";

// Debounce delay in milliseconds
const DEBOUNCE_MS = 100;

/**
 * Convert a CalendarEvent to the CalendarEventSnapshot wire format
 */
function toCalendarEventSnapshot(event: CalendarEvent): CalendarEventSnapshot {
  return {
    uid: event.uid,
    calendarId: event.calendarId,
    title: event.title,
    description: event.description,
    start: event.start.toISOString(),
    end: event.end.toISOString(),
    allDay: event.allDay,
    rrule: event.rrule,
    status: event.status,
    transparency: event.transparency,
    location: event.location,
    action: event.action,
  };
}

function toSpaceSnapshot(space: {
  name: string;
  tags: string[];
  path: string;
  runtime: string | null;
  entry: string | null;
  description: string | null;
  indexedAt: string;
}): SpaceSnapshot {
  return {
    name: space.name,
    tags: space.tags,
    path: space.path,
    runtime: space.runtime ?? undefined,
    entry: space.entry ?? undefined,
    description: space.description ?? undefined,
    indexedAt: space.indexedAt,
  };
}

export interface StatePublisherOptions {
  connectionRegistry: ConnectionRegistry;
  conversationManager: ConversationManager | null;
  spacesDb: ConversationDatabase | null;
  /** Optional calendar client factory — called lazily when needed */
  getCalendarClient:
    | (() => ReturnType<typeof createCalDAVClient> | null)
    | null;
}

export class StatePublisher {
  private registry: ConnectionRegistry;
  private conversationManager: ConversationManager | null;
  private getCalendarClient:
    | (() => ReturnType<typeof createCalDAVClient> | null)
    | null;
  private spacesDb: ConversationDatabase | null;

  // Memory services (set after initialization via setMemoryServices)
  private memoryDb: MemoryDb | null = null;
  private pluginRegistry: PluginRegistry | null = null;

  // Automation services (set after initialization via setAutomationServices)
  private automationManager: AutomationManager | null = null;
  private automationJobService: AutomationJobService | null = null;

  // App reference (set via subscribeToApp) for capability registry access
  private app: import("../app.js").App | null = null;

  // Debounce timers for each entity type
  private calendarTimer: ReturnType<typeof setTimeout> | null = null;
  private conversationsTimer: ReturnType<typeof setTimeout> | null = null;
  private memoryTimer: ReturnType<typeof setTimeout> | null = null;
  private spacesTimer: ReturnType<typeof setTimeout> | null = null;
  private automationsTimer: ReturnType<typeof setTimeout> | null = null;
  private jobsTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: StatePublisherOptions) {
    this.registry = options.connectionRegistry;
    this.conversationManager = options.conversationManager;
    this.spacesDb = options.spacesDb;
    this.getCalendarClient = options.getCalendarClient;
  }

  /**
   * Subscribe to App events for automatic state publishing.
   * Replaces all imperative publishX() calls from routes/handlers.
   */
  subscribeToApp(app: import("../app.js").App): void {
    this.app = app;
    app.on("conversation:created", () => this.publishConversations());
    app.on("conversation:updated", () => this.publishConversations());
    app.on("conversation:deleted", () => this.publishConversations());

    app.on("calendar:changed", () => this.publishCalendar());

    app.on("memory:changed", () => this.publishMemory());

    app.on("space:created", () => this.publishSpaces());
    app.on("space:updated", () => this.publishSpaces());
    app.on("space:deleted", () => this.publishSpaces());

    app.on("automation:created", () => this.publishAutomations());
    app.on("automation:updated", () => this.publishAutomations());
    app.on("automation:deleted", () => this.publishAutomations());
    app.on("job:created", () => this.publishJobs());
    app.on("job:started", () => this.publishJobs());
    app.on("job:progress", () => this.publishJobs());
    app.on("job:completed", () => this.publishJobs());
    app.on("job:failed", () => this.publishJobs());
    app.on("job:needs_review", () => this.publishJobs());

    app.on("skills:changed", () => {
      this.registry.broadcastToAll({
        type: "state:skills",
        timestamp: Date.now(),
      });
    });

    app.on("capability:changed", () => this.publishCapabilities());
  }

  /**
   * Set automation services after initialization.
   * Called after automation system is initialized in App.create().
   */
  setAutomationServices(
    automationManager: AutomationManager | null,
    automationJobService: AutomationJobService | null,
  ): void {
    this.automationManager = automationManager;
    this.automationJobService = automationJobService;
  }

  /**
   * Set memory services after initialization.
   * Called after memory system is initialized in index.ts.
   */
  setMemoryServices(
    memoryDb: MemoryDb | null,
    pluginRegistry: PluginRegistry | null,
  ): void {
    this.memoryDb = memoryDb;
    this.pluginRegistry = pluginRegistry;
  }

  // ─── Public API ──────────────────────────────────────────────────────────

  /**
   * Schedule a debounced broadcast of calendar events to all connected clients.
   * Covers the next 30 days.
   */
  publishCalendar(): void {
    if (this.calendarTimer) clearTimeout(this.calendarTimer);
    this.calendarTimer = setTimeout(() => {
      this.calendarTimer = null;
      this._broadcastCalendar();
    }, DEBOUNCE_MS);
  }

  /**
   * Schedule a debounced broadcast of conversation metadata to all connected clients.
   */
  publishConversations(): void {
    if (this.conversationsTimer) clearTimeout(this.conversationsTimer);
    this.conversationsTimer = setTimeout(() => {
      this.conversationsTimer = null;
      this._broadcastConversations();
    }, DEBOUNCE_MS);
  }

  /**
   * Schedule a debounced broadcast of memory stats to all connected clients.
   */
  publishMemory(): void {
    if (this.memoryTimer) clearTimeout(this.memoryTimer);
    this.memoryTimer = setTimeout(() => {
      this.memoryTimer = null;
      this._broadcastMemory();
    }, DEBOUNCE_MS);
  }

  /**
   * Schedule a debounced broadcast of space snapshots to all connected clients.
   */
  publishSpaces(): void {
    if (this.spacesTimer) clearTimeout(this.spacesTimer);
    this.spacesTimer = setTimeout(() => {
      this.spacesTimer = null;
      this._broadcastSpaces();
    }, DEBOUNCE_MS);
  }

  /**
   * Schedule a debounced broadcast of automation snapshots to all connected clients.
   */
  publishAutomations(): void {
    if (this.automationsTimer) clearTimeout(this.automationsTimer);
    this.automationsTimer = setTimeout(() => {
      this.automationsTimer = null;
      this._broadcastAutomations();
    }, DEBOUNCE_MS);
  }

  /**
   * Schedule a debounced broadcast of job snapshots to all connected clients.
   */
  publishJobs(): void {
    if (this.jobsTimer) clearTimeout(this.jobsTimer);
    this.jobsTimer = setTimeout(() => {
      this.jobsTimer = null;
      this._broadcastJobs();
    }, DEBOUNCE_MS);
  }

  /**
   * Immediately broadcast a single screenshot event to all connected clients.
   * No debouncing — screenshots are individual events.
   */
  publishScreenshot(snapshot: ScreenshotSnapshot): void {
    this.registry.broadcastToAll({
      type: "state:screenshot",
      screenshot: snapshot,
      timestamp: Date.now(),
    });
  }

  /**
   * Immediately broadcast capability list to all connected clients.
   * No debouncing — capabilities change rarely.
   */
  publishCapabilities(): void {
    const capabilities = this.app?.capabilityRegistry?.list() ?? [];
    this.registry.broadcastToAll({
      type: "capabilities",
      capabilities: capabilities.map((c) => ({
        name: c.name,
        provides: c.provides,
        interface: c.interface,
        status: c.status,
        unavailableReason: c.unavailableReason,
        health: c.health,
        lastTestLatencyMs: c.lastTestLatencyMs,
        degradedReason: c.degradedReason,
      })),
    });
  }

  /**
   * Send current state of all entity types to a single newly-connected socket.
   * Called immediately on connect — no debounce needed.
   */
  async publishAllTo(socket: WebSocket): Promise<void> {
    const timestamp = Date.now();

    // Calendar events (next 30 days)
    const calClient = this.getCalendarClient?.();
    if (calClient) {
      try {
        const now = new Date();
        const end = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
        const events = await calClient.getEvents("all", now, end);
        const payload = JSON.stringify({
          type: "state:calendar",
          events: events.map(toCalendarEventSnapshot),
          timestamp,
        });
        if (socket.readyState === 1) {
          socket.send(payload);
        }
      } catch {
        // Calendar not reachable — skip, client will use REST fallback
      }
    }

    // Conversations
    if (this.conversationManager) {
      try {
        const conversations = await this.conversationManager.list({});
        const payload = JSON.stringify({
          type: "state:conversations",
          conversations: conversations.slice(0, 50).map((conv) => ({
            id: conv.id,
            title: conv.title,
            topics: conv.topics,
            created: conv.created.toISOString(),
            updated: conv.updated.toISOString(),
            turnCount: conv.turnCount,
            model: conv.model,
            externalParty: conv.externalParty,
            isPinned: conv.isPinned,
            status: conv.status,
          })),
          timestamp,
        });
        if (socket.readyState === 1) {
          socket.send(payload);
        }
      } catch {
        // Skip on error
      }
    }

    // Spaces
    if (this.spacesDb) {
      const spaces = this.spacesDb.listSpaces();
      const payload = JSON.stringify({
        type: "state:spaces",
        spaces: spaces.map(toSpaceSnapshot),
        timestamp,
      });
      if (socket.readyState === 1) {
        socket.send(payload);
      }
    }

    // Automations
    if (this.automationManager) {
      const snapshots = this._getAutomationSnapshots();
      const payload = JSON.stringify({
        type: "state:automations",
        automations: snapshots,
        timestamp,
      });
      if (socket.readyState === 1) {
        socket.send(payload);
      }
    }

    // Capabilities
    const capabilities = this.app?.capabilityRegistry?.list() ?? [];
    if (capabilities.length > 0) {
      const capPayload = JSON.stringify({
        type: "capabilities",
        capabilities: capabilities.map((c) => ({
          name: c.name,
          provides: c.provides,
          interface: c.interface,
          status: c.status,
          unavailableReason: c.unavailableReason,
          health: c.health,
          lastTestLatencyMs: c.lastTestLatencyMs,
          degradedReason: c.degradedReason,
        })),
      });
      if (socket.readyState === 1) {
        socket.send(capPayload);
      }
    }

    // Jobs
    if (this.automationJobService) {
      const snapshots = this._getJobSnapshots();
      const payload = JSON.stringify({
        type: "state:jobs",
        jobs: snapshots,
        timestamp,
      });
      if (socket.readyState === 1) {
        socket.send(payload);
      }
    }

    // Memory stats
    if (this.memoryDb) {
      const stats = this._getMemoryStats();
      const payload = JSON.stringify({
        type: "state:memory",
        stats,
        timestamp,
      });
      if (socket.readyState === 1) {
        socket.send(payload);
      }
    }
  }

  // ─── Private Broadcast Helpers ───────────────────────────────────────────

  private _broadcastCalendar(): void {
    const calClient = this.getCalendarClient?.();
    if (!calClient) return;

    const now = new Date();
    const end = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    calClient
      .getEvents("all", now, end)
      .then((events: CalendarEvent[]) => {
        this.registry.broadcastToAll({
          type: "state:calendar",
          events: events.map(toCalendarEventSnapshot),
          timestamp: Date.now(),
        });
      })
      .catch(() => {
        // Calendar not reachable — skip
      });
  }

  private async _broadcastConversations(): Promise<void> {
    if (!this.conversationManager) return;
    try {
      const conversations = await this.conversationManager.list({});
      const metas: ConversationMeta[] = conversations
        .slice(0, 50)
        .map((conv) => ({
          id: conv.id,
          title: conv.title,
          topics: conv.topics,
          created: conv.created.toISOString(),
          updated: conv.updated.toISOString(),
          turnCount: conv.turnCount,
          model: conv.model,
          externalParty: conv.externalParty,
          isPinned: conv.isPinned,
          status: conv.status,
        }));
      this.registry.broadcastToAll({
        type: "state:conversations",
        conversations: metas,
        timestamp: Date.now(),
      });
    } catch {
      // Skip on error
    }
  }

  private _broadcastSpaces(): void {
    if (!this.spacesDb) return;
    const spaces = this.spacesDb.listSpaces();
    this.registry.broadcastToAll({
      type: "state:spaces",
      spaces: spaces.map(toSpaceSnapshot),
      timestamp: Date.now(),
    });
  }

  private _broadcastAutomations(): void {
    if (!this.automationManager) return;
    const snapshots = this._getAutomationSnapshots();
    this.registry.broadcastToAll({
      type: "state:automations",
      automations: snapshots,
      timestamp: Date.now(),
    });
  }

  private _broadcastJobs(): void {
    if (!this.automationJobService) return;
    const snapshots = this._getJobSnapshots();
    this.registry.broadcastToAll({
      type: "state:jobs",
      jobs: snapshots,
      timestamp: Date.now(),
    });
  }

  private _getAutomationSnapshots(): AutomationSnapshot[] {
    if (!this.automationManager) return [];
    const automations = this.automationManager.list({ excludeSystem: true });
    return automations.map((a) => {
      const jobs = this.automationJobService?.listJobs({
        automationId: a.id,
      });
      return {
        id: a.id,
        name: a.manifest.name,
        status: a.manifest.status,
        triggerTypes: a.manifest.trigger.map((t) => t.type),
        spaces: a.manifest.spaces ?? [],
        model: a.manifest.model,
        notify: a.manifest.notify,
        autonomy: a.manifest.autonomy,
        once: a.manifest.once,
        lastFiredAt: jobs?.[0]?.created,
        jobCount: jobs?.length ?? 0,
      };
    });
  }

  private _getJobSnapshots(): JobSnapshot[] {
    if (!this.automationJobService) return [];
    const jobs = this.automationJobService.listJobs({ limit: 50 });
    return jobs.map((j) => {
      const automation = this.automationManager?.findById(j.automationId);
      const todoProgress: JobSnapshot["todoProgress"] = j.status === 'running' && j.run_dir
        ? (() => {
            try {
              const todoFile = readTodoFile(path.join(j.run_dir, 'todos.json'))
              if (todoFile.items.length === 0) return undefined
              const done = todoFile.items.filter(i => i.status === 'done').length
              const inProgress = todoFile.items.find(i => i.status === 'in_progress')
              return {
                done,
                total: todoFile.items.length,
                current: inProgress?.text ?? null,
                items: todoFile.items.map(i => ({ id: i.id, text: i.text, status: i.status })),
              }
            } catch {
              return undefined
            }
          })()
        : undefined
      return {
        id: j.id,
        automationId: j.automationId,
        automationName: automation?.manifest.name ?? j.automationId,
        status: j.status,
        created: j.created,
        completed: j.completed,
        summary: j.summary,
        triggerType: (j.context as Record<string, unknown>)?.trigger as
          | string
          | undefined,
        todoProgress,
      };
    });
  }

  private _broadcastMemory(): void {
    if (!this.memoryDb) return;
    const stats = this._getMemoryStats();
    this.registry.broadcastToAll({
      type: "state:memory",
      stats,
      timestamp: Date.now(),
    });
  }

  private _getMemoryStats(): MemoryStats {
    if (!this.memoryDb) {
      return {
        initialized: false,
        pluginState: "not_set_up",
        filesIndexed: 0,
        totalChunks: 0,
        lastSync: null,
        hasVectorIndex: false,
        embeddingsReady: false,
        activePlugin: null,
        degraded: null,
        availablePlugins: [],
      };
    }

    const status = this.memoryDb.getStatus();
    const active = this.pluginRegistry?.getActive();
    const available = this.pluginRegistry?.list() || [];

    const degradedHealth = this.pluginRegistry?.getDegradedHealth();
    const intendedId = this.pluginRegistry?.getIntendedPluginId();
    const intendedPlugin = intendedId
      ? this.pluginRegistry?.get(intendedId)
      : null;

    // Determine 4-state plugin status
    let pluginState: "not_set_up" | "connecting" | "active" | "error" =
      "not_set_up";
    if (active) {
      pluginState = "active";
    } else if (degradedHealth) {
      pluginState = "error";
    } else if (intendedId) {
      // Has intended but not active — connecting or recovering
      pluginState = "connecting";
    }

    return {
      initialized: true,
      pluginState,
      filesIndexed: status.filesIndexed,
      totalChunks: status.totalChunks,
      lastSync: status.lastSync,
      hasVectorIndex: status.dimensions !== null,
      embeddingsReady: status.embeddingsReady,
      activePlugin: active
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
      availablePlugins: available.map((p) => ({
        id: p.id,
        name: p.name,
        model: p.modelName,
      })),
      // M6-S9: Check if local model is cached for "Delete Local Model" visibility
      localModelCached: (() => {
        const agentDir = (this.memoryDb as any)?.agentDir as string | undefined;
        if (!agentDir) return false;
        const modelsDir = join(agentDir, "cache", "models");
        if (!existsSync(modelsDir)) return false;
        try {
          const files = readdirSync(modelsDir);
          return files.length > 0;
        } catch {
          return false;
        }
      })(),
    };
  }
}
