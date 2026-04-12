import * as path from 'node:path'
import { readFile, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { globby } from 'globby'
import { parse as parseYaml } from 'yaml'
import type { Capability } from './capabilities/types.js'
import { loadPreferences } from './config.js'

const DEFAULT_PERSONALITY_PATH = path.resolve(
  import.meta.dirname,
  '../defaults/personalities/partner.md',
)

const BRAIN_FILES = [
  { rel: 'AGENTS.md', header: null },
  { rel: 'memory/core/identity.md', header: '## Identity' },
  { rel: 'memory/core/contacts.md', header: '## Key People' },
  { rel: 'memory/core/preferences.md', header: '## Preferences' },
]

// Legacy notebook files from runtime directory (backward compat)
const LEGACY_NOTEBOOK_FILES = [
  { rel: '../runtime/external-communications.md', header: '## External Communications Rules' },
  { rel: '../runtime/reminders.md', header: '## Reminders' },
  { rel: '../runtime/standing-orders.md', header: '## Standing Orders' },
]

// Per-file token limit to prevent prompt bloat (~4 chars per token)
const MAX_NOTEBOOK_CHARS = 8000
// Total limit for all reference files combined
const MAX_REFERENCE_TOTAL_CHARS = 32000

// Directories to exclude from the notebook tree (test artifacts, etc.)
const NOTEBOOK_TREE_IGNORE = new Set(['.DS_Store', 'Thumbs.db'])

// Note: SKILL_CONTENT_FILES and ALWAYS_ON_SKILLS removed in M9.2-S7.
// conversation-role, notebook (memory-tools), task-triage, and operational-rules
// now load via framework level:brain scan from repo-root skills/ directory.

/**
 * Format scheduled task context for inclusion in system prompt.
 * Used when CalendarScheduler fires a scheduled task.
 */
function formatScheduledTaskContext(task: ScheduledTaskContext): string {
  const lines = [
    '## Triggered Scheduled Task',
    '',
    'A scheduled task just fired. Review and take appropriate action.',
    '',
    `**Task:** ${task.title}`,
    `**Time:** ${task.start}${task.end ? ` - ${task.end}` : ''}`,
    `**Calendar:** ${task.calendarId}`,
  ]

  if (task.description) {
    lines.push(`**Description:** ${task.description}`)
  }

  if (task.action) {
    lines.push(`**Action:** ${task.action}`)
  }

  lines.push('')
  lines.push(
    'Respond naturally. If this is a reminder, acknowledge it. ' +
      'If it has an action field, handle it appropriately.',
  )

  return lines.join('\n')
}

async function readOptionalFile(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, 'utf-8')
  } catch {
    return null
  }
}

/**
 * Get today's date in YYYY-MM-DD format.
 */
function getTodayDate(): string {
  return new Date().toISOString().split('T')[0]
}

/**
 * Get yesterday's date in YYYY-MM-DD format.
 */
function getYesterdayDate(): string {
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  return yesterday.toISOString().split('T')[0]
}

/**
 * Build a concise directory tree of the notebook for system prompt inclusion.
 * Helps the brain know exactly which files exist and where.
 */
async function buildNotebookTree(agentDir: string): Promise<string | null> {
  const notebookDir = path.join(agentDir, 'notebook')

  if (!existsSync(notebookDir)) {
    return null
  }

  const lines: string[] = []

  async function walk(dir: string, prefix: string): Promise<void> {
    let entries: string[]
    try {
      entries = await readdir(dir)
    } catch {
      return
    }

    const filtered = entries.filter((e) => !NOTEBOOK_TREE_IGNORE.has(e)).sort()

    for (const entry of filtered) {
      const fullPath = path.join(dir, entry)
      let isDir = false
      try {
        const { statSync } = await import('node:fs')
        isDir = statSync(fullPath).isDirectory()
      } catch {
        continue
      }

      if (isDir) {
        lines.push(`${prefix}${entry}/`)
        await walk(fullPath, prefix + '  ')
      } else {
        lines.push(`${prefix}${entry}`)
      }
    }
  }

  await walk(notebookDir, '  ')

  if (lines.length === 0) {
    return null
  }

  return `## Notebook Directory\n\nThese are the files currently in your notebook. Use exact paths when reading/writing.\n\n\`\`\`\nnotebook/\n${lines.join('\n')}\n\`\`\``
}

