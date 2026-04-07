import { existsSync } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
import * as path from 'node:path'
import { parse as parseYaml } from 'yaml'

/**
 * Filter skills based on tool compatibility (runtime-only, no disk writes).
 *
 * Scans .my_agent/.claude/skills/, reads allowed-tools from each skill's
 * YAML frontmatter, and returns the names of skills whose required tools
 * aren't in the session's allowedTools list.
 *
 * M9.2-S8: No longer modifies SKILL.md files on disk. Previously wrote
 * disable-model-invocation: true which could get stuck if sessions crashed.
 * Now returns a pure list — callers decide how to handle exclusion.
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
 * @deprecated Removed in M9.2-S8. filterSkillsByTools no longer writes to disk,
 * so there's nothing to clean up. This function is a no-op for backward compatibility.
 */
export async function cleanupSkillFilters(
  _agentDir: string,
  _disabledSkills: string[],
): Promise<void> {
  // No-op: skill filter no longer modifies disk
}
