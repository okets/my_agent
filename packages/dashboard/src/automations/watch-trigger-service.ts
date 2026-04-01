/**
 * WatchTriggerService — Filesystem-based automation triggers
 *
 * Watches external paths (NAS/SMB mounts, local dirs) using chokidar polling mode.
 * Debounces rapid file events per watched path, fires mapped automations.
 */

import { EventEmitter } from "node:events";
import { computeBackoff, DEFAULT_BACKOFF } from "@my-agent/core";

/** Minimal FSWatcher interface (from chokidar) to avoid direct type dependency */
interface FSWatcher {
  on(event: string, listener: (...args: any[]) => void): this;
  close(): Promise<void>;
}

export interface WatchTriggerConfig {
  automationId: string;
  path: string; // external path to watch
  events?: string[]; // ["add", "change", "unlink"] — defaults to ["add", "change"]
  polling?: boolean; // usePolling for NAS/SMB — defaults to true
  interval?: number; // polling interval ms — defaults to 5000
}

export interface WatchEvent {
  automationIds: string[];
  files: string[];
  event: string; // "add" | "change" | "unlink"
  timestamp: string;
}

export interface WatchTriggerServiceDeps {
  /** Read watch triggers from agent.db */
  getWatchTriggers: () => WatchTriggerConfig[];
  /** Fire an automation job with context */
  fireAutomation: (
    automationId: string,
    context: Record<string, unknown>,
  ) => Promise<void>;
  log: (msg: string) => void;
  logError: (err: unknown, msg: string) => void;
}

export class WatchTriggerService extends EventEmitter {
  private deps: WatchTriggerServiceDeps;
  private watchers = new Map<string, FSWatcher>(); // path -> watcher
  private pathToAutomations = new Map<string, string[]>(); // path -> automationId[]
  private pendingEvents = new Map<
    string,
    { files: string[]; event: string; timer: NodeJS.Timeout }
  >();
  private debounceDurationMs: number;
  private mountRetryAttempts = new Map<string, number>(); // path -> retry count

  constructor(deps: WatchTriggerServiceDeps, debounceDurationMs = 5000) {
    super();
    this.deps = deps;
    this.debounceDurationMs = debounceDurationMs;
  }

  /** Start watching all configured paths */
  async start(): Promise<void> {
    const triggers = this.deps.getWatchTriggers();
    if (triggers.length === 0) {
      this.deps.log("[WatchTriggerService] No watch triggers configured");
      return;
    }

    // Build path -> automationId[] map
    for (const trigger of triggers) {
      const existing = this.pathToAutomations.get(trigger.path) ?? [];
      existing.push(trigger.automationId);
      this.pathToAutomations.set(trigger.path, existing);
    }

    // Create one watcher per unique path
    // chokidar is a transitive dependency via @my-agent/core
    const chokidarModule = "chokidar";
    const { watch } = (await import(chokidarModule)) as {
      watch: (path: string, opts: Record<string, unknown>) => FSWatcher;
    };
    const uniquePaths = [...new Set(triggers.map((t) => t.path))];

    for (const watchPath of uniquePaths) {
      // Use first trigger's polling settings for this path
      const config = triggers.find((t) => t.path === watchPath)!;
      const events = config.events ?? ["add", "change"];

      const watcher = watch(watchPath, {
        persistent: true,
        ignoreInitial: true,
        usePolling: config.polling ?? true,
        interval: config.interval ?? 5000,
      });

      for (const event of events) {
        watcher.on(event, (filePath: string) => {
          this.handleFileEvent(watchPath, filePath, event);
        });
      }
      watcher.on("error", (error: Error) => {
        this.handleWatcherError(watchPath, error);
      });

      this.watchers.set(watchPath, watcher);
      this.deps.log(
        `[WatchTriggerService] Watching: ${watchPath} (polling: ${config.polling ?? true})`,
      );
    }
  }

  /** Stop all watchers */
  async stop(): Promise<void> {
    for (const [path, watcher] of this.watchers) {
      await watcher.close();
      this.deps.log(`[WatchTriggerService] Stopped watching: ${path}`);
    }
    this.watchers.clear();
    this.pathToAutomations.clear();

    // Clear pending debounce timers
    for (const pending of this.pendingEvents.values()) {
      clearTimeout(pending.timer);
    }
    this.pendingEvents.clear();
    this.mountRetryAttempts.clear();
  }