/**
 * Load all files from notebook/reference/ directory recursively.
 * Returns formatted sections up to MAX_REFERENCE_TOTAL_CHARS total.
 * Files are sorted alphabetically by their full relative path for deterministic ordering.
 */
async function loadNotebookReference(agentDir: string): Promise<string | null> {
  const referenceDir = path.join(agentDir, 'notebook', 'reference')

  if (!existsSync(referenceDir)) {
    return null
  }

  let relPaths: string[]
  try {
    relPaths = await globby('**/*.md', { cwd: referenceDir })
  } catch {
    return null
  }

  // Sort alphabetically by relative path for deterministic ordering
  relPaths.sort()

  const sections: string[] = []
  let totalChars = 0

  for (const relPath of relPaths) {
    const filePath = path.join(referenceDir, relPath)
    let content = await readOptionalFile(filePath)
    if (!content || content.trim() === '') continue

    // Truncate individual file if too large
    if (content.length > MAX_NOTEBOOK_CHARS) {
      content = content.substring(0, MAX_NOTEBOOK_CHARS) + '\n\n[... truncated ...]'
    }

    // Check total limit
    if (totalChars + content.length > MAX_REFERENCE_TOTAL_CHARS) {
      console.warn(`[Prompt] Reference files exceed ${MAX_REFERENCE_TOTAL_CHARS} chars, stopping`)
      break
    }

    // Format with header derived from filename (basename without extension)
    const basename = path.basename(relPath, '.md')
    const name = basename.replace(/-/g, ' ')
    const capitalizedName = name.charAt(0).toUpperCase() + name.slice(1)
    sections.push(`### ${capitalizedName}\n\n${content.trim()}`)
    totalChars += content.length
  }

  if (sections.length === 0) {
    return null
  }

  return `## Your Notebook (Reference)\n\n${sections.join('\n\n')}`
}

/**
 * Load all files from notebook/operations/ directory.
 * These are Nina's operational rules (standing orders, external communications).
 * Returns formatted sections up to MAX_REFERENCE_TOTAL_CHARS total.
 */
async function loadNotebookOperations(agentDir: string): Promise<string | null> {
  const operationsDir = path.join(agentDir, 'notebook', 'operations')

  if (!existsSync(operationsDir)) {
    return null
  }

  let entries: string[]
  try {
    entries = await readdir(operationsDir)
  } catch {
    return null
  }

  const sections: string[] = []
  let totalChars = 0

  // Sort entries for consistent ordering
  for (const entry of entries.sort()) {
    if (!entry.endsWith('.md')) continue

    const filePath = path.join(operationsDir, entry)
    let content = await readOptionalFile(filePath)
    if (!content || content.trim() === '') continue

    // Truncate individual file if too large
    if (content.length > MAX_NOTEBOOK_CHARS) {
      content = content.substring(0, MAX_NOTEBOOK_CHARS) + '\n\n[... truncated ...]'
    }

    // Check total limit
    if (totalChars + content.length > MAX_REFERENCE_TOTAL_CHARS) {
      console.warn(`[Prompt] Operations files exceed ${MAX_REFERENCE_TOTAL_CHARS} chars, stopping`)
      break
    }

    // Format with header derived from filename
    const name = entry.replace('.md', '').replace(/-/g, ' ')
    const capitalizedName = name.charAt(0).toUpperCase() + name.slice(1)
    sections.push(`### ${capitalizedName}\n\n${content.trim()}`)
    totalChars += content.length
  }

  if (sections.length === 0) {
    return null
  }

  return `## Operating Rules\n\n${sections.join('\n\n')}`
}

/**
 * Load notebook/properties/status.yaml and format it as a dynamic status block.
 * Returns null if the file does not exist or cannot be parsed.
 */
