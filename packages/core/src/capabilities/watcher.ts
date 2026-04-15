import { watch, type FSWatcher } from 'chokidar'
import type { CapabilityRegistry } from './registry.js'
import type { Capability } from './types.js'
import { scanCapabilities } from './scanner.js'

const WATCHED_FILENAMES = new Set(['CAPABILITY.md', '.enabled', 'config.yaml', '.mcp.json'])

function isWatchedFile(filePath: string): boolean {
  const name = filePath.split('/').pop() ?? ''
  return WATCHED_FILENAMES.has(name)
}

/**
 * Watches the capabilities directory for changes to the files that affect
 * capability registration and re-scans + re-tests the registry on change.
 *
 * Watched files: CAPABILITY.md, .enabled, config.yaml, .mcp.json
 * Debounce: 500ms (coalesces rapid multi-file saves into one rescan)
 * Polling mode: on (Ubuntu + NFS-adjacent mounts, per existing FileWatcher pattern)
 */
export class CapabilityWatcher {
  private watcher: FSWatcher | null = null
  private debounceTimer: NodeJS.Timeout | null = null

  constructor(
    private capabilitiesDir: string,
    private envPath: string,
    private registry: CapabilityRegistry,
    private onRescan?: (caps: Capability[]) => void,
  ) {}

  /** Start watching. Debounced 500ms. Resolves once chokidar's initial scan is complete. */
  async start(): Promise<void> {
    if (this.watcher) return

    this.watcher = watch(this.capabilitiesDir, {
      persistent: true,
      ignoreInitial: true,
      usePolling: true,
      interval: 500,
      // Do NOT use the default dot-file ignore — we need to watch .enabled files.
      // Only exclude node_modules to avoid performance issues.
      ignored: (p: string) => p.includes('node_modules'),
    })

    const scheduleRescan = () => {
      if (this.debounceTimer) clearTimeout(this.debounceTimer)
      this.debounceTimer = setTimeout(() => {
        this.debounceTimer = null
        this.rescanNow().catch((err) => {
          console.warn(
            '[CapabilityWatcher] Rescan failed:',
            err instanceof Error ? err.message : String(err),
          )
        })
      }, 500)
    }

    this.watcher.on('add', (path: string) => {
      if (isWatchedFile(path)) scheduleRescan()
    })
    this.watcher.on('change', (path: string) => {
      if (isWatchedFile(path)) scheduleRescan()
    })
    this.watcher.on('unlink', (path: string) => {
      if (isWatchedFile(path)) scheduleRescan()
    })

    // Wait for the initial scan to finish so callers can safely write files
    // immediately after start() and have them detected as new changes.
    await new Promise<void>((resolve) => {
      this.watcher!.on('ready', () => resolve())
    })
  }

  /** Stop watching and close the FSWatcher. */
  async stop(): Promise<void> {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = null
    }
    if (this.watcher) {
      await this.watcher.close()
      this.watcher = null
    }
  }

  /**
   * Force a rescan immediately. After rescan, the registry's `testAll()` is
   * called to refresh capability statuses. Returns once both have finished.
   */
  async rescanNow(): Promise<Capability[]> {
    const caps = await this.registry.rescan(() =>
      scanCapabilities(this.capabilitiesDir, this.envPath),
    )
    await this.registry.testAll()
    this.onRescan?.(caps)
    return caps
  }
}
