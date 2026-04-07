import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { filterSkillsByTools, cleanupSkillFilters } from '../src/skill-filter.js'

/**
 * M9.2-S8: Skill filter is now pure — returns disabled skill names
 * without modifying SKILL.md files on disk. No crash artifacts.
 */

describe('filterSkillsByTools (runtime-only, no disk writes)', () => {
  const testDir = join(tmpdir(), `skill-filter-test-${Date.now()}`)
  const skillsDir = join(testDir, '.claude', 'skills')

  beforeEach(() => {
    mkdirSync(skillsDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  it('returns skills whose allowed-tools are not in session tools', async () => {
    mkdirSync(join(skillsDir, 'debugging'), { recursive: true })
    writeFileSync(
      join(skillsDir, 'debugging', 'SKILL.md'),
      '---\nname: debugging\ndescription: Debug issues\norigin: system\nallowed-tools:\n  - Bash\n  - Read\n  - Grep\n---\n# Debugging'
    )

    const disabled = await filterSkillsByTools(testDir, ['WebSearch', 'WebFetch', 'Skill'])

    expect(disabled).toEqual(['debugging'])
  })

  it('does NOT modify SKILL.md files on disk', async () => {
    const originalContent = '---\nname: debugging\ndescription: Debug issues\norigin: system\nallowed-tools:\n  - Bash\n  - Read\n  - Grep\n---\n# Debugging'
    mkdirSync(join(skillsDir, 'debugging'), { recursive: true })
    writeFileSync(join(skillsDir, 'debugging', 'SKILL.md'), originalContent)

    await filterSkillsByTools(testDir, ['WebSearch', 'WebFetch', 'Skill'])

    const afterContent = readFileSync(join(skillsDir, 'debugging', 'SKILL.md'), 'utf-8')
    expect(afterContent).toBe(originalContent)
    expect(afterContent).not.toContain('disable-model-invocation')
  })

  it('keeps skills whose allowed-tools are all available', async () => {
    mkdirSync(join(skillsDir, 'research'), { recursive: true })
    writeFileSync(
      join(skillsDir, 'research', 'SKILL.md'),
      '---\nname: research\ndescription: Research topics\norigin: system\nallowed-tools:\n  - WebSearch\n---\n# Research'
    )

    const disabled = await filterSkillsByTools(testDir, ['WebSearch', 'WebFetch', 'Skill'])

    expect(disabled).toEqual([])
  })

  it('keeps skills without allowed-tools field (backwards compatible)', async () => {
    mkdirSync(join(skillsDir, 'legacy'), { recursive: true })
    writeFileSync(
      join(skillsDir, 'legacy', 'SKILL.md'),
      '---\nname: legacy\ndescription: Legacy skill\norigin: system\n---\n# Legacy'
    )

    const disabled = await filterSkillsByTools(testDir, ['WebSearch'])

    expect(disabled).toEqual([])
  })

  it('keeps skills when session has all required tools (Working Nina)', async () => {
    mkdirSync(join(skillsDir, 'debugging'), { recursive: true })
    writeFileSync(
      join(skillsDir, 'debugging', 'SKILL.md'),
      '---\nname: debugging\ndescription: Debug issues\norigin: system\nallowed-tools:\n  - Bash\n  - Read\n  - Grep\n---\n# Debugging'
    )

    const disabled = await filterSkillsByTools(testDir, [
      'Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep', 'Skill'
    ])

    expect(disabled).toEqual([])
  })

  it('does not leave artifacts on simulated crash (no disk writes)', async () => {
    mkdirSync(join(skillsDir, 'debugging'), { recursive: true })
    const originalContent = '---\nname: debugging\ndescription: Debug issues\norigin: system\nallowed-tools:\n  - Bash\n---\n# Debugging'
    writeFileSync(join(skillsDir, 'debugging', 'SKILL.md'), originalContent)

    // Simulate: filter runs, then "crash" (no cleanup called)
    await filterSkillsByTools(testDir, ['WebSearch'])
    // No cleanupSkillFilters call — simulating crash

    // File should be unchanged — no stuck disable-model-invocation flag
    const content = readFileSync(join(skillsDir, 'debugging', 'SKILL.md'), 'utf-8')
    expect(content).toBe(originalContent)
    expect(content).not.toContain('disable-model-invocation')
  })
})

describe('cleanupSkillFilters (deprecated no-op)', () => {
  it('is a no-op and does not throw', async () => {
    await expect(cleanupSkillFilters('/nonexistent', ['foo'])).resolves.toBeUndefined()
  })
})
