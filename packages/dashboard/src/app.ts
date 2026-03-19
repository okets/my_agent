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
import type { AppEventMap } from "./app-events.js";

// Service types — these will be filled in as we move init into App.create()
import type { ConversationManager } from "./conversations/index.js";
import type { AbbreviationQueue } from "./conversations/abbreviation.js";
import type {
  TaskManager,
  TaskLogStorage,
  TaskExecutor,
  TaskProcessor,
  TaskScheduler,
  TaskSearchService,
} from "./tasks/index.js";
import type { TransportManager } from "./channels/index.js";
import type { ChannelMessageHandler } from "./channels/message-handler.js";
import type {
  CalendarScheduler,
  NotificationService,
  MemoryDb,
  SyncService,
  SearchService,
  PluginRegistry,
  HealthMonitor,
} from "@my-agent/core";
import type { StatePublisher } from "./state/state-publisher.js";
import type { ConversationSearchService } from "./conversations/search-service.js";
import type { WorkLoopScheduler } from "./scheduler/work-loop-scheduler.js";
import type { ConversationInitiator } from "./agent/conversation-initiator.js";
import type { PostResponseHooks } from "./conversations/post-response-hooks.js";
import type { SessionRegistry } from "./agent/session-registry.js";

export interface AppOptions {
  agentDir: string;
}

export class App extends EventEmitter {
  readonly agentDir: string;
  readonly isHatched: boolean;

  // Core services
  readonly conversationManager!: ConversationManager;
  readonly sessionRegistry!: SessionRegistry;

  // Task system
  readonly taskManager: TaskManager | null = null;
  readonly logStorage: TaskLogStorage | null = null;
  readonly taskExecutor: TaskExecutor | null = null;
  readonly taskProcessor: TaskProcessor | null = null;
  readonly taskScheduler: TaskScheduler | null = null;
  readonly taskSearchService: TaskSearchService | null = null;

  // Channels
  readonly transportManager: TransportManager | null = null;
  readonly channelMessageHandler: ChannelMessageHandler | null = null;

  // Calendar
  readonly calendarScheduler: CalendarScheduler | null = null;

  // Notifications
  readonly notificationService: NotificationService | null = null;

  // Work loop
  readonly workLoopScheduler: WorkLoopScheduler | null = null;

  // Memory
  readonly memoryDb: MemoryDb | null = null;
  readonly syncService: SyncService | null = null;
  readonly searchService: SearchService | null = null;
  readonly pluginRegistry: PluginRegistry | null = null;

  // Conversations (advanced)
  readonly conversationSearchService: ConversationSearchService | null = null;
  readonly abbreviationQueue: AbbreviationQueue | null = null;
  readonly conversationInitiator: ConversationInitiator | null = null;

  // Post-processing
  readonly postResponseHooks: PostResponseHooks | null = null;

  // State publishing
  readonly statePublisher: StatePublisher | null = null;

  // Health
  readonly healthMonitor: HealthMonitor | null = null;

  private constructor(agentDir: string, isHatched: boolean) {
    super();
    this.agentDir = agentDir;
    this.isHatched = isHatched;
  }

  /**
   * Create a fully initialized App instance.
   * Mirrors the initialization sequence from the original index.ts:main().
   */
  static async create(options: AppOptions): Promise<App> {
    const { agentDir } = options;
    const { isHatched } = await import("@my-agent/core");
    const hatched = isHatched(agentDir);
    const app = new App(agentDir, hatched);

    // Service initialization will be added in Task 3

    return app;
  }

  /**
   * Graceful shutdown — stop all services in reverse initialization order.
   */
  async shutdown(): Promise<void> {
    // Will be filled in Task 3
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
