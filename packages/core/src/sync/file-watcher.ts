import { EventEmitter } from 'node:events'
import { watch, type FSWatcher } from 'chokidar'
import { readFile } from 'fs/promises'
import { basename, relative } from 'path'
import { createHash } from 'crypto'

export interface FileWatcherOptions {
  /** Directory to watch */
  watchDir: string
  /** Glob pattern for files to include (e.g. 'SPACE.md' with recursive matching) */
  includePattern?: string
  /** Patterns to exclude */
  excludePatterns?: string[]
  /** Debounce delay in ms (default: 1500) */
  debounceMs?: number
  /** Use polling mode (for NAS/WSL2) */
  usePolling?: boolean
  /** Polling interval in ms (default: 1000) */
  pollInterval?: number
}

export interface FileChange {
  /** Absolute path to the file */
  absolutePath: string
  /** Path relative to watchDir */
  relativePath: string
  /** File content */
  content: string
  /** SHA256 hash of content */
  hash: string
}

export function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

export class FileWatcher extends EventEmitter {
  private watchDir: string
  private includePattern?: string
  private excludePatterns: string[]
  private debounceMs: number
  private usePolling: boolean
  private pollInterval: number
  private watcher: FSWatcher | null = null
  private pendingTimers = new Map<string, NodeJS.Timeout>()
  private hashes = new Map<string, string>()

  constructor(options: FileWatcherOptions) {
    super()
    this.watchDir = options.watchDir
    this.includePattern = options.includePattern
    this.excludePatterns = options.excludePatterns ?? []
    this.debounceMs = options.debounceMs ?? 1500
    this.usePolling = options.usePolling ?? true
    this.pollInterval = options.pollInterval ?? 1000
  }

  start(): void {
    if (this.watcher) return

    this.watcher = watch(this.watchDir, {
      ignored: (path: string) => {
        if (basename(path).startsWith('.')) return true
        const rel = relative(this.watchDir, path)
        return this.excludePatterns.some((pattern) => {
          const prefix = pattern.endsWith('/**') ? pattern.slice(0, -3) : pattern
          return rel === prefix || rel.startsWith(prefix + '/')
        })
      },
      persistent: true,
      ignoreInitial: true,
      usePolling: this.usePolling,
      interval: this.pollInterval,
    })

    this.watcher.on('add', (path) => this.scheduleProcess(path))
    this.watcher.on('change', (path) => this.scheduleProcess(path))
    this.watcher.on('unlink', (path) => {
      if (!this.matchesPattern(path)) return
      const relativePath = relative(this.watchDir, path)
      this.hashes.delete(path)
      this.emit('file:deleted', { absolutePath: path, relativePath })
    })
    this.watcher.on('error', (error) => {
      this.emit('error', error)
    })
  }

  async stop(): Promise<void> {
    if (this.watcher) {
      await this.watcher.close()
      this.watcher = null
    }
    for (const timeout of this.pendingTimers.values()) {
      clearTimeout(timeout)
    }
    this.pendingTimers.clear()
  }

  async scanAll(): Promise<number> {
    const { globby } = await import('globby')
    const pattern = this.includePattern ?? '**/*'
    const files = await globby(pattern, {
      cwd: this.watchDir,
      absolute: true,
      ignore: this.excludePatterns,
    })

    let count = 0
    for (const absolutePath of files) {
      try {
        const content = await readFile(absolutePath, 'utf-8')
        const hash = hashContent(content)
        const oldHash = this.hashes.get(absolutePath)

        if (oldHash === hash) continue

        this.hashes.set(absolutePath, hash)
        const relativePath = relative(this.watchDir, absolutePath)
        const change: FileChange = { absolutePath, relativePath, content, hash }
        this.emit('file:changed', change)
        count++
      } catch {
        // File may have been deleted between glob and read
      }
    }

    this.emit('scan:complete', { count })
    return count
  }

  private matchesPattern(filePath: string): boolean {
    if (!this.includePattern) return true
    // Simple pattern matching for common cases like '**/SPACE.md'
    const rel = relative(this.watchDir, filePath)
    const pattern = this.includePattern
    if (pattern.startsWith('**/')) {
      const suffix = pattern.slice(3)
      return rel === suffix || rel.endsWith('/' + suffix)
    }
    return rel === pattern
  }

  private scheduleProcess(filePath: string): void {
    if (!this.matchesPattern(filePath)) return

    const existing = this.pendingTimers.get(filePath)
    if (existing) clearTimeout(existing)

    const timeout = setTimeout(() => {
      this.pendingTimers.delete(filePath)
      this.processFile(filePath).catch((err) => this.emit('error', err))
    }, this.debounceMs)

    this.pendingTimers.set(filePath, timeout)
  }

  private async processFile(filePath: string): Promise<void> {
    try {
      const content = await readFile(filePath, 'utf-8')
      const hash = hashContent(content)

      const oldHash = this.hashes.get(filePath)
      if (oldHash === hash) return

      this.hashes.set(filePath, hash)
      const relativePath = relative(this.watchDir, filePath)
      const change: FileChange = { absolutePath: filePath, relativePath, content, hash }
      this.emit('file:changed', change)
    } catch {
      // File may have been deleted
    }
  }
}