export async function loadProperties(agentDir: string): Promise<string | null> {
  const propsFile = path.join(agentDir, 'notebook', 'properties', 'status.yaml')

  const content = await readOptionalFile(propsFile)
  if (!content || content.trim() === '') {
    return null
  }

  let data: Record<string, { value: string; confidence?: string; updated?: string; source?: string }>
  try {
    data = parseYaml(content)
  } catch {
    console.warn('[Prompt] Failed to parse status.yaml')
    return null
  }

  if (!data || typeof data !== 'object') {
    return null
  }

  const lines: string[] = ['[Dynamic Status]']

  for (const [key, entry] of Object.entries(data)) {
    if (!entry || typeof entry !== 'object' || !entry.value) continue

    const label = key.charAt(0).toUpperCase() + key.slice(1)
    const parts = [entry.value]
    if (entry.confidence) {
      parts.push(`${entry.confidence} confidence`)
    }
    if (entry.updated) {
      parts.push(`updated ${entry.updated}`)
    }

    lines.push(`${label}: ${parts[0]} (${parts.slice(1).join(', ')})`)
  }

  // Check for timezone mismatch: auto-detected (properties) vs configured (config.yaml)
  if (data.timezone?.value) {
    const detected = data.timezone.value.split(/\s*\(/)[0].trim()
    try {
      const prefs = loadPreferences(agentDir)
      if (prefs.timezone && detected !== prefs.timezone) {
        lines.push('')
        lines.push(
          `[ACTION REQUIRED] Detected timezone "${detected}" (from ${data.timezone.source ?? 'conversation'}, ` +
          `${data.timezone.updated ?? 'unknown date'}) differs from your configured timezone "${prefs.timezone}". ` +
          `Ask the user if they want to switch. Do NOT switch automatically.`
        )
      }
    } catch {
      // Config unavailable — skip mismatch check
    }
  }

  lines.push('[End Dynamic Status]')

  if (lines.length <= 2) {
    return null
  }

  return lines.join('\n')
}

/**
 * Load active automation hints for brain system prompt.
 * Reads from .my_agent/automations/*.md frontmatter.
 * Returns compact format: ~50 chars per automation.
 * At 50+ automations, returns pull-model instruction.
 */
export async function loadAutomationHints(agentDir: string): Promise<string | null> {
  const automationsDir = path.join(agentDir, 'automations')
  if (!existsSync(automationsDir)) return null

  let mdFiles: string[]
  try {
    const files = await readdir(automationsDir)
    mdFiles = files.filter((f) => f.endsWith('.md')).sort()
  } catch {
    return null
  }

  if (mdFiles.length === 0) return null
  if (mdFiles.length > 50) {
    return '## Active Automations\n\nYou have 50+ automations. Use the list_automations tool to search and discover them.'
  }

  const lines: string[] = [
    '## Active Automations',
    '',
    "You have these standing instructions. When a user's message matches one, call fire_automation().",
    '',
  ]

  for (const file of mdFiles) {
    try {
      const content = await readFile(path.join(automationsDir, file), 'utf-8')
      const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)
      if (!fmMatch) continue
      const data = parseYaml(fmMatch[1]) as Record<string, unknown>
      if (data.status !== 'active') continue
      if (data.system === true) continue
      const name = (data.name as string) ?? file.replace('.md', '')
      const triggers = (data.trigger ?? []) as Array<Record<string, unknown>>
      const hints = triggers
        .filter((t) => t.type === 'channel' && t.hint)
        .map((t) => t.hint as string)
        .join(', ')
      const triggerTypes = [...new Set(triggers.map((t) => t.type as string))].join(', ')
      const spaces = ((data.spaces as string[]) ?? []).join(', ')
      let line = `- ${name} (${triggerTypes}`
      if (hints) line += `, hints: ${hints}`
      line += ')'
      if (spaces) line += ` -> ${spaces}`
      lines.push(line)
    } catch {
      // Skip malformed files
    }
  }

  return lines.length > 4 ? lines.join('\n') : null
}

/**
 * Load today's and yesterday's daily logs.
 */
async function loadDailyLogs(agentDir: string): Promise<string | null> {
  const dailyDir = path.join(agentDir, 'notebook', 'daily')

  if (!existsSync(dailyDir)) {
    return null
  }

  const today = getTodayDate()
  const yesterday = getYesterdayDate()

  const sections: string[] = []

  // Today's log
  const todayContent = await readOptionalFile(path.join(dailyDir, `${today}.md`))
  if (todayContent && todayContent.trim()) {
    let content = todayContent
    if (content.length > MAX_NOTEBOOK_CHARS) {
      content = content.substring(0, MAX_NOTEBOOK_CHARS) + '\n\n[... truncated ...]'
    }
    sections.push(`### Today (${today})\n\n${content.trim()}`)
  }

  // Yesterday's log
  const yesterdayContent = await readOptionalFile(path.join(dailyDir, `${yesterday}.md`))
  if (yesterdayContent && yesterdayContent.trim()) {
    let content = yesterdayContent
    if (content.length > MAX_NOTEBOOK_CHARS) {
      content = content.substring(0, MAX_NOTEBOOK_CHARS) + '\n\n[... truncated ...]'
    }
    sections.push(`### Yesterday (${yesterday})\n\n${content.trim()}`)
  }

  if (sections.length === 0) {
    return null
  }

  return `## Recent Daily Logs\n\n${sections.join('\n\n')}`
}

