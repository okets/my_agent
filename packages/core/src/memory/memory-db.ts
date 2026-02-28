/**
 * Memory Database
 * SQLite schema and operations for the memory index.
 * This database is derived — deletable and rebuildable from markdown source files.
 *
 * @module memory/memory-db
 */

import Database from 'better-sqlite3'
import * as sqliteVec from 'sqlite-vec'
import { join } from 'path'
import type { FileRecord, Chunk, IndexMeta, MemoryStatus } from './types.js'

export class MemoryDb {
  private db: Database.Database
  private dbPath: string
  private dimensions: number | null = null

  constructor(agentDir: string) {
    this.dbPath = join(agentDir, 'brain', 'memory.db')
    this.db = new Database(this.dbPath)

    // Load sqlite-vec extension
    sqliteVec.load(this.db)

    // Configure SQLite for concurrent access
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('busy_timeout = 5000')
    this.db.pragma('foreign_keys = ON')

    // Initialize schema
    this.initSchema()
  }

  private initSchema(): void {
    // File tracking table
    this.db
      .prepare(
        `
      CREATE TABLE IF NOT EXISTS files (
        path TEXT PRIMARY KEY,
        hash TEXT NOT NULL,
        mtime TEXT NOT NULL,
        size INTEGER NOT NULL,
        indexed_at TEXT NOT NULL,
        indexed_with_embeddings INTEGER NOT NULL DEFAULT 0
      )
    `,
      )
      .run()

    // Chunks table
    this.db
      .prepare(
        `
      CREATE TABLE IF NOT EXISTS chunks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        file_path TEXT NOT NULL,
        heading TEXT,
        start_line INTEGER NOT NULL,
        end_line INTEGER NOT NULL,
        text TEXT NOT NULL,
        hash TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `,
      )
      .run()

    this.db.prepare('CREATE INDEX IF NOT EXISTS idx_chunks_file ON chunks(file_path)').run()
    this.db.prepare('CREATE INDEX IF NOT EXISTS idx_chunks_hash ON chunks(hash)').run()

    // FTS5 full-text search
    this.db
      .prepare(
        `
      CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
        text,
        heading,
        file_path UNINDEXED,
        chunk_id UNINDEXED
      )
    `,
      )
      .run()

    // Embedding cache (avoid re-computing)
    this.db
      .prepare(
        `
      CREATE TABLE IF NOT EXISTS embedding_cache (
        hash TEXT PRIMARY KEY,
        model TEXT NOT NULL,
        embedding TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `,
      )
      .run()

    // Index metadata
    this.db
      .prepare(
        `
      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `,
      )
      .run()

    // Migration: add indexed_with_embeddings column if missing (for existing DBs)
    const columns = this.db.prepare('PRAGMA table_info(files)').all() as Array<{ name: string }>
    const hasEmbeddingsCol = columns.some((c) => c.name === 'indexed_with_embeddings')
    if (!hasEmbeddingsCol) {
      this.db
        .prepare('ALTER TABLE files ADD COLUMN indexed_with_embeddings INTEGER NOT NULL DEFAULT 0')
        .run()
    }
  }

  /**
   * Initialize or recreate the vector table with the given dimensions.
   * Must be called after knowing the embedding plugin's dimensions.
   */
  initVectorTable(dimensions: number): void {
    // Drop existing vector table if dimensions changed
    const currentDims = this.getDimensions()
    if (currentDims !== null && currentDims !== dimensions) {
      this.db.prepare('DROP TABLE IF EXISTS chunks_vec').run()
    }

    // Create vector table
    this.db
      .prepare(
        `
      CREATE VIRTUAL TABLE IF NOT EXISTS chunks_vec USING vec0(
        embedding FLOAT[${dimensions}]
      )
    `,
      )
      .run()

    this.dimensions = dimensions
    this.setMeta('dimensions', String(dimensions))
  }

  /**
   * Reset vector index if the embeddings model/plugin changed.
   * Detects changes by comparing against stored meta, drops stale data if needed.
   */
  resetVectorIndex(pluginId: string, model: string, dimensions: number): { modelChanged: boolean } {
    const currentPlugin = this.getMeta('embeddingsPlugin')
    const currentModel = this.getMeta('embeddingsModel')
    const currentDims = this.getDimensions()

    const changed =
      currentPlugin !== pluginId ||
      currentModel !== model ||
      (currentDims !== null && currentDims !== dimensions)

    if (changed) {
      // Drop stale vector table and embedding cache
      this.db.prepare('DROP TABLE IF EXISTS chunks_vec').run()
      this.db.prepare('DELETE FROM embedding_cache').run()
      this.dimensions = null
    }

    // (Re)create vector table with correct dimensions
    this.initVectorTable(dimensions)

    // Persist which plugin/model is active
    this.setMeta('embeddingsPlugin', pluginId)
    this.setMeta('embeddingsModel', model)

    return { modelChanged: changed }
  }

