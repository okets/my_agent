import { existsSync } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
import * as path from 'node:path'
import { parse as parseYaml } from 'yaml'

const REQUIRED_FRONTMATTER_FIELDS = ['name', 'description', 'origin']

/**
 * Count discoverable SDK skills in the agent's .claude/skills/ directory.
 * Validates YAML frontmatter on each skill. Returns the count and logs results.
 * Warns if zero skills found or if frontmatter is invalid.
 */
export async function checkSkillsHealth(agentDir: string): Promise<number> {
  const skillsDir = path.join(agentDir, '.claude', 'skills')

  if (!existsSync(skillsDir)) {
    console.warn(`[Skills] Warning: Skills directory not found: ${skillsDir}`)
    return 0
  }

  let entries: string[]
  try {
    entries = await readdir(skillsDir)
  } catch {
    console.warn(`[Skills] Warning: Cannot read skills directory: ${skillsDir}`)
    return 0
  }

  // Count directories that contain a SKILL.md, validate frontmatter
  let count = 0
  for (const entry of entries) {
    const skillMdPath = path.join(skillsDir, entry, 'SKILL.md')
    if (!existsSync(skillMdPath)) continue

    count++

    // Validate frontmatter
    try {
      const content = await readFile(skillMdPath, 'utf-8')
      const fmMatch = content.match(/^---\n([\s\S]*?)\n---/)
      if (!fmMatch) {
        console.warn(`[Skills] Warning: ${entry}/SKILL.md missing YAML frontmatter`)
        continue
      }
      const fm = parseYaml(fmMatch[1])
      const missing = REQUIRED_FRONTMATTER_FIELDS.filter((f) => !fm[f])
      if (missing.length > 0) {
        console.warn(`[Skills] Warning: ${entry}/SKILL.md missing frontmatter fields: ${missing.join(', ')}`)
      }
    } catch {
      console.warn(`[Skills] Warning: ${entry}/SKILL.md frontmatter parse error`)
    }
  }

  if (count === 0) {
    console.warn(`[Skills] Warning: No skills found in ${skillsDir}. SDK skill discovery will find nothing.`)
  } else {
    console.log(`[Skills] ${count} skill(s) discovered in ${skillsDir}`)
  }

  return count
}
