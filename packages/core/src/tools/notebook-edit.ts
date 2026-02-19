/**
 * Notebook Edit Tool
 *
 * Section-based file editing for Nina to manage her own configuration files.
 * Enables the "learnable" philosophy — user feedback creates standing orders.
 *
 * Security: Only edits files in allowed directories (.my_agent/).
 * Format: Markdown-aware, respects heading hierarchy.
 */

import { readFile, writeFile, stat } from 'node:fs/promises'
import { dirname, resolve, relative, isAbsolute } from 'node:path'
import { existsSync, mkdirSync } from 'node:fs'

/**
 * Supported operations for notebook editing
 */
export type NotebookOperation = 'read' | 'write' | 'append' | 'delete'

/**
 * Parameters for notebook_edit operations
 */
export interface NotebookEditParams {
  /** File path (relative to agent directory or absolute within allowed paths) */
  path: string

  /** Operation to perform */
  operation: NotebookOperation

  /** Section heading text (e.g., "## Notification Preferences") */
  section: string

  /** Content for write/append operations */
  content?: string
}

/**
 * Result of a notebook_edit operation
 */
export interface NotebookEditResult {
  success: boolean
  message: string
  content?: string // For read operations
}

/**
 * Configuration for the notebook editor
 */
export interface NotebookEditorConfig {
  /** Agent directory (.my_agent path) */
  agentDir: string

  /** Allowed subdirectories within agent dir (default: ['brain', 'runtime']) */
  allowedPaths?: string[]
}

/**
 * Default allowed paths within agent directory
 */
const DEFAULT_ALLOWED_PATHS = ['brain', 'runtime']

/**
 * Validate that a path is within allowed directories
 */
function validatePath(
  targetPath: string,
  agentDir: string,
  allowedPaths: string[],
): { valid: boolean; error?: string; absolutePath?: string } {
  // Resolve to absolute path
  let absolutePath: string
  if (isAbsolute(targetPath)) {
    absolutePath = resolve(targetPath)
  } else {
    absolutePath = resolve(agentDir, targetPath)
  }

  // Ensure path is within agent directory
  const relativePath = relative(agentDir, absolutePath)
  if (relativePath.startsWith('..') || isAbsolute(relativePath)) {
    return { valid: false, error: 'Path must be within agent directory' }
  }

  // Check if path is in allowed subdirectories
  const firstDir = relativePath.split('/')[0]
  if (!allowedPaths.includes(firstDir)) {
    return {
      valid: false,
      error: `Path must be in one of: ${allowedPaths.join(', ')}`,
    }
  }

  return { valid: true, absolutePath }
}

/**
 * Parse markdown file into sections
 */
function parseSections(
  content: string,
): Map<string, { start: number; end: number; content: string }> {
  const sections = new Map<string, { start: number; end: number; content: string }>()
  const lines = content.split('\n')

  let currentHeading: string | null = null
  let currentStart = 0

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // Match markdown headings (## or ### etc.)
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/)

    if (headingMatch) {
      // Save previous section
      if (currentHeading !== null) {
        sections.set(currentHeading, {
          start: currentStart,
          end: i - 1,
          content: lines
            .slice(currentStart + 1, i)
            .join('\n')
            .trim(),
        })
      }

      // Start new section
      currentHeading = line.trim()
      currentStart = i
    }
  }

  // Save final section
  if (currentHeading !== null) {
    sections.set(currentHeading, {
      start: currentStart,
      end: lines.length - 1,
      content: lines
        .slice(currentStart + 1)
        .join('\n')
        .trim(),
    })
  }

  return sections
}

/**
 * Rebuild markdown file from sections
 */
function rebuildContent(
  originalContent: string,
  sections: Map<string, { start: number; end: number; content: string }>,
): string {
  const lines = originalContent.split('\n')
  const result: string[] = []
  let lastEnd = -1

  // Sort sections by start line
  const sortedSections = Array.from(sections.entries()).sort((a, b) => a[1].start - b[1].start)

  for (const [heading, section] of sortedSections) {
    // Add any lines before this section that weren't part of a section
    if (lastEnd + 1 < section.start) {
      result.push(...lines.slice(lastEnd + 1, section.start))
    }

    // Add the heading
    result.push(heading)

    // Add section content (if not empty)
    if (section.content) {
      result.push('')
      result.push(section.content)
    }

    result.push('')
    lastEnd = section.end
  }

  // Add any trailing content after last section
  if (lastEnd + 1 < lines.length) {
    result.push(...lines.slice(lastEnd + 1))
  }

  return result.join('\n').trimEnd() + '\n'
}

/**
 * NotebookEditor — section-based markdown file editing
 */
export class NotebookEditor {
  private agentDir: string
  private allowedPaths: string[]

  constructor(config: NotebookEditorConfig) {
    this.agentDir = config.agentDir
    this.allowedPaths = config.allowedPaths ?? DEFAULT_ALLOWED_PATHS
  }

  /**
   * Execute a notebook edit operation
   */
  async edit(params: NotebookEditParams): Promise<NotebookEditResult> {
    // Validate path
    const validation = validatePath(params.path, this.agentDir, this.allowedPaths)
    if (!validation.valid) {
      return { success: false, message: validation.error! }
    }

    const absolutePath = validation.absolutePath!

    // Ensure section heading is properly formatted
    const sectionHeading = params.section.trim()
    if (!sectionHeading.startsWith('#')) {
      return { success: false, message: 'Section must be a markdown heading (start with #)' }
    }

    switch (params.operation) {
      case 'read':
        return this.readSection(absolutePath, sectionHeading)
      case 'write':
        return this.writeSection(absolutePath, sectionHeading, params.content ?? '')
      case 'append':
        return this.appendToSection(absolutePath, sectionHeading, params.content ?? '')
      case 'delete':
        return this.deleteSection(absolutePath, sectionHeading)
      default:
        return { success: false, message: `Unknown operation: ${params.operation}` }
    }
  }