/**
 * Check if notebook/reference has any content (including subdirectories).
 * Used to determine if we should fall back to legacy runtime files.
 */
async function hasNotebookReference(agentDir: string): Promise<boolean> {
  const referenceDir = path.join(agentDir, 'notebook', 'reference')

  if (!existsSync(referenceDir)) {
    return false
  }

  try {
    const matches = await globby('**/*.md', { cwd: referenceDir })
    return matches.length > 0
  } catch {
    return false
  }
}


/**
 * Format capability registry entries for inclusion in the system prompt.
 * Shows both available and unavailable capabilities with reasons.
 */
export function loadCapabilityHints(capabilities: Capability[]): string | null {
  if (capabilities.length === 0) {
    return [
      '## Capabilities',
      '',
      'No capabilities installed. If the user asks for a new ability (voice, image generation, etc.), use the capability-brainstorming skill to create it. Do not explain — build it.',
    ].join('\n')
  }

  const lines: string[] = ['## Available Capabilities', '']

  for (const cap of capabilities) {
    const label = cap.provides ? `${cap.provides} (${cap.name})` : cap.name
    if (cap.status === 'available') {
      const healthTag =
        cap.health === 'healthy'
          ? `healthy${cap.lastTestLatencyMs != null ? `, ${(cap.lastTestLatencyMs / 1000).toFixed(1)}s` : ''}`
          : cap.health === 'degraded'
            ? `degraded: ${cap.degradedReason ?? 'unknown'}`
            : 'untested'
      lines.push(`- ${label} [${healthTag}]`)
    } else {
      lines.push(`- ${label} [unavailable: ${cap.unavailableReason ?? 'unknown'}]`)
    }
  }

  return lines.join('\n')
}

/**
 * Framework directive: screenshot curation.
 *
 * The framework stores every screenshot returned by MCP tools and injects a URL
 * into the tool output (`Screenshot URL: /api/assets/screenshots/ss-xxx.png`).
 * The brain is the curator — it decides which screenshots are worth showing the user.
 */
export function formatScreenshotCurationDirective(): string {
  return [
    '## Screenshot Handling (IMPORTANT)',
    '',
    'Any time a tool returns an image (desktop screenshots, browser screenshots, generated charts, etc.), the framework stores it and appends a text block to the tool result in this exact format:',
    '',
    '    Screenshot URL: /api/assets/screenshots/ss-<uuid>.png',
    '',
    '**When you reply to the user after using such a tool, you MUST include the single most relevant screenshot inline as a markdown image** so they can see what you saw:',
    '',
    '    ![what this shows](/api/assets/screenshots/ss-<uuid>.png)',
    '',
    'Rules:',
    '- Pick ONE screenshot — the final state or the key moment. Skip intermediate clicks/focus/navigation shots.',
    '- Put the image near the top of your reply, before the text summary.',
    '- If you used multiple visual tools but only one matters, use only the URL from that one.',
    '- Copy the URL exactly as it appeared in the tool output. Never invent a URL.',
    '- Only skip this step if the user\'s question is purely about text content that the image cannot add to (rare — most visual tasks benefit from a screenshot).',
  ].join('\n')
}

/** Scheduled task context for scheduler-triggered queries */
export interface ScheduledTaskContext {
  title: string
  start: string
  end?: string
  calendarId: string
  description?: string
  action?: string
}

export interface AssemblePromptOptions {
  /** Pre-assembled calendar context (from assembleCalendarContext) */
  calendarContext?: string
  /** Scheduled task that triggered this query (from CalendarScheduler) */
  scheduledTaskContext?: ScheduledTaskContext
  /** Capability registry entries to include in prompt */
  capabilities?: Capability[]
  /** Skill names to exclude from prompt (from filterSkillsByTools) */
  excludeSkills?: Set<string>
}

