/**
 * File Sync Service
 * Watches notebook files and syncs changes to the memory index.
 *
 * @module memory/sync-service
 */

import { watch, type FSWatcher } from 'chokidar'
import { readFile, stat } from 'fs/promises'
import { join, relative } from 'path'
import { MemoryDb } from './memory-db.js'
import { chunkMarkdown, hashFileContent } from './chunker.js'
import type { EmbeddingsPlugin } from './embeddings/types.js'
import type { SyncResult, SyncOptions } from './types.js'

export interface SyncServiceOptions {
  notebookDir: string
  db: MemoryDb
  getPlugin: () => EmbeddingsPlugin | null
  debounceMs?: number
}

export class SyncService {
  private notebookDir: string
  private db: MemoryDb
  private getPlugin: () => EmbeddingsPlugin | null
  private debounceMs: number
  private watcher: FSWatcher | null = null
  private pendingSync = new Map<string, NodeJS.Timeout>()
  private syncing = false

  constructor(options: SyncServiceOptions) {
    this.notebookDir = options.notebookDir
    this.db = options.db
    this.getPlugin = options.getPlugin
    this.debounceMs = options.debounceMs ?? 1500
  }

  /**
   * Start watching notebook files for changes.
   */
  startWatching(): void {
    if (this.watcher) return

    this.watcher = watch(this.notebookDir, {
      ignored: /(^|[\/\\])\../, // Ignore dotfiles
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 500,
        pollInterval: 100,
      },
    })

    this.watcher.on('add', (path) => this.scheduleSync(path))
    this.watcher.on('change', (path) => this.scheduleSync(path))
    this.watcher.on('unlink', (path) => this.handleDelete(path))
  }

  /**
   * Stop watching files.
   */
  stopWatching(): void {
    if (this.watcher) {
      this.watcher.close()
      this.watcher = null
    }
    // Clear pending syncs
    for (const timeout of this.pendingSync.values()) {
      clearTimeout(timeout)
    }
    this.pendingSync.clear()
  }

  /**
   * Schedule a debounced sync for a file.
   */
  private scheduleSync(filePath: string): void {
    // Only sync markdown files
    if (!filePath.endsWith('.md')) return

    // Clear existing timeout for this file
    const existing = this.pendingSync.get(filePath)
    if (existing) clearTimeout(existing)

    // Schedule new sync
    const timeout = setTimeout(() => {
      this.pendingSync.delete(filePath)
      this.syncFile(filePath).catch(console.error)
    }, this.debounceMs)

    this.pendingSync.set(filePath, timeout)
  }

  /**
   * Handle file deletion.
   */
  private handleDelete(filePath: string): void {
    if (!filePath.endsWith('.md')) return

    const relativePath = relative(this.notebookDir, filePath)
    this.db.deleteChunksForFile(relativePath)
    this.db.deleteFile(relativePath)
  }

  /**
   * Sync a single file to the index.
   */
  async syncFile(filePath: string): Promise<void> {
    const relativePath = relative(this.notebookDir, filePath)

    try {
      const content = await readFile(filePath, 'utf-8')
      const fileStat = await stat(filePath)
      const hash = hashFileContent(content)

      // Check if file has changed
      const existingFile = this.db.getFile(relativePath)
      if (existingFile && existingFile.hash === hash) {
        // No change
        return
      }

      // Delete existing chunks for this file
      this.db.deleteChunksForFile(relativePath)

      // Chunk the content
      const chunks = chunkMarkdown(content)

      // Get embeddings plugin
      const plugin = this.getPlugin()
      const model = plugin?.modelName ?? 'none'

      // Insert new chunks
      for (const chunk of chunks) {
        const chunkId = this.db.insertChunk({
          filePath: relativePath,
          heading: chunk.heading,
          startLine: chunk.startLine,
          endLine: chunk.endLine,
          text: chunk.text,
          hash: chunk.hash,
        })

        // Generate and store embedding if plugin available
        if (plugin && (await plugin.isReady())) {
          // Check embedding cache first
          let embedding = this.db.getCachedEmbedding(chunk.hash, model)

          if (!embedding) {
            embedding = await plugin.embed(chunk.text)
            this.db.cacheEmbedding(chunk.hash, model, embedding)
          }

          this.db.insertChunkVector(chunkId, embedding)
        }
      }

      // Update file record
      this.db.upsertFile({
        path: relativePath,
        hash,
        mtime: fileStat.mtime.toISOString(),
        size: fileStat.size,
        indexedAt: new Date().toISOString(),
      })
    } catch (error) {
      console.error(`Failed to sync file ${relativePath}:`, error)
    }
  }

  /**
   * Perform a full sync of all notebook files.
   */
  async fullSync(options?: SyncOptions): Promise<SyncResult> {
    if (this.syncing) {
      return {
        added: 0,
        updated: 0,
        removed: 0,
        errors: ['Sync already in progress'],
        duration: 0,
      }
    }

    this.syncing = true
    const startTime = Date.now()
    const result: SyncResult = {
      added: 0,
      updated: 0,
      removed: 0,
      errors: [],
      duration: 0,
    }

    try {
      const { globby } = await import('globby')
      const files = await globby('**/*.md', { cwd: this.notebookDir })

      // Get currently indexed files
      const indexedFiles = new Set(this.db.listFiles().map((f) => f.path))

      // Sync each file
      for (const relativePath of files) {
        const filePath = join(this.notebookDir, relativePath)
        const existed = indexedFiles.has(relativePath)
        indexedFiles.delete(relativePath)

        try {
          const content = await readFile(filePath, 'utf-8')
          const fileStat = await stat(filePath)
          const hash = hashFileContent(content)

          // Check if file has changed
          const existingFile = this.db.getFile(relativePath)
          if (existingFile && existingFile.hash === hash) {
            continue // No change
          }

          // Delete existing chunks
          this.db.deleteChunksForFile(relativePath)

          // Chunk and index
          const chunks = chunkMarkdown(content)
          const plugin = this.getPlugin()
          const model = plugin?.modelName ?? 'none'

          for (const chunk of chunks) {
            const chunkId = this.db.insertChunk({
              filePath: relativePath,
              heading: chunk.heading,
              startLine: chunk.startLine,
              endLine: chunk.endLine,
              text: chunk.text,
              hash: chunk.hash,
            })

            if (plugin && (await plugin.isReady())) {
              let embedding = this.db.getCachedEmbedding(chunk.hash, model)
              if (!embedding) {
                embedding = await plugin.embed(chunk.text)
                this.db.cacheEmbedding(chunk.hash, model, embedding)
              }
              this.db.insertChunkVector(chunkId, embedding)
            }
          }

          // Update file record
          this.db.upsertFile({
            path: relativePath,
            hash,
            mtime: fileStat.mtime.toISOString(),
            size: fileStat.size,
            indexedAt: new Date().toISOString(),
          })

          if (existed) {
            result.updated++
          } else {
            result.added++
          }
        } catch (error) {
          result.errors.push(`${relativePath}: ${error}`)
        }
      }

      // Remove files that no longer exist
      for (const removedPath of indexedFiles) {
        this.db.deleteChunksForFile(removedPath)
        this.db.deleteFile(removedPath)
        result.removed++
      }

      // Update metadata
      this.db.setIndexMeta({
        builtAt: new Date().toISOString(),
      })
    } finally {
      this.syncing = false
      result.duration = Date.now() - startTime
    }

    return result
  }

  /**
   * Rebuild the entire index from scratch.
   */
  async rebuild(): Promise<SyncResult> {
    this.db.clearAll()
    return this.fullSync()
  }
}
