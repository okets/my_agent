import { existsSync } from 'node:fs'
import { readdir, cp, mkdir } from 'node:fs/promises'
import * as path from 'node:path'

/**
 * Copy framework skills from packages/core/skills/ to the agent's .claude/skills/ directory.
 * Only copies directories containing a SKILL.md file.
 * Does NOT overwrite existing skills (preserves user customizations).
 */
export async function copyFrameworkSkills(agentDir: string): Promise<void> {
  const frameworkSkillsDir = path.resolve(import.meta.dirname, '../../skills')
  const targetDir = path.join(agentDir, '.claude', 'skills')

  if (!existsSync(frameworkSkillsDir)) {
    console.warn('[Skills] Framework skills directory not found:', frameworkSkillsDir)
    return
  }

  await mkdir(targetDir, { recursive: true })

  const entries = await readdir(frameworkSkillsDir, { withFileTypes: true })

  for (const entry of entries) {
    if (!entry.isDirectory()) continue

    const srcSkillMd = path.join(frameworkSkillsDir, entry.name, 'SKILL.md')
    if (!existsSync(srcSkillMd)) continue

    const targetSkillDir = path.join(targetDir, entry.name)
    const targetSkillMd = path.join(targetSkillDir, 'SKILL.md')

    // Do not overwrite existing skills
    if (existsSync(targetSkillMd)) {
      continue
    }

    await cp(path.join(frameworkSkillsDir, entry.name), targetSkillDir, {
      recursive: true,
    })
  }
}
