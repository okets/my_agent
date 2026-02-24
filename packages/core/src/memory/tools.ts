/**
 * Memory Agent Tools
 * Tools for Nina to interact with her notebook memory.
 *
 * @module memory/tools
 */

import { readFile, writeFile, mkdir } from 'fs/promises'
import { join, dirname, resolve, normalize } from 'path'
import { existsSync } from 'fs'
import type { SearchService } from './search-service.js'
import type { RecallResult, SearchOptions } from './types.js'

// ============================================================================
// Types
// ============================================================================

export type RememberCategory = 'lists' | 'reference' | 'knowledge'

export interface RememberParams {
  content: string
  category?: RememberCategory
  file?: string
  section?: string
}

export interface RememberResult {
  success: boolean
  file: string
  section: string | null
  message: string
}

export interface DailyLogParams {
  entry: string
}

export interface DailyLogResult {
  success: boolean
  file: string
  timestamp: string
}

export interface NotebookWriteParams {
  path: string
  content: string
  section?: string
  replace?: boolean
}

export interface NotebookWriteResult {
  success: boolean
  message: string
}

export interface ConversationSearchParams {
  query: string
  maxResults?: number
  channel?: string
}

export interface ConversationSearchResult {
  conversationId: string
  channel: string | null
  timestamp: string
  turnNumber: number
  snippet: string
}

export interface ConversationSearchResponse {
  results: ConversationSearchResult[]
  total: number
}

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
  inputPath: string,
  options?: NotebookReadOptions,
): Promise<string> {
  // Resolve the full path and check for directory traversal
  const normalizedNotebook = resolve(notebookDir)
  const fullPath = resolve(notebookDir, inputPath)

  // Verify the resolved path is within notebook directory
  if (!fullPath.startsWith(normalizedNotebook + '/') && fullPath !== normalizedNotebook) {
    throw new Error('Invalid path: must be within notebook directory')
  }

  const sanitizedPath = fullPath.slice(normalizedNotebook.length + 1)

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

// ============================================================================
// remember() — Intent-based memory write
// ============================================================================

/**
 * Infer the appropriate category and file from content.
 */
function inferDestination(content: string): { category: RememberCategory; file: string } {
  const lowerContent = content.toLowerCase()

  // Contact patterns
  if (
    lowerContent.includes('phone') ||
    lowerContent.includes('email') ||
    lowerContent.includes('contact') ||
    lowerContent.includes('@') ||
    /\+?\d{10,}/.test(content)
  ) {
    return { category: 'reference', file: 'contacts.md' }
  }

  // Preference patterns
  if (
    lowerContent.includes('prefer') ||
    lowerContent.includes('like') ||
    lowerContent.includes('dislike') ||
    lowerContent.includes('always') ||
    lowerContent.includes('never')
  ) {
    return { category: 'reference', file: 'preferences.md' }
  }

  // Todo/task patterns
  if (
    lowerContent.includes('todo') ||
    lowerContent.includes('task') ||
    lowerContent.includes('remind') ||
    lowerContent.startsWith('- [ ]')
  ) {
    return { category: 'lists', file: 'todos.md' }
  }

  // Shopping patterns
  if (
    lowerContent.includes('buy') ||
    lowerContent.includes('shopping') ||
    lowerContent.includes('grocery')
  ) {
    return { category: 'lists', file: 'shopping.md' }
  }

  // Default to knowledge/facts
  return { category: 'knowledge', file: 'facts.md' }
}

/**
 * Find or create a section in markdown content.
 * Returns the updated content with the new text appended under the section.
 */
function appendToSection(content: string, section: string, text: string): string {
  const lines = content.split('\n')
  const sectionHeader = `## ${section}`
  let sectionIndex = -1

  // Find the section
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === sectionHeader) {
      sectionIndex = i
      break
    }
  }

  if (sectionIndex === -1) {
    // Section doesn't exist, append at end
    const trimmedContent = content.trimEnd()
    return `${trimmedContent}\n\n${sectionHeader}\n\n${text}\n`
  }

  // Find the next section or end of file
  let insertIndex = lines.length
  for (let i = sectionIndex + 1; i < lines.length; i++) {
    if (lines[i].startsWith('## ')) {
      insertIndex = i
      break
    }
  }

  // Insert before the next section (or at end)
  // Find last non-empty line before insertIndex
  let lastContentLine = insertIndex - 1
  while (lastContentLine > sectionIndex && lines[lastContentLine].trim() === '') {
    lastContentLine--
  }

  // Insert after the last content line of this section
  lines.splice(lastContentLine + 1, 0, '', text)
  return lines.join('\n')
}

/**
 * remember(params) — Intent-based memory write
 *
 * Routes content to the appropriate notebook file based on category/intent.
 * Creates files and sections as needed.
 */
