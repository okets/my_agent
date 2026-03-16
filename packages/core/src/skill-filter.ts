import { existsSync } from 'node:fs'
import { readFile, writeFile, readdir } from 'node:fs/promises'
import * as path from 'node:path'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'

/**
 * Filter skills based on tool compatibility.
 *
 * Scans .my_agent/.claude/skills/, reads allowed-tools from each skill's
 * YAML frontmatter, and sets disable-model-invocation: true on skills whose
 * required tools aren't in the session's allowedTools list.
 *
 * Returns the list of skill names that were disabled.
 *
 * LIMITATION: Writes directly to SKILL.md on disk. If concurrent sessions
 * run with different tool sets, one session's cleanup could re-enable a skill
 * that another session disabled. Safe in current architecture because Working
 * Nina has all tools (never disables anything) and only one Conversation Nina
 * session runs at a time. Revisit if multi-session support is needed.
 */
export async function filterSkillsByTools(
  agentDir: string,
  sessionTools: string[],
): Promise<string[]> {
  const skillsDir = path.join(agentDir, '.claude', 'skills')
  if (!existsSync(skillsDir)) return []

  let entries: string[]
  try {
    entries = await readdir(skillsDir)
  } catch {
    return []
  }

  const toolSet = new Set(sessionTools)
  const disabled: string[] = []

  for (const entry of entries) {
    const skillMdPath = path.join(skillsDir, entry, 'SKILL.md')
    if (!existsSync(skillMdPath)) continue

    try {
      const content = await readFile(skillMdPath, 'utf-8')
      const fmMatch = content.match(/^---\n([\s\S]*?)\n---/)
      if (!fmMatch) continue

      const fm = parseYaml(fmMatch[1])
      const allowedTools = fm['allowed-tools'] as string[] | undefined
      if (!allowedTools || !Array.isArray(allowedTools)) continue

      // Check if all required tools are available in the session
      const missingTools = allowedTools.filter((t) => !toolSet.has(t))
      if (missingTools.length === 0) continue

      // Disable this skill
      fm['disable-model-invocation'] = true
      const body = content.slice(fmMatch[0].length)
      const newContent = `---\n${stringifyYaml(fm).trim()}\n---${body}`
      await writeFile(skillMdPath, newContent)
      disabled.push(entry)

      console.log(
        `[Skills] Disabled "${entry}" — requires tools not in session: ${missingTools.join(', ')}`,
      )
    } catch {
      continue
    }
  }

  return disabled
}

/**
 * Clean up disable-model-invocation flags set by filterSkillsByTools.
 * Call after a session ends to restore skills for future sessions.
 */
export async function cleanupSkillFilters(
  agentDir: string,
  disabledSkills: string[],
): Promise<void> {
  const skillsDir = path.join(agentDir, '.claude', 'skills')

  for (const entry of disabledSkills) {
    const skillMdPath = path.join(skillsDir, entry, 'SKILL.md')
    if (!existsSync(skillMdPath)) continue

    try {
      const content = await readFile(skillMdPath, 'utf-8')
      const fmMatch = content.match(/^---\n([\s\S]*?)\n---/)
      if (!fmMatch) continue

      const fm = parseYaml(fmMatch[1])
      if (!fm['disable-model-invocation']) continue

      delete fm['disable-model-invocation']
      const body = content.slice(fmMatch[0].length)
      const newContent = `---\n${stringifyYaml(fm).trim()}\n---${body}`
      await writeFile(skillMdPath, newContent)
    } catch {
      continue
    }
  }
}