export async function assembleSystemPrompt(
  brainDir: string,
  options: AssemblePromptOptions = {},
): Promise<string> {
  const sections: string[] = []

  // Derive agentDir from brainDir (brainDir is typically {agentDir}/brain)
  const agentDir = path.dirname(brainDir)

  for (const { rel, header } of BRAIN_FILES) {
    // For AGENTS.md, fall back to CLAUDE.md during transition
    let filePath = path.join(brainDir, rel)
    if (rel === 'AGENTS.md' && !existsSync(filePath)) {
      const legacyPath = path.join(brainDir, 'CLAUDE.md')
      if (existsSync(legacyPath)) {
        filePath = legacyPath
      }
    }
    const content = await readOptionalFile(filePath)
    if (content) {
      if (header) {
        sections.push(`${header}\n\n${content.trim()}`)
      } else {
        sections.push(content.trim())
      }
    }
  }

  if (sections.length === 0) {
    const fallback = await readOptionalFile(DEFAULT_PERSONALITY_PATH)
    sections.push(fallback?.trim() ?? 'You are a helpful AI assistant.')
  }

  // Load notebook reference files (M6-S2)
  // If notebook/reference has content, use it; otherwise fall back to legacy runtime files
  const hasNewNotebook = await hasNotebookReference(agentDir)

  if (hasNewNotebook) {
    // Load new notebook/reference/* files
    const notebookReference = await loadNotebookReference(agentDir)
    if (notebookReference) {
      sections.push(notebookReference)
    }

    // Load notebook/operations/* files (standing orders, external comms)
    const notebookOperations = await loadNotebookOperations(agentDir)
    if (notebookOperations) {
      sections.push(notebookOperations)
    }

    // Load daily logs
    const dailyLogs = await loadDailyLogs(agentDir)
    if (dailyLogs) {
      sections.push(dailyLogs)
    }

    // Include notebook directory tree so the brain knows exact file paths
    const notebookTree = await buildNotebookTree(agentDir)
    if (notebookTree) {
      sections.push(notebookTree)
    }
  } else {
    // Fall back to legacy runtime files
    for (const { rel, header } of LEGACY_NOTEBOOK_FILES) {
      let content = await readOptionalFile(path.join(brainDir, rel))
      if (content) {
        // Truncate if too large to prevent prompt bloat
        if (content.length > MAX_NOTEBOOK_CHARS) {
          console.warn(
            `[Prompt] Notebook file ${rel} exceeds ${MAX_NOTEBOOK_CHARS} chars, truncating`,
          )
          content = content.substring(0, MAX_NOTEBOOK_CHARS) + '\n\n[... truncated ...]'
        }
        sections.push(`${header}\n\n${content.trim()}`)
      }
    }
  }

  // Load automation hints for brain awareness (M7-S3)
  const automationHints = await loadAutomationHints(agentDir)
  if (automationHints) {
    sections.push(automationHints)
  }

  // Add capability registry hints (M9-S1)
  if (options.capabilities) {
    const capHints = loadCapabilityHints(options.capabilities)
    if (capHints) {
      sections.push(capHints)
    }
  }

  // Framework behavior: screenshot curation (M9.5-S6)
  // The framework intercepts image-producing tool results, stores them, and injects
  // URL hints into the tool output. The brain decides which ones to surface to the user.
  sections.push(formatScreenshotCurationDirective())

  // Add calendar context if provided (replaces static reminders.md)
  if (options.calendarContext) {
    sections.push(options.calendarContext)
  }

  // Add triggered scheduled task context (from CalendarScheduler)
  if (options.scheduledTaskContext) {
    sections.push(formatScheduledTaskContext(options.scheduledTaskContext))
  }

  // Load brain-level skills from framework skills/ directory
  // Skills with "level: brain" in frontmatter are always included in the system prompt
  const frameworkSkillsDir = path.resolve(agentDir, '..', 'skills')
  try {
    const entries = await readdir(frameworkSkillsDir).catch(() => [] as string[])
    for (const entry of entries) {
      if (!entry.endsWith('.md')) continue
      const skillName = entry.replace(/\.md$/, '')
      if (options.excludeSkills?.has(skillName)) continue
      const content = await readOptionalFile(path.join(frameworkSkillsDir, entry))
      if (!content) continue
      // Check for level: brain in frontmatter
      const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)
      if (!fmMatch) continue
      if (!/level:\s*brain/i.test(fmMatch[1])) continue
      const body = content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n*/, '')
      if (body.trim()) {
        sections.push(body.trim())
      }
    }
  } catch {
    // Framework skills directory may not exist
  }

  return sections.join('\n\n')
}
