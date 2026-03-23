/**
 * WatchTriggerService — Filesystem-based automation triggers
 *
 * Watches external paths (NAS/SMB mounts, local dirs) using chokidar polling mode.
 * Debounces rapid file events per watched path, fires mapped automations.
 */

import { EventEmitter } from "node:events";

/** Minimal FSWatcher interface (from chokidar) to avoid direct type dependency */
interface FSWatcher {
  on(event: string, listener: (...args: any[]) => void): this;
  close(): Promise<void>;
}

export interface WatchTriggerConfig {
  automationId: string;
  path: string;         // external path to watch
  events?: string[];    // ["add", "change", "unlink"] — defaults to ["add", "change"]
  polling?: boolean;    // usePolling for NAS/SMB — defaults to true
  interval?: number;    // polling interval ms — defaults to 5000
}

export interface WatchEvent {
  automationIds: string[];
  files: string[];
  event: string;        // "add" | "change" | "unlink"
  timestamp: string;
}

export interface WatchTriggerServiceDeps {
  /** Read watch triggers from agent.db */
  getWatchTriggers: () => WatchTriggerConfig[];
  /** Fire an automation job with context */
  fireAutomation: (automationId: string, context: Record<string, unknown>) => Promise<void>;
  log: (msg: string) => void;
  logError: (err: unknown, msg: string) => void;
}

export class WatchTriggerService extends EventEmitter {
  private deps: WatchTriggerServiceDeps;
  private watchers = new Map<string, FSWatcher>();          // path -> watcher
  private pathToAutomations = new Map<string, string[]>();  // path -> automationId[]
  private pendingEvents = new Map<string, { files: string[]; event: string; timer: NodeJS.Timeout }>();
  private debounceDurationMs: number;
  private mountRetryAttempts = new Map<string, number>();   // path -> retry count

  constructor(deps: WatchTriggerServiceDeps, debounceDurationMs = 5000) {
    super();
    this.deps = deps;
    this.debounceDurationMs = debounceDurationMs;
  }

  /** Start watching all configured paths */
  async start(): Promise<void> { /* Task 2 */ }

  /** Stop all watchers */
  async stop(): Promise<void> { /* Task 2 */ }

  /** Re-sync watchers when automation manifests change */
  async sync(): Promise<void> { /* Task 3 */ }

  /** Handle file event with space-level debouncing */
  handleFileEvent(watchPath: string, filePath: string, event: string): void { /* Task 4 */ }

  /** Handle watcher error (mount failure) */
  handleWatcherError(watchPath: string, error: Error): void { /* Task 5 */ }

  /** Flush debounced events and fire automations */
  async flushPendingEvents(debounceKey: string): Promise<void> { /* Task 4 */ }

  /** Accessors for testing */
  getWatchers(): Map<string, FSWatcher> { return this.watchers; }
  getPathToAutomations(): Map<string, string[]> { return this.pathToAutomations; }
  getPendingEvents(): Map<string, { files: string[]; event: string; timer: NodeJS.Timeout }> { return this.pendingEvents; }
  getMountRetryAttempts(): Map<string, number> { return this.mountRetryAttempts; }
}
