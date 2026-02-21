import * as path from 'node:path'
import { readFile, readdir } from 'node:fs/promises'

const DEFAULT_PERSONALITY_PATH = path.resolve(
  import.meta.dirname,
  '../defaults/personalities/partner.md',
)

const FRAMEWORK_SKILLS_DIR = path.resolve(import.meta.dirname, '../skills')

const BRAIN_FILES = [
  { rel: 'CLAUDE.md', header: null },
  { rel: 'memory/core/identity.md', header: '## Identity' },
  { rel: 'memory/core/contacts.md', header: '## Key People' },
  { rel: 'memory/core/preferences.md', header: '## Preferences' },
]

// Notebook files from runtime directory (editable by agent during owner conversations)
const NOTEBOOK_FILES = [
  { rel: '../runtime/external-communications.md', header: '## External Communications Rules' },
  { rel: '../runtime/reminders.md', header: '## Reminders' },
  { rel: '../runtime/standing-orders.md', header: '## Standing Orders' },
]

// Per-file token limit to prevent prompt bloat (~4 chars per token)
const MAX_NOTEBOOK_CHARS = 8000

// Skills whose full content should be included in the system prompt (not just commands)
const SKILL_CONTENT_FILES = ['task-api.md', 'channels.md']

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
 * Load full content of specific skill files that should be included in the system prompt.
 * These are skills that provide API documentation or instructions the brain needs always.
 */
async function loadSkillContent(skillsDirs: string[]): Promise<string[]> {
  const sections: string[] = []

  for (const dir of skillsDirs) {
    for (const filename of SKILL_CONTENT_FILES) {
      const content = await readOptionalFile(path.join(dir, filename))
      if (content) {
        sections.push(content.trim())
      }
    }
  }

  return sections
}

async function loadSkillDescriptions(skillsDirs: string[]): Promise<string | null> {
  const commands: string[] = []

  for (const dir of skillsDirs) {
    let entries: string[]
    try {
      entries = await readdir(dir)
    } catch {
      continue
    }
    for (const entry of entries.sort()) {
      // Try subdirectory structure: skills/*/SKILL.md
      const skillMd = await readOptionalFile(path.join(dir, entry, 'SKILL.md'))
      if (skillMd) {
        const firstLine = skillMd.split('\n').find((l) => l.trim() && !l.trim().startsWith('#'))
        if (firstLine) {
          commands.push(`- /my-agent:${entry} — ${firstLine.trim()}`)
        }
        continue
      }

      // Try flat file structure: skills/*.md
      if (entry.endsWith('.md')) {
        const flatMd = await readOptionalFile(path.join(dir, entry))
        if (flatMd) {
          const skillName = entry.slice(0, -3) // Remove .md extension
          const firstLine = flatMd.split('\n').find((l) => l.trim() && !l.trim().startsWith('#'))
          if (firstLine) {
            commands.push(`- /my-agent:${skillName} — ${firstLine.trim()}`)
          }
        }
      }
    }
  }

  if (commands.length === 0) return null
  return `## Available Commands\n\n${commands.join('\n')}`
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
}

export async function assembleSystemPrompt(
  brainDir: string,
  options: AssemblePromptOptions = {},
): Promise<string> {
  const sections: string[] = []

  for (const { rel, header } of BRAIN_FILES) {
    const content = await readOptionalFile(path.join(brainDir, rel))
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

  // Load Notebook files from runtime directory
  for (const { rel, header } of NOTEBOOK_FILES) {
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

  // Add calendar context if provided (replaces static reminders.md)
  if (options.calendarContext) {
    sections.push(options.calendarContext)
  }

  // Add triggered scheduled task context (from CalendarScheduler)
  if (options.scheduledTaskContext) {
    sections.push(formatScheduledTaskContext(options.scheduledTaskContext))
  }

  const skillsDirs = [FRAMEWORK_SKILLS_DIR, path.join(brainDir, 'skills')]

  // Load full content of specific skills (API documentation, etc.)
  const skillContent = await loadSkillContent(skillsDirs)
  sections.push(...skillContent)

  // Load skill commands list
  const skills = await loadSkillDescriptions(skillsDirs)
  if (skills) {
    sections.push(skills)
  }

  return sections.join('\n\n')
}