  getDimensions(): number | null {
    if (this.dimensions !== null) return this.dimensions
    const val = this.getMeta('dimensions')
    this.dimensions = val ? parseInt(val, 10) : null
    return this.dimensions
  }

  // ============================================================
  // META OPERATIONS
  // ============================================================

  getMeta(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as
      | { value: string }
      | undefined
    return row?.value ?? null
  }

  setMeta(key: string, value: string): void {
    this.db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(key, value)
  }

  getIndexMeta(): IndexMeta {
    return {
      embeddingsPlugin: this.getMeta('embeddingsPlugin'),
      embeddingsModel: this.getMeta('embeddingsModel'),
      dimensions: this.getDimensions(),
      chunkTokens: parseInt(this.getMeta('chunkTokens') ?? '400', 10),
      chunkOverlap: parseInt(this.getMeta('chunkOverlap') ?? '80', 10),
      builtAt: this.getMeta('builtAt') ?? '',
    }
  }

  setIndexMeta(meta: Partial<IndexMeta>): void {
    if (meta.embeddingsPlugin !== undefined)
      meta.embeddingsPlugin
        ? this.setMeta('embeddingsPlugin', meta.embeddingsPlugin)
        : this.deleteMeta('embeddingsPlugin')
    if (meta.embeddingsModel !== undefined)
      meta.embeddingsModel
        ? this.setMeta('embeddingsModel', meta.embeddingsModel)
        : this.deleteMeta('embeddingsModel')
    if (meta.dimensions !== undefined) {
      if (meta.dimensions) {
        this.setMeta('dimensions', String(meta.dimensions))
        this.dimensions = meta.dimensions
      } else {
        this.deleteMeta('dimensions')
        this.dimensions = null
      }
    }
    if (meta.chunkTokens !== undefined) this.setMeta('chunkTokens', String(meta.chunkTokens))
    if (meta.chunkOverlap !== undefined) this.setMeta('chunkOverlap', String(meta.chunkOverlap))
    if (meta.builtAt !== undefined) this.setMeta('builtAt', meta.builtAt)
  }

  deleteMeta(key: string): void {
    this.db.prepare('DELETE FROM meta WHERE key = ?').run(key)
  }

  // ============================================================
  // FILE OPERATIONS
  // ============================================================

  getFile(path: string): FileRecord | null {
    const row = this.db.prepare('SELECT * FROM files WHERE path = ?').get(path) as
      | {
          path: string
          hash: string
          mtime: string
          size: number
          indexed_at: string
          indexed_with_embeddings: number
        }
      | undefined
    if (!row) return null
    return {
      path: row.path,
      hash: row.hash,
      mtime: row.mtime,
      size: row.size,
      indexedAt: row.indexed_at,
      indexedWithEmbeddings: row.indexed_with_embeddings === 1,
    }
  }

