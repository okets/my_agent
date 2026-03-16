import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { filterSkillsByTools, cleanupSkillFilters } from '../src/skill-filter.js'

describe('filterSkillsByTools', () => {
  const testDir = join(tmpdir(), `skill-filter-test-${Date.now()}`)
  const skillsDir = join(testDir, '.claude', 'skills')

  beforeEach(() => {
    mkdirSync(skillsDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  it('disables skills whose allowed-tools are not in session tools', async () => {
    mkdirSync(join(skillsDir, 'debugging'), { recursive: true })
    writeFileSync(
      join(skillsDir, 'debugging', 'SKILL.md'),
      '---\nname: debugging\ndescription: Debug issues\norigin: system\nallowed-tools:\n  - Bash\n  - Read\n  - Grep\n---\n# Debugging'
    )

    const disabled = await filterSkillsByTools(testDir, ['WebSearch', 'WebFetch', 'Skill'])

    expect(disabled).toEqual(['debugging'])
    const content = readFileSync(join(skillsDir, 'debugging', 'SKILL.md'), 'utf-8')
    expect(content).toContain('disable-model-invocation: true')
  })

  it('keeps skills whose allowed-tools are all available', async () => {
    mkdirSync(join(skillsDir, 'research'), { recursive: true })
    writeFileSync(
      join(skillsDir, 'research', 'SKILL.md'),
      '---\nname: research\ndescription: Research topics\norigin: system\nallowed-tools:\n  - WebSearch\n---\n# Research'
    )

    const disabled = await filterSkillsByTools(testDir, ['WebSearch', 'WebFetch', 'Skill'])

    expect(disabled).toEqual([])
    const content = readFileSync(join(skillsDir, 'research', 'SKILL.md'), 'utf-8')
    expect(content).not.toContain('disable-model-invocation')
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
})

describe('cleanupSkillFilters', () => {
  const testDir = join(tmpdir(), `skill-cleanup-test-${Date.now()}`)
  const skillsDir = join(testDir, '.claude', 'skills')

  beforeEach(() => {
    mkdirSync(skillsDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  it('removes disable-model-invocation from previously filtered skills', async () => {
    mkdirSync(join(skillsDir, 'debugging'), { recursive: true })
    writeFileSync(
      join(skillsDir, 'debugging', 'SKILL.md'),
      '---\nname: debugging\ndescription: Debug issues\norigin: system\nallowed-tools:\n  - Bash\ndisable-model-invocation: true\n---\n# Debugging'
    )

    await cleanupSkillFilters(testDir, ['debugging'])

    const content = readFileSync(join(skillsDir, 'debugging', 'SKILL.md'), 'utf-8')
    expect(content).not.toContain('disable-model-invocation')
  })
})
