/**
 * AppHarness — wires dashboard services without Fastify for integration testing.
 *
 * Mirrors the initialization sequence in index.ts but skips:
 * - Fastify server
 * - CalDAV / calendar scheduler
 * - WhatsApp / Baileys transport plugins
 * - Embeddings plugins
 * - Work loop scheduler
 * - MCP servers
 * - SystemPromptBuilder / session manager
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  NotificationService,
  MemoryDb,
  SyncService,
  SearchService,
  initNotebook,
} from "@my-agent/core";
import type { ServerMessage } from "../../src/ws/protocol.js";
import { ConversationManager } from "../../src/conversations/index.js";
import { TaskManager, TaskLogStorage } from "../../src/tasks/index.js";
import { ConnectionRegistry } from "../../src/ws/connection-registry.js";
import { StatePublisher } from "../../src/state/state-publisher.js";

export interface CapturedBroadcast {
  type: string;
  [key: string]: unknown;
}

export interface AppHarnessOptions {
  /** If true, initialize memory subsystem (MemoryDb + SyncService + SearchService) */
  withMemory?: boolean;
}

export class AppHarness {
  readonly agentDir: string;
  readonly conversationManager: ConversationManager;
  readonly taskManager: TaskManager;
  readonly logStorage: TaskLogStorage;
  readonly notificationService: NotificationService;
  readonly connectionRegistry: ConnectionRegistry;
  readonly statePublisher: StatePublisher;
  readonly broadcasts: CapturedBroadcast[] = [];

  // Optional subsystems
  memoryDb: MemoryDb | null = null;
  syncService: SyncService | null = null;
  searchService: SearchService | null = null;

  private constructor(agentDir: string) {
    this.agentDir = agentDir;

    // Core services (same order as index.ts)
    this.conversationManager = new ConversationManager(agentDir);

    const db = this.conversationManager.getDb();
    this.taskManager = new TaskManager(db, agentDir);
    this.logStorage = new TaskLogStorage(agentDir);

    this.notificationService = new NotificationService();

    // ConnectionRegistry — own instance, not the module singleton from chat-handler
    this.connectionRegistry = new ConnectionRegistry();

    // StatePublisher — wired to our ConnectionRegistry
    this.statePublisher = new StatePublisher({
      connectionRegistry: this.connectionRegistry,
      taskManager: this.taskManager,
      conversationManager: this.conversationManager,
      getCalendarClient: () => null, // No calendar in tests
    });

    // Intercept all broadcasts for assertion
    const originalBroadcast =
      this.connectionRegistry.broadcastToAll.bind(this.connectionRegistry);
    this.connectionRegistry.broadcastToAll = (
      message: ServerMessage,
      exclude?: any,
    ) => {
      this.broadcasts.push(message as unknown as CapturedBroadcast);
      originalBroadcast(message, exclude);
    };
  }

  /**
   * Factory — creates temp agentDir, initializes services.
   */
  static async create(options?: AppHarnessOptions): Promise<AppHarness> {
    const agentDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "my-agent-integration-"),
    );

    // Create minimal agent directory structure
    fs.mkdirSync(path.join(agentDir, "brain"), { recursive: true });
    fs.mkdirSync(path.join(agentDir, "runtime"), { recursive: true });
    fs.mkdirSync(path.join(agentDir, "tasks", "logs"), { recursive: true });
    fs.writeFileSync(
      path.join(agentDir, "brain", "AGENTS.md"),
      "# Test Agent\nYou are a test agent.\n",
    );

    const harness = new AppHarness(agentDir);

    // Initialize memory subsystem if requested
    if (options?.withMemory) {
      await initNotebook(agentDir);
      const notebookDir = path.join(agentDir, "notebook");

      harness.memoryDb = new MemoryDb(agentDir);
      harness.syncService = new SyncService({
        notebookDir,
        db: harness.memoryDb,
        getPlugin: () => null, // No embeddings in tests
        excludePatterns: ["knowledge/extracted/**"],
      });
      harness.searchService = new SearchService({
        db: harness.memoryDb,
        getPlugin: () => null,
        getDegradedHealth: () => null,
      });

      // Initial sync
      await harness.syncService.fullSync();
    }

    return harness;
  }

  /**
   * Clear captured broadcasts (call between test cases).
   */
  clearBroadcasts(): void {
    this.broadcasts.length = 0;
  }

  /**
   * Get broadcasts of a specific type.
   */
  getBroadcasts(type: string): CapturedBroadcast[] {
    return this.broadcasts.filter((b) => b.type === type);
  }

  /**
   * Clean shutdown — close databases, remove temp directory.
   */
  async shutdown(): Promise<void> {
    if (this.syncService) {
      this.syncService.stopWatching();
    }
    if (this.memoryDb) {
      this.memoryDb.close();
    }
    this.conversationManager.close();

    // Remove temp directory
    fs.rmSync(this.agentDir, { recursive: true, force: true });
  }
}