  upsertFile(file: FileRecord): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO files (path, hash, mtime, size, indexed_at, indexed_with_embeddings)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        file.path,
        file.hash,
        file.mtime,
        file.size,
        file.indexedAt,
        file.indexedWithEmbeddings ? 1 : 0,
      )
  }

  deleteFile(path: string): void {
    this.db.prepare('DELETE FROM files WHERE path = ?').run(path)
  }

  listFiles(): FileRecord[] {
    const rows = this.db.prepare('SELECT * FROM files').all() as Array<{
      path: string
      hash: string
      mtime: string
      size: number
      indexed_at: string
      indexed_with_embeddings: number
    }>
    return rows.map((row) => ({
      path: row.path,
      hash: row.hash,
      mtime: row.mtime,
      size: row.size,
      indexedAt: row.indexed_at,
      indexedWithEmbeddings: row.indexed_with_embeddings === 1,
    }))
  }

  // ============================================================
  // CHUNK OPERATIONS
  // ============================================================

  insertChunk(chunk: Omit<Chunk, 'id'>): number {
    const info = this.db
      .prepare(
        `INSERT INTO chunks (file_path, heading, start_line, end_line, text, hash)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(chunk.filePath, chunk.heading, chunk.startLine, chunk.endLine, chunk.text, chunk.hash)
    const chunkId = Number(info.lastInsertRowid)

    // Also insert into FTS
    this.db
      .prepare(
        `INSERT INTO chunks_fts (text, heading, file_path, chunk_id)
         VALUES (?, ?, ?, ?)`,
      )
      .run(chunk.text, chunk.heading ?? '', chunk.filePath, chunkId)

    return chunkId
  }

  insertChunkVector(chunkId: number, embedding: number[]): void {
    const jsonVec = JSON.stringify(embedding)
    this.db
      .prepare('INSERT INTO chunks_vec (rowid, embedding) VALUES (?, ?)')
      .run(BigInt(chunkId), jsonVec)
  }

  deleteChunksForFile(filePath: string): number[] {
    // Get chunk IDs first
    const chunks = this.db
      .prepare('SELECT id FROM chunks WHERE file_path = ?')
      .all(filePath) as Array<{ id: number }>
    const ids = chunks.map((c) => c.id)

    if (ids.length > 0) {
      // Delete from FTS
      const placeholders = ids.map(() => '?').join(',')
      this.db.prepare(`DELETE FROM chunks_fts WHERE chunk_id IN (${placeholders})`).run(...ids)

      // Delete from vector table (only if dimensions are set)
      if (this.dimensions) {
        try {
          for (const id of ids) {
            this.db.prepare('DELETE FROM chunks_vec WHERE rowid = ?').run(BigInt(id))
          }
        } catch {
          // Table doesn't exist, that's fine
        }
      }

      // Delete from chunks
      this.db.prepare(`DELETE FROM chunks WHERE id IN (${placeholders})`).run(...ids)
    }

    return ids
  }

  getChunk(id: number): Chunk | null {
    const row = this.db.prepare('SELECT * FROM chunks WHERE id = ?').get(id) as
      | {
          id: number
          file_path: string
          heading: string | null
          start_line: number
          end_line: number
          text: string
          hash: string
        }
      | undefined
    if (!row) return null
    return {
      id: row.id,
      filePath: row.file_path,
      heading: row.heading,
      startLine: row.start_line,
      endLine: row.end_line,
      text: row.text,
      hash: row.hash,
    }
  }

  // ============================================================
  // EMBEDDING CACHE
  // ============================================================

  getCachedEmbedding(hash: string, model: string): number[] | null {
    const row = this.db
      .prepare('SELECT embedding FROM embedding_cache WHERE hash = ? AND model = ?')
      .get(hash, model) as { embedding: string } | undefined
    if (!row) return null
    return JSON.parse(row.embedding)
  }

  cacheEmbedding(hash: string, model: string, embedding: number[]): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO embedding_cache (hash, model, embedding)
         VALUES (?, ?, ?)`,
      )
      .run(hash, model, JSON.stringify(embedding))
  }

  // ============================================================
  // SEARCH OPERATIONS
  // ============================================================

  /**
   * FTS5 BM25 keyword search
   */
  searchFts(query: string, limit: number = 15): Array<{ chunkId: number; rank: number }> {
    try {
      const rows = this.db
        .prepare(
          `SELECT chunk_id, rank
           FROM chunks_fts
           WHERE chunks_fts MATCH ?
           ORDER BY rank
           LIMIT ?`,
        )
        .all(query, limit) as Array<{ chunk_id: number; rank: number }>
      return rows.map((r) => ({ chunkId: r.chunk_id, rank: r.rank }))
    } catch {
      // FTS query syntax error — return empty
      return []
    }
  }

  /**
   * Vector cosine similarity search
   */
  searchVector(
    embedding: number[],
    limit: number = 15,
  ): Array<{ chunkId: number; distance: number }> {
    const dims = this.getDimensions()
    if (!dims) return []

    const jsonVec = JSON.stringify(embedding)
    const rows = this.db
      .prepare(
        `SELECT rowid, distance
         FROM chunks_vec
         WHERE embedding MATCH ?
         ORDER BY distance
         LIMIT ?`,
      )
      .all(jsonVec, limit) as Array<{
      rowid: number | bigint
      distance: number
    }>
    return rows.map((r) => ({
      chunkId: Number(r.rowid),
      distance: r.distance,
    }))
  }

  // ============================================================
  // STATUS
  // ============================================================

  getStatus(): MemoryStatus {
    const filesCount = (
      this.db.prepare('SELECT COUNT(*) as count FROM files').get() as {
        count: number
      }
    ).count
    const chunksCount = (
      this.db.prepare('SELECT COUNT(*) as count FROM chunks').get() as {
        count: number
      }
    ).count
    const meta = this.getIndexMeta()

    return {
      filesIndexed: filesCount,
      totalChunks: chunksCount,
      lastSync: meta.builtAt || null,
      embeddingsReady: meta.dimensions !== null,
      embeddingsPlugin: meta.embeddingsPlugin,
      embeddingsModel: meta.embeddingsModel,
      dimensions: meta.dimensions,
    }
  }

  // ============================================================
  // MAINTENANCE
  // ============================================================

  /**
   * Clear all data (for rebuild)
   */
  clearAll(): void {
    this.db.prepare('DELETE FROM chunks_fts').run()
    // chunks_vec only exists when dimensions are set
    if (this.dimensions) {
      try {
        this.db.prepare('DELETE FROM chunks_vec').run()
      } catch {
        // Table doesn't exist, that's fine
      }
    }
    this.db.prepare('DELETE FROM chunks').run()
    this.db.prepare('DELETE FROM files').run()
    this.db.prepare('DELETE FROM embedding_cache').run()
  }

  /**
   * Close the database connection
   */
  close(): void {
    this.db.close()
  }
}
