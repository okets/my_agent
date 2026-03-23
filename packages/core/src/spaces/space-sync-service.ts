import { EventEmitter } from 'node:events'
import { dirname, basename } from 'path'
import { parse } from 'yaml'
import { FileWatcher, type FileChange } from '../sync/file-watcher.js'
import type { SpaceManifest } from './types.js'

export interface SpaceSyncServiceOptions {
  /** Path to .my_agent/spaces/ directory */
  spacesDir: string
  /** Callback to upsert space into agent.db */
  onSpaceChanged: (space: SpaceSyncPayload) => void
  /** Callback when space SPACE.md is deleted */
  onSpaceDeleted: (name: string) => void
  /** Debounce ms (default: 1500) */
  debounceMs?: number
}

export interface SpaceSyncPayload {
  name: string
  path: string
  tags: string[]
  runtime?: string
  entry?: string
  io?: object
  maintenance?: object
  description: string
  indexedAt: string
}

export class SpaceSyncService extends EventEmitter {
  private watcher: FileWatcher
  private opts: SpaceSyncServiceOptions

  constructor(opts: SpaceSyncServiceOptions) {
    super()
    this.opts = opts
    this.watcher = new FileWatcher({
      watchDir: opts.spacesDir,
      includePattern: '**/SPACE.md',
      debounceMs: opts.debounceMs,
    })

    this.watcher.on('file:changed', (change: FileChange) => {
      const payload = this.parseSpaceManifest(change)
      if (payload) {
        opts.onSpaceChanged(payload)
        this.emit('space:synced', payload)
      }
    })

    this.watcher.on('file:deleted', (info: { absolutePath: string; relativePath: string }) => {
      const name = this.extractSpaceName(info.relativePath)
      if (name) {
        opts.onSpaceDeleted(name)
        this.emit('space:deleted', { name })
      }
    })
  }

  start(): void {
    this.watcher.start()
  }

  async stop(): Promise<void> {
    await this.watcher.stop()
  }

  async fullSync(): Promise<number> {
    return this.watcher.scanAll()
  }

  private parseSpaceManifest(change: FileChange): SpaceSyncPayload | null {
    try {
      const { data, body } = this.parseFrontmatter(change.content)
      const manifest = data as Partial<SpaceManifest>
      const name = this.extractSpaceName(change.relativePath)
      if (!name) return null

      const manifestDir = dirname(change.absolutePath)

      return {
        name: manifest.name ?? name,
        path: manifest.path ?? manifestDir,
        tags: manifest.tags ?? [],
        runtime: manifest.runtime,
        entry: manifest.entry,
        io: manifest.io,
        maintenance: manifest.maintenance,
        description: body.trim(),
        indexedAt: new Date().toISOString(),
      }
    } catch {
      return null
    }
  }

  private extractSpaceName(relativePath: string): string | null {
    // relativePath is like "my-space/SPACE.md" — parent dir is the space name
    const dir = dirname(relativePath)
    if (!dir || dir === '.') return null
    return basename(dir)
  }

  private parseFrontmatter(content: string): { data: Record<string, unknown>; body: string } {
    if (!content.startsWith('---\n') && !content.startsWith('---\r\n')) {
      return { data: {}, body: content }
    }

    const closingIndex = content.indexOf('\n---', 4)
    if (closingIndex === -1) {
      return { data: {}, body: content }
    }

    const yamlStr = content.slice(4, closingIndex)
    let body = content.slice(closingIndex + 4)
    if (body.startsWith('\n')) body = body.slice(1)

    const data = parse(yamlStr) ?? {}
    return { data, body }
  }
}
