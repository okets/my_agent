/**
 * AutomationSyncService — FileWatcher on `.my_agent/automations/*.md`
 *
 * Watches automation markdown files and syncs them to agent.db via AutomationManager.
 * Emits events for downstream consumers (SystemPromptBuilder, Scheduler, StatePublisher).
 */

import { EventEmitter } from "node:events";
import path from "node:path";
import { FileWatcher, type FileChange } from "@my-agent/core";
import type { AutomationManager } from "./automation-manager.js";

export class AutomationSyncService extends EventEmitter {
  private fileWatcher: FileWatcher;
  private manager: AutomationManager;

  constructor(config: { automationsDir: string; manager: AutomationManager }) {
    super();
    this.manager = config.manager;
    this.fileWatcher = new FileWatcher({
      watchDir: config.automationsDir,
      includePattern: "*.md",
      debounceMs: 1500,
      usePolling: false,
    });
  }

  async start(): Promise<void> {
    // Full sync on startup
    const count = await this.manager.syncAll();
    console.log(`[AutomationSync] Indexed ${count} automation(s) on startup`);

    // Watch for changes
    this.fileWatcher.on("file:changed", (change: FileChange) => {
      const id = path.basename(change.absolutePath, ".md");
      const automation = this.manager.read(id);
      if (automation) {
        this.emit("automation:updated", automation);
      }
    });

    this.fileWatcher.on(
      "file:deleted",
      (info: { absolutePath: string; relativePath: string }) => {
        const id = path.basename(info.absolutePath, ".md");
        this.manager.disable(id);
        this.emit("automation:removed", id);
      },
    );

    this.fileWatcher.start();
  }

  async stop(): Promise<void> {
    await this.fileWatcher.stop();
  }
}
