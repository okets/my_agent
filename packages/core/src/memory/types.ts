/**
 * Memory System Types
 * @module memory/types
 */

// ============================================================
// FILE TRACKING
// ============================================================

export interface FileRecord {
  path: string // Relative to notebook/ root
  hash: string // SHA256 of file content
  mtime: string // ISO 8601 modified time
  size: number // File size in bytes
  indexedAt: string // When we last indexed this file
  indexedWithEmbeddings: boolean // True if embeddings were generated during indexing
}

// ============================================================
// CHUNKS
// ============================================================

export interface Chunk {
  id: number
  filePath: string
  heading: string | null // Nearest H1/H2 heading above chunk
  startLine: number
  endLine: number
  text: string
  hash: string // SHA256 of chunk text
}

export interface ChunkWithEmbedding extends Chunk {
  embedding: number[] | null
}

// ============================================================
// SEARCH
// ============================================================

export interface SearchResult {
  filePath: string
  heading: string | null
  snippet: string // ~200 chars of matched text
  score: number // 0.0 - 1.0 (hybrid BM25 + vector)
  lines: { start: number; end: number }
}

export interface RecallResult {
  notebook: SearchResult[] // lists/ + reference/ + knowledge/
  daily: SearchResult[] // daily/
  degraded?: {
    pluginName: string
    error: string
    resolution: string
  }
}

export interface SearchOptions {
  maxResults?: number // Default: 15
  minScore?: number // Default: 0.25
}

// ============================================================
// SYNC
// ============================================================

export interface SyncResult {
  added: number
  updated: number
  removed: number
  errors: string[]
  duration: number // ms
}

export interface SyncOptions {
  fullSync?: boolean // Force full reindex
  paths?: string[] // Specific paths to sync
}

// ============================================================
// INDEX METADATA
// ============================================================

export interface IndexMeta {
  embeddingsPlugin: string | null
  embeddingsModel: string | null
  dimensions: number | null
  chunkTokens: number
  chunkOverlap: number
  builtAt: string
}

// ============================================================
// MEMORY STATUS
// ============================================================

export interface MemoryStatus {
  filesIndexed: number
  totalChunks: number
  lastSync: string | null
  embeddingsReady: boolean
  embeddingsPlugin: string | null
  embeddingsModel: string | null
  dimensions: number | null
}