  /**
   * Read a section from a file
   */
  private async readSection(path: string, section: string): Promise<NotebookEditResult> {
    try {
      const content = await readFile(path, 'utf-8')
      const sections = parseSections(content)

      const sectionData = sections.get(section)
      if (!sectionData) {
        return { success: false, message: `Section not found: ${section}` }
      }

      return {
        success: true,
        message: 'Section read successfully',
        content: sectionData.content,
      }
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        return { success: false, message: 'File not found' }
      }
      return { success: false, message: `Error reading file: ${err.message}` }
    }
  }

  /**
   * Write (replace) a section in a file
   */
  private async writeSection(
    path: string,
    section: string,
    newContent: string,
  ): Promise<NotebookEditResult> {
    try {
      // Ensure directory exists
      const dir = dirname(path)
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true })
      }

      let content: string
      try {
        content = await readFile(path, 'utf-8')
      } catch {
        // File doesn't exist, create with just this section
        content = `${section}\n\n${newContent}\n`
        await writeFile(path, content, 'utf-8')
        return { success: true, message: 'Section created in new file' }
      }

      const sections = parseSections(content)

      if (!sections.has(section)) {
        // Section doesn't exist, append it
        content = content.trimEnd() + `\n\n${section}\n\n${newContent}\n`
        await writeFile(path, content, 'utf-8')
        return { success: true, message: 'Section added to file' }
      }

      // Update existing section
      const sectionData = sections.get(section)!
      sections.set(section, { ...sectionData, content: newContent })

      const newFileContent = rebuildContent(content, sections)
      await writeFile(path, newFileContent, 'utf-8')

      return { success: true, message: 'Section updated' }
    } catch (err: any) {
      return { success: false, message: `Error writing file: ${err.message}` }
    }
  }

  /**
   * Append content to a section
   */
  private async appendToSection(
    path: string,
    section: string,
    newContent: string,
  ): Promise<NotebookEditResult> {
    try {
      // Ensure directory exists
      const dir = dirname(path)
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true })
      }

      let content: string
      try {
        content = await readFile(path, 'utf-8')
      } catch {
        // File doesn't exist, create with just this section
        content = `${section}\n\n${newContent}\n`
        await writeFile(path, content, 'utf-8')
        return { success: true, message: 'Section created in new file' }
      }

      const sections = parseSections(content)

      if (!sections.has(section)) {
        // Section doesn't exist, add it
        content = content.trimEnd() + `\n\n${section}\n\n${newContent}\n`
        await writeFile(path, content, 'utf-8')
        return { success: true, message: 'Section added to file' }
      }

      // Append to existing section
      const sectionData = sections.get(section)!
      const existingContent = sectionData.content
      const updatedContent = existingContent ? `${existingContent}\n${newContent}` : newContent
      sections.set(section, { ...sectionData, content: updatedContent })

      const newFileContent = rebuildContent(content, sections)
      await writeFile(path, newFileContent, 'utf-8')

      return { success: true, message: 'Content appended to section' }
    } catch (err: any) {
      return { success: false, message: `Error writing file: ${err.message}` }
    }
  }

  /**
   * Delete a section from a file
   */
  private async deleteSection(path: string, section: string): Promise<NotebookEditResult> {
    try {
      const content = await readFile(path, 'utf-8')
      const sections = parseSections(content)

      if (!sections.has(section)) {
        return { success: false, message: `Section not found: ${section}` }
      }

      sections.delete(section)

      // Rebuild file without the section
      const lines = content.split('\n')
      const sectionData = parseSections(content).get(section)!
      const newLines = [...lines.slice(0, sectionData.start), ...lines.slice(sectionData.end + 1)]

      const newContent =
        newLines
          .join('\n')
          .replace(/\n{3,}/g, '\n\n')
          .trim() + '\n'
      await writeFile(path, newContent, 'utf-8')

      return { success: true, message: 'Section deleted' }
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        return { success: false, message: 'File not found' }
      }
      return { success: false, message: `Error deleting section: ${err.message}` }
    }
  }
}

/**
 * Create the default standing orders template
 */
export function getStandingOrdersTemplate(): string {
  return `# Standing Orders

Instructions Nina has learned from user feedback.
Review these at conversation start and apply them to your behavior.

## Notification Preferences

How and when to notify the user.

## Communication Style

Tone, formality, and format preferences.

## Task Handling

When to proceed autonomously vs when to ask.

## Off-Limits

Things Nina should never do automatically.

---

*Last updated: ${new Date().toISOString().split('T')[0]}*
`
}

/**
 * Initialize standing orders file if it doesn't exist
 */
export async function initializeStandingOrders(agentDir: string): Promise<void> {
  const standingOrdersPath = resolve(agentDir, 'brain', 'standing-orders.md')

  // Check if file exists
  try {
    await stat(standingOrdersPath)
    // File exists, don't overwrite
    return
  } catch {
    // File doesn't exist, create it
  }

  // Ensure directory exists
  const dir = dirname(standingOrdersPath)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }

  await writeFile(standingOrdersPath, getStandingOrdersTemplate(), 'utf-8')
  console.log('[NotebookEdit] Initialized standing-orders.md')
}
