/**
 * Memory Agent Tools
 * Tools for Nina to interact with her notebook memory.
 *
 * @module memory/tools
 */

import { readFile } from 'fs/promises'
import { join } from 'path'
import { existsSync } from 'fs'
import type { SearchService } from './search-service.js'
import type { RecallResult, SearchOptions } from './types.js'

export interface MemoryToolsOptions {
  notebookDir: string
  searchService: SearchService
}

/**
 * recall(query, options) — Search notebook and daily logs
 *
 * Performs hybrid search (semantic + keyword) across the notebook.
 * Results are grouped by type: notebook (lists, reference, knowledge) and daily logs.
 */
export async function recall(
  searchService: SearchService,
  query: string,
  options?: SearchOptions,
): Promise<RecallResult> {
  return searchService.recall(query, options)
}

export interface NotebookReadOptions {
  startLine?: number
  lines?: number
}

/**
 * notebook_read(path, options) — Direct file read from notebook
 *
 * Reads a specific file from the notebook. Use this when you know
 * exactly which file you need, rather than searching.
 *
 * @param notebookDir - Base notebook directory
 * @param path - Path relative to notebook/, e.g. "reference/contacts.md"
 * @param options - Optional line range
 */
export async function notebookRead(
  notebookDir: string,
  path: string,
  options?: NotebookReadOptions,
): Promise<string> {
  // Sanitize path to prevent directory traversal
  const sanitizedPath = path.replace(/\.\./g, '').replace(/^\/+/, '')
  const fullPath = join(notebookDir, sanitizedPath)

  // Verify the path is within notebook directory
  if (!fullPath.startsWith(notebookDir)) {
    throw new Error('Invalid path: must be within notebook directory')
  }

  if (!existsSync(fullPath)) {
    throw new Error(`File not found: ${sanitizedPath}`)
  }

  const content = await readFile(fullPath, 'utf-8')

  // Apply line filtering if specified
  if (options?.startLine !== undefined || options?.lines !== undefined) {
    const lines = content.split('\n')
    const start = (options.startLine ?? 1) - 1 // Convert to 0-indexed
    const count = options.lines ?? lines.length - start
    return lines.slice(start, start + count).join('\n')
  }

  return content
}

/**
 * Format recall results for display to the agent.
 */
export function formatRecallResults(results: RecallResult): string {
  const lines: string[] = []

  if (results.notebook.length > 0) {
    lines.push(`NOTEBOOK (${results.notebook.length} results)`)
    for (const result of results.notebook) {
      const heading = result.heading ? ` > ${result.heading}` : ''
      lines.push(
        `  ${result.filePath}:${result.lines.start}${heading} [${result.score.toFixed(2)}]`,
      )
      lines.push(`    "${result.snippet}"`)
    }
  }

  if (results.daily.length > 0) {
    if (lines.length > 0) lines.push('')
    lines.push(`DAILY (${results.daily.length} results)`)
    for (const result of results.daily) {
      lines.push(`  ${result.filePath}:${result.lines.start} [${result.score.toFixed(2)}]`)
      lines.push(`    "${result.snippet}"`)
    }
  }

  if (results.notebook.length === 0 && results.daily.length === 0) {
    lines.push('No results found.')
  }

  return lines.join('\n')
}