  /** Re-sync watchers when automation manifests change */
  async sync(): Promise<void> {
    const triggers = this.deps.getWatchTriggers();

    // Build new path -> automationId[] map
    const newPathMap = new Map<string, string[]>();
    for (const trigger of triggers) {
      const existing = newPathMap.get(trigger.path) ?? [];
      existing.push(trigger.automationId);
      newPathMap.set(trigger.path, existing);
    }

    // Tear down watchers for paths no longer needed
    for (const [path, watcher] of this.watchers) {
      if (!newPathMap.has(path)) {
        await watcher.close();
        this.watchers.delete(path);
        this.deps.log(`[WatchTriggerService] Removed watcher: ${path}`);
      }
    }

    // Register watchers for new paths
    const chokidarModule = "chokidar";
    const { watch } = (await import(chokidarModule)) as {
      watch: (path: string, opts: Record<string, unknown>) => FSWatcher;
    };
    for (const [path] of newPathMap) {
      if (!this.watchers.has(path)) {
        const config = triggers.find((t) => t.path === path)!;
        const events = config.events ?? ["add", "change"];

        const watcher = watch(path, {
          persistent: true,
          ignoreInitial: true,
          usePolling: config.polling ?? true,
          interval: config.interval ?? 5000,
        });

        for (const event of events) {
          watcher.on(event, (filePath: string) => {
            this.handleFileEvent(path, filePath, event);
          });
        }
        watcher.on("error", (error: Error) => {
          this.handleWatcherError(path, error);
        });

        this.watchers.set(path, watcher);
        this.deps.log(`[WatchTriggerService] Added watcher: ${path}`);
      }
    }

    // Update the path map
    this.pathToAutomations = newPathMap;
  }

  /** Handle file event with space-level debouncing */
  handleFileEvent(watchPath: string, filePath: string, event: string): void {
    const debounceKey = watchPath; // debounce by watched path (space-level)

    const pending = this.pendingEvents.get(debounceKey);
    if (pending) {
      // Add file to existing batch, reset timer
      if (!pending.files.includes(filePath)) {
        pending.files.push(filePath);
      }
      clearTimeout(pending.timer);
      pending.timer = setTimeout(
        () => this.flushPendingEvents(debounceKey),
        this.debounceDurationMs,
      );
      return;
    }

    // New batch
    const timer = setTimeout(
      () => this.flushPendingEvents(debounceKey),
      this.debounceDurationMs,
    );
    this.pendingEvents.set(debounceKey, { files: [filePath], event, timer });
  }

  /** Handle watcher error (mount failure) with retry + backoff */
  handleWatcherError(watchPath: string, error: Error): void {
    const attempt = this.mountRetryAttempts.get(watchPath) ?? 0;
    this.deps.logError(
      error,
      `[WatchTriggerService] Watcher error on ${watchPath} (attempt ${attempt})`,
    );

    const delay = computeBackoff(DEFAULT_BACKOFF, attempt);
    if (delay === null) {
      // Max attempts exceeded — persistent failure
      this.deps.log(
        `[WatchTriggerService] Persistent mount failure for ${watchPath} after ${attempt} attempts — alerting user`,
      );
      this.emit("mount_failure", { path: watchPath, attempts: attempt });
      this.mountRetryAttempts.delete(watchPath);
      return;
    }

    this.mountRetryAttempts.set(watchPath, attempt + 1);
    this.deps.log(`[WatchTriggerService] Retrying ${watchPath} in ${delay}ms`);

    setTimeout(async () => {
      try {
        // Close existing watcher
        const existing = this.watchers.get(watchPath);
        if (existing) {
          await existing.close();
          this.watchers.delete(watchPath);
        }
        // Re-register via sync (which reads current triggers from DB)
        await this.sync();
        this.mountRetryAttempts.delete(watchPath); // reset on success
      } catch (retryErr) {
        this.handleWatcherError(
          watchPath,
          retryErr instanceof Error ? retryErr : new Error(String(retryErr)),
        );
      }
    }, delay);
  }

  /** Flush debounced events and fire automations */
  async flushPendingEvents(debounceKey: string): Promise<void> {
    const pending = this.pendingEvents.get(debounceKey);
    if (!pending) return;
    this.pendingEvents.delete(debounceKey);

    const automationIds = this.pathToAutomations.get(debounceKey) ?? [];
    const context = {
      trigger: "watch" as const,
      files: pending.files,
      event: pending.event,
      batchSize: pending.files.length,
    };

    this.deps.log(
      `[WatchTriggerService] Firing ${automationIds.length} automation(s) for ${pending.files.length} file(s) at ${debounceKey}`,
    );

    // Fire all automations mapped to this path
    for (const automationId of automationIds) {
      try {
        await this.deps.fireAutomation(automationId, context);
      } catch (err) {
        this.deps.logError(
          err,
          `[WatchTriggerService] Failed to fire automation ${automationId}`,
        );
      }
    }

    this.emit("triggered", { automationIds, ...context });
  }

  /** Accessors for testing */
  getWatchers(): Map<string, FSWatcher> {
    return this.watchers;
  }
  getPathToAutomations(): Map<string, string[]> {
    return this.pathToAutomations;
  }
  getPendingEvents(): Map<
    string,
    { files: string[]; event: string; timer: NodeJS.Timeout }
  > {
    return this.pendingEvents;
  }
  getMountRetryAttempts(): Map<string, number> {
    return this.mountRetryAttempts;
  }
}
