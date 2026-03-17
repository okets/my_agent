import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { copyFrameworkSkills } from '../src/hatching/skills-copy.js'

describe('copyFrameworkSkills', () => {
  const testDir = join(tmpdir(), `hatching-skills-test-${Date.now()}`)
  const skillsTarget = join(testDir, '.claude', 'skills')

  beforeEach(() => {
    mkdirSync(skillsTarget, { recursive: true })
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  it('copies skill directories with SKILL.md', async () => {
    await copyFrameworkSkills(testDir)

    expect(existsSync(join(skillsTarget, 'brainstorming', 'SKILL.md'))).toBe(true)
    expect(existsSync(join(skillsTarget, 'systematic-debugging', 'SKILL.md'))).toBe(true)
    expect(existsSync(join(skillsTarget, 'writing-plans', 'SKILL.md'))).toBe(true)
  })

  it('copies subdirectories (data/ with CSVs)', async () => {
    await copyFrameworkSkills(testDir)

    expect(
      existsSync(join(skillsTarget, 'brainstorming-techniques', 'data', 'brain-methods.csv')),
    ).toBe(true)
    expect(existsSync(join(skillsTarget, 'elicitation-techniques', 'data', 'methods.csv'))).toBe(
      true,
    )
  })

  it('does not copy non-skill files (conversation-role.md)', async () => {
    await copyFrameworkSkills(testDir)

    expect(existsSync(join(skillsTarget, 'conversation-role.md'))).toBe(false)
  })

  it('preserves existing skills (does not overwrite)', async () => {
    const existingDir = join(skillsTarget, 'brainstorming')
    mkdirSync(existingDir, { recursive: true })
    writeFileSync(join(existingDir, 'SKILL.md'), 'custom content')

    await copyFrameworkSkills(testDir)

    expect(readFileSync(join(existingDir, 'SKILL.md'), 'utf-8')).toBe('custom content')
  })

  it('copies framework skills with correct origin in frontmatter', async () => {
    await copyFrameworkSkills(testDir)

    const content = readFileSync(join(skillsTarget, 'brainstorming', 'SKILL.md'), 'utf-8')
    expect(content).toContain('origin: curated')
  })

  it('copies all framework skill directories', async () => {
    await copyFrameworkSkills(testDir)

    const expected = [
      'auth',
      'brainstorming',
      'brainstorming-techniques',
      'calendar',
      'elicitation-techniques',
      'identity',
      'operating-rules',
      'personality',
      'systematic-debugging',
      'writing-plans',
    ]
    for (const name of expected) {
      expect(existsSync(join(skillsTarget, name, 'SKILL.md')), `Missing: ${name}`).toBe(true)
    }
  })
})
