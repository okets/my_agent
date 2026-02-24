/**
 * Hybrid Search Service
 * Combines FTS5 BM25 and vector cosine similarity using RRF.
 *
 * @module memory/search-service
 */

import { MemoryDb } from './memory-db.js'
import type { EmbeddingsPlugin } from './embeddings/types.js'
import type { SearchResult, RecallResult, SearchOptions } from './types.js'

const DEFAULT_MAX_RESULTS = 15
const DEFAULT_MIN_SCORE = 0.25
const RRF_K = 60 // Reciprocal Rank Fusion constant

export interface SearchServiceOptions {
  db: MemoryDb
  getPlugin: () => EmbeddingsPlugin | null
}

export class SearchService {
  private db: MemoryDb
  private getPlugin: () => EmbeddingsPlugin | null

  constructor(options: SearchServiceOptions) {
    this.db = options.db
    this.getPlugin = options.getPlugin
  }

  /**
   * Search notebook and daily logs using hybrid search.
   * Results are grouped by type (notebook vs daily).
   */
  async recall(query: string, options?: SearchOptions): Promise<RecallResult> {
    const maxResults = options?.maxResults ?? DEFAULT_MAX_RESULTS
    const minScore = options?.minScore ?? DEFAULT_MIN_SCORE

    // Get ranked results using hybrid search
    const rankedResults = await this.hybridSearch(query, maxResults * 2)

    // Filter by score and convert to SearchResult format
    const results: SearchResult[] = []
    for (const [chunkId, score] of rankedResults) {
      if (score < minScore) continue

      const chunk = this.db.getChunk(chunkId)
      if (!chunk) continue

      results.push({
        filePath: chunk.filePath,
        heading: chunk.heading,
        snippet: this.extractSnippet(chunk.text, query),
        score,
        lines: { start: chunk.startLine, end: chunk.endLine },
      })

      if (results.length >= maxResults) break
    }

    // Group results
    const notebook: SearchResult[] = []
    const daily: SearchResult[] = []

    for (const result of results) {
      if (result.filePath.startsWith('daily/')) {
        daily.push(result)
      } else {
        notebook.push(result)
      }
    }

    return { notebook, daily }
  }

  /**
   * Hybrid search using FTS5 + vector with RRF merge.
   * Falls back to FTS5-only if embeddings unavailable.
   */
  private async hybridSearch(query: string, limit: number): Promise<Map<number, number>> {
    const scores = new Map<number, number>()

    // FTS5 BM25 search
    const ftsResults = this.db.searchFts(query, limit)
    for (let i = 0; i < ftsResults.length; i++) {
      const rrfScore = 1 / (RRF_K + i + 1)
      scores.set(ftsResults[i].chunkId, (scores.get(ftsResults[i].chunkId) ?? 0) + rrfScore)
    }

    // Vector search (if embeddings available)
    const plugin = this.getPlugin()
    if (plugin && (await plugin.isReady())) {
      try {
        const queryEmbedding = await plugin.embed(query)
        const vecResults = this.db.searchVector(queryEmbedding, limit)

        for (let i = 0; i < vecResults.length; i++) {
          const rrfScore = 1 / (RRF_K + i + 1)
          scores.set(vecResults[i].chunkId, (scores.get(vecResults[i].chunkId) ?? 0) + rrfScore)
        }
      } catch (error) {
        console.error('Vector search failed, using FTS5 only:', error)
      }
    }

    // Sort by score descending
    return new Map([...scores.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit))
  }

  /**
   * Extract a relevant snippet from chunk text.
   */
  private extractSnippet(text: string, query: string, maxLength = 200): string {
    // Find the first occurrence of any query word
    const queryWords = query.toLowerCase().split(/\s+/)
    const textLower = text.toLowerCase()

    let bestStart = 0
    for (const word of queryWords) {
      const index = textLower.indexOf(word)
      if (index !== -1) {
        // Start a bit before the match for context
        bestStart = Math.max(0, index - 30)
        break
      }
    }

    // Extract snippet
    let snippet = text.slice(bestStart, bestStart + maxLength)

    // Clean up
    if (bestStart > 0) snippet = '...' + snippet
    if (bestStart + maxLength < text.length) snippet = snippet + '...'

    return snippet.trim()
  }

  /**
   * Check if semantic search is available.
   */
  async isSemanticSearchAvailable(): Promise<boolean> {
    const plugin = this.getPlugin()
    return plugin !== null && (await plugin.isReady())
  }
}