export async function remember(
  notebookDir: string,
  params: RememberParams,
): Promise<RememberResult> {
  const { content, category, file, section } = params

  // Determine destination
  let targetCategory: RememberCategory
  let targetFile: string

  if (category && file) {
    targetCategory = category
    targetFile = file.endsWith('.md') ? file : `${file}.md`
  } else if (category) {
    // Category specified, infer file
    const inferred = inferDestination(content)
    targetCategory = category
    targetFile = inferred.file
  } else {
    // Infer both
    const inferred = inferDestination(content)
    targetCategory = inferred.category
    targetFile = file ? (file.endsWith('.md') ? file : `${file}.md`) : inferred.file
  }

  const filePath = join(notebookDir, targetCategory, targetFile)

  // Ensure directory exists
  await mkdir(dirname(filePath), { recursive: true })

  // Read existing content or start fresh
  let existingContent = ''
  if (existsSync(filePath)) {
    existingContent = await readFile(filePath, 'utf-8')
  } else {
    // Create with title from filename
    const title = targetFile.replace('.md', '').replace(/-/g, ' ')
    const capitalizedTitle = title.charAt(0).toUpperCase() + title.slice(1)
    existingContent = `# ${capitalizedTitle}\n`
  }

  // Append content
  let newContent: string
  let usedSection: string | null = null

  if (section) {
    newContent = appendToSection(existingContent, section, content)
    usedSection = section
  } else {
    // Append to end of file
    const trimmed = existingContent.trimEnd()
    newContent = `${trimmed}\n\n${content}\n`
  }

  await writeFile(filePath, newContent, 'utf-8')

  return {
    success: true,
    file: `${targetCategory}/${targetFile}`,
    section: usedSection,
    message: `Added to ${targetCategory}/${targetFile}${usedSection ? ` under "${usedSection}"` : ''}`,
  }
}

// ============================================================================
// daily_log() — Append to today's daily log
// ============================================================================

/**
 * Get today's date in YYYY-MM-DD format.
 */
function getTodayDate(): string {
  const now = new Date()
  return now.toISOString().split('T')[0]
}

/**
 * Get current time in HH:MM format.
 */
function getCurrentTime(): string {
  const now = new Date()
  return now.toTimeString().slice(0, 5)
}

/**
 * daily_log(params) — Append entry to today's daily log
 *
 * Creates the daily log file if it doesn't exist.
 * Entries are prefixed with timestamp: `- [HH:MM] entry`
 */
export async function dailyLog(
  notebookDir: string,
  params: DailyLogParams,
): Promise<DailyLogResult> {
  const { entry } = params
  const date = getTodayDate()
  const time = getCurrentTime()

  const filePath = join(notebookDir, 'daily', `${date}.md`)

  // Ensure daily directory exists
  await mkdir(dirname(filePath), { recursive: true })

  // Read existing content or create new file
  let existingContent = ''
  if (existsSync(filePath)) {
    existingContent = await readFile(filePath, 'utf-8')
  } else {
    existingContent = `# ${date}\n`
  }

  // Append timestamped entry
  const timestampedEntry = `- [${time}] ${entry}`
  const trimmed = existingContent.trimEnd()
  const newContent = `${trimmed}\n${timestampedEntry}\n`

  await writeFile(filePath, newContent, 'utf-8')

  return {
    success: true,
    file: `daily/${date}.md`,
    timestamp: time,
  }
}

// ============================================================================
// notebook_write() — Direct file write (escape hatch)
// ============================================================================

/**
 * Replace content within a specific section.
 */
function replaceSection(content: string, section: string, newText: string): string {
  const lines = content.split('\n')
  const sectionHeader = `## ${section}`
  let sectionStart = -1
  let sectionEnd = lines.length

  // Find the section
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === sectionHeader) {
      sectionStart = i
      // Find the next section
      for (let j = i + 1; j < lines.length; j++) {
        if (lines[j].startsWith('## ')) {
          sectionEnd = j
          break
        }
      }
      break
    }
  }

  if (sectionStart === -1) {
    // Section doesn't exist, append at end
    const trimmedContent = content.trimEnd()
    return `${trimmedContent}\n\n${sectionHeader}\n\n${newText}\n`
  }

  // Replace section content (keep header, replace until next section)
  const before = lines.slice(0, sectionStart + 1)
  const after = lines.slice(sectionEnd)

  return [...before, '', newText, '', ...after].join('\n')
}

/**
 * notebook_write(params) — Direct file write
 *
 * Escape hatch for precise file control. Validates path is within notebook/.
 */
// ============================================================================
// conversation_search() — Search conversation transcripts
// ============================================================================

/**
 * Raw search result from the database (passed in by dashboard).
 */
export interface RawConversationSearchResult {
  conversationId: string
  turnNumber: number
  content: string
  timestamp: string
}

/**
 * Conversation metadata (passed in by dashboard).
 */
export interface ConversationMetadata {
  id: string
  channel: string | null
}

/**
 * conversation_search(params, searchFn, getMetadataFn) — Search conversation transcripts
 *
 * Searches conversation history using FTS. Separate from notebook recall()
 * to avoid polluting notebook results with conversation noise.
 *
 * @param params - Search parameters
 * @param searchFn - Function to execute FTS search (provided by dashboard)
 * @param getMetadataFn - Function to get conversation metadata (provided by dashboard)
 */
