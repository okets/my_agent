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

async function readOptionalFile(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, 'utf-8')
  } catch {
    return null
  }
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
      const skillMd = await readOptionalFile(path.join(dir, entry, 'SKILL.md'))
      if (!skillMd) continue
      const firstLine = skillMd.split('\n').find((l) => l.trim() && !l.trim().startsWith('#'))
      if (firstLine) {
        commands.push(`- /my-agent:${entry} — ${firstLine.trim()}`)
      }
    }
  }

  if (commands.length === 0) return null
  return `## Available Commands\n\n${commands.join('\n')}`
}

export async function assembleSystemPrompt(brainDir: string): Promise<string> {
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

  const skillsDirs = [FRAMEWORK_SKILLS_DIR, path.join(brainDir, 'skills')]
  const skills = await loadSkillDescriptions(skillsDirs)
  if (skills) {
    sections.push(skills)
  }

  return sections.join('\n\n')
}
