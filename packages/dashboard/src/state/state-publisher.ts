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
import type { ConnectionRegistry } from "../ws/connection-registry.js";
import type {
  TaskSnapshot,
  CalendarEventSnapshot,
  ConversationMeta,
  MemoryStats,
} from "../ws/protocol.js";
import type {
  Task,
  CalendarEvent,
  createCalDAVClient,
  MemoryDb,
  PluginRegistry,
} from "@my-agent/core";
import type { TaskManager } from "../tasks/index.js";
import type { ConversationManager } from "../conversations/index.js";

// Debounce delay in milliseconds
const DEBOUNCE_MS = 100;

/**
 * Convert a Task to the TaskSnapshot wire format
 */
function toTaskSnapshot(task: Task): TaskSnapshot {
  return {
    id: task.id,
    type: task.type,
    sourceType: task.sourceType,
    sourceRef: task.sourceRef,
    title: task.title,
    instructions: task.instructions,
    work: task.work as unknown[] | undefined,
    delivery: task.delivery as unknown[] | undefined,
    status: task.status,
    sessionId: task.sessionId,
    recurrenceId: task.recurrenceId,
    occurrenceDate: task.occurrenceDate,
    scheduledFor: task.scheduledFor?.toISOString(),
    startedAt: task.startedAt?.toISOString(),
    completedAt: task.completedAt?.toISOString(),
    deletedAt: task.deletedAt?.toISOString(),
    created: task.created.toISOString(),
    createdBy: task.createdBy,
  };
}

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
    taskId: event.taskId,
    taskType: event.taskType,
    action: event.action,
  };
}

export interface StatePublisherOptions {
  connectionRegistry: ConnectionRegistry;
  taskManager: TaskManager | null;
  conversationManager: ConversationManager | null;
  /** Optional calendar client factory — called lazily when needed */
  getCalendarClient:
    | (() => ReturnType<typeof createCalDAVClient> | null)
    | null;
}

export class StatePublisher {
  private registry: ConnectionRegistry;
  private taskManager: TaskManager | null;
  private conversationManager: ConversationManager | null;
  private getCalendarClient:
    | (() => ReturnType<typeof createCalDAVClient> | null)
    | null;

  // Memory services (set after initialization via setMemoryServices)
  private memoryDb: MemoryDb | null = null;
  private pluginRegistry: PluginRegistry | null = null;

  // Debounce timers for each entity type
  private tasksTimer: ReturnType<typeof setTimeout> | null = null;
  private calendarTimer: ReturnType<typeof setTimeout> | null = null;
  private conversationsTimer: ReturnType<typeof setTimeout> | null = null;
  private memoryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: StatePublisherOptions) {
    this.registry = options.connectionRegistry;
    this.taskManager = options.taskManager;
    this.conversationManager = options.conversationManager;
    this.getCalendarClient = options.getCalendarClient;
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
   * Schedule a debounced broadcast of all tasks to all connected clients.
   */
  publishTasks(): void {
    if (this.tasksTimer) clearTimeout(this.tasksTimer);
    this.tasksTimer = setTimeout(() => {
      this.tasksTimer = null;
      this._broadcastTasks();
    }, DEBOUNCE_MS);
  }

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
   * Send current state of all entity types to a single newly-connected socket.
   * Called immediately on connect — no debounce needed.
   */
  async publishAllTo(socket: WebSocket): Promise<void> {
    const timestamp = Date.now();

    // Tasks
    if (this.taskManager) {
      const tasks = this.taskManager.list();
      const payload = JSON.stringify({
        type: "state:tasks",
        tasks: tasks.map(toTaskSnapshot),
        timestamp,
      });
      if (socket.readyState === 1) {
        socket.send(payload);
      }
    }

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
        const regularConvs = conversations.filter(
          (c) => c.channel === "web" || !c.isPinned,
        );
        const payload = JSON.stringify({
          type: "state:conversations",
          conversations: regularConvs.slice(0, 50).map((conv) => ({
            id: conv.id,
            channel: conv.channel,
            title: conv.title,
            topics: conv.topics,
            created: conv.created.toISOString(),
            updated: conv.updated.toISOString(),
            turnCount: conv.turnCount,
            model: conv.model,
            externalParty: conv.externalParty,
            isPinned: conv.isPinned,
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

  private _broadcastTasks(): void {
    if (!this.taskManager) return;
    const tasks = this.taskManager.list();
    this.registry.broadcastToAll({
      type: "state:tasks",
      tasks: tasks.map(toTaskSnapshot),
      timestamp: Date.now(),
    });
  }

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
      const regularConvs = conversations.filter(
        (c) => c.channel === "web" || !c.isPinned,
      );
      const metas: ConversationMeta[] = regularConvs
        .slice(0, 50)
        .map((conv) => ({
          id: conv.id,
          channel: conv.channel,
          title: conv.title,
          topics: conv.topics,
          created: conv.created.toISOString(),
          updated: conv.updated.toISOString(),
          turnCount: conv.turnCount,
          model: conv.model,
          externalParty: conv.externalParty,
          isPinned: conv.isPinned,
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

    const degraded = this.pluginRegistry?.getDegradedState();

    return {
      initialized: true,
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
          }
        : null,
      degraded: degraded
        ? {
            pluginId: degraded.pluginId,
            pluginName: degraded.pluginName,
            model: degraded.model,
            error: degraded.error,
            resolution: degraded.resolution,
            since: degraded.since,
          }
        : null,
      availablePlugins: available.map((p) => ({
        id: p.id,
        name: p.name,
        model: p.modelName,
      })),
    };
  }
}