export async function conversationSearch(
  params: ConversationSearchParams,
  searchFn: (query: string, limit: number) => RawConversationSearchResult[],
  getMetadataFn: (conversationId: string) => ConversationMetadata | null,
): Promise<ConversationSearchResponse> {
  const { query, maxResults = 10, channel } = params

  // Search with extra results to allow for channel filtering
  const rawResults = searchFn(query, channel ? maxResults * 3 : maxResults)

  const results: ConversationSearchResult[] = []

  for (const raw of rawResults) {
    const metadata = getMetadataFn(raw.conversationId)
    const convChannel = metadata?.channel ?? null

    // Filter by channel if specified
    if (channel && convChannel !== channel) {
      continue
    }

    // Extract snippet (first 200 chars)
    const snippet = raw.content.length > 200 ? raw.content.slice(0, 200) + '...' : raw.content

    results.push({
      conversationId: raw.conversationId,
      channel: convChannel,
      timestamp: raw.timestamp,
      turnNumber: raw.turnNumber,
      snippet,
    })

    if (results.length >= maxResults) {
      break
    }
  }

  return {
    results,
    total: results.length,
  }
}

/**
 * Format conversation search results for display to the agent.
 */
export function formatConversationSearchResults(response: ConversationSearchResponse): string {
  if (response.results.length === 0) {
    return 'No conversation matches found.'
  }

  const lines: string[] = [`CONVERSATIONS (${response.total} results)`]

  for (const result of response.results) {
    const channelStr = result.channel ? ` [${result.channel}]` : ''
    lines.push(`  ${result.conversationId}:${result.turnNumber}${channelStr} (${result.timestamp})`)
    lines.push(`    "${result.snippet}"`)
  }

  return lines.join('\n')
}

// ============================================================================
// Pre-Compaction Flush
// ============================================================================

/**
 * Generate a pre-compaction flush message.
 *
 * This message prompts the agent to save important memories before context
 * compression occurs. Can be injected as a system message when context
 * approaches limits.
 *
 * Usage: The dashboard can inject this message when it detects context
 * is approaching limits (e.g., via token counting or SDK events).
 */
export function getPreCompactionFlushMessage(): string {
  return `<system-reminder>
Context is approaching limits and will be compressed soon.

Before compression, please:
1. Use remember() to save any important facts from this session that aren't already in your notebook
2. Use daily_log() to note significant accomplishments or events from this conversation
3. Ensure any critical information the user shared is preserved

You can continue the conversation normally - just ensure important memories are saved first.
</system-reminder>`
}

/**
 * Check if context size warrants a pre-compaction flush.
 *
 * @param currentTokens - Current token count (if available)
 * @param maxTokens - Maximum context tokens (model-specific)
 * @param threshold - Percentage threshold (default 0.8 = 80%)
 */
export function shouldFlushBeforeCompaction(
  currentTokens: number,
  maxTokens: number,
  threshold = 0.8,
): boolean {
  return currentTokens >= maxTokens * threshold
}

// ============================================================================
// notebook_write() — Direct file write (escape hatch)
// ============================================================================

export async function notebookWrite(
  notebookDir: string,
  params: NotebookWriteParams,
): Promise<NotebookWriteResult> {
  const { path: inputPath, content, section, replace } = params

  // Resolve the full path and check for directory traversal
  // Using resolve() ensures we get the canonical path even with .. segments
  const normalizedNotebook = resolve(notebookDir)
  const fullPath = resolve(notebookDir, inputPath)

  // Verify the resolved path is within notebook directory
  if (!fullPath.startsWith(normalizedNotebook + '/') && fullPath !== normalizedNotebook) {
    return {
      success: false,
      message: 'Invalid path: must be within notebook directory',
    }
  }

  // Compute sanitized path for display
  const sanitizedPath = fullPath.slice(normalizedNotebook.length + 1)

  // Ensure directory exists
  await mkdir(dirname(fullPath), { recursive: true })

  if (section) {
    // Section-based write
    let existingContent = ''
    if (existsSync(fullPath)) {
      existingContent = await readFile(fullPath, 'utf-8')
    } else {
      // Create with title from filename
      const filename = sanitizedPath.split('/').pop() || 'Untitled'
      const title = filename.replace('.md', '').replace(/-/g, ' ')
      const capitalizedTitle = title.charAt(0).toUpperCase() + title.slice(1)
      existingContent = `# ${capitalizedTitle}\n`
    }

    let newContent: string
    if (replace) {
      newContent = replaceSection(existingContent, section, content)
    } else {
      newContent = appendToSection(existingContent, section, content)
    }

    await writeFile(fullPath, newContent, 'utf-8')
    return {
      success: true,
      message: `${replace ? 'Replaced' : 'Appended to'} section "${section}" in ${sanitizedPath}`,
    }
  } else {
    // Replace entire file
    await writeFile(fullPath, content, 'utf-8')
    return {
      success: true,
      message: `Wrote ${sanitizedPath}`,
    }
  }
}
