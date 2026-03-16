import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { checkSkillsHealth } from '../src/skills-health.js'

describe('checkSkillsHealth', () => {
  const testDir = join(tmpdir(), `skills-health-test-${Date.now()}`)
  const skillsDir = join(testDir, '.claude', 'skills')

  beforeEach(() => {
    mkdirSync(skillsDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  it('returns 0 and warns when skills directory does not exist', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const count = await checkSkillsHealth('/nonexistent/path')
    expect(count).toBe(0)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('not found'))
    warn.mockRestore()
  })

  it('returns 0 when skills directory is empty', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const count = await checkSkillsHealth(testDir)
    expect(count).toBe(0)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('No skills found'))
    warn.mockRestore()
  })

  it('counts skills with SKILL.md files', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    mkdirSync(join(skillsDir, 'identity'), { recursive: true })
    writeFileSync(join(skillsDir, 'identity', 'SKILL.md'), '---\nname: identity\ndescription: test\norigin: system\n---\n# Identity')
    mkdirSync(join(skillsDir, 'scheduling'), { recursive: true })
    writeFileSync(join(skillsDir, 'scheduling', 'SKILL.md'), '---\nname: scheduling\ndescription: test\norigin: system\n---\n# Scheduling')

    const count = await checkSkillsHealth(testDir)
    expect(count).toBe(2)
    expect(log).toHaveBeenCalledWith(expect.stringContaining('2 skill(s)'))
    log.mockRestore()
  })

  it('ignores directories without SKILL.md', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    mkdirSync(join(skillsDir, 'valid'), { recursive: true })
    writeFileSync(join(skillsDir, 'valid', 'SKILL.md'), '---\nname: valid\ndescription: test\norigin: system\n---\n# Valid')
    mkdirSync(join(skillsDir, 'empty-dir'), { recursive: true })

    const count = await checkSkillsHealth(testDir)
    expect(count).toBe(1)
    log.mockRestore()
  })

  it('warns when SKILL.md has missing frontmatter fields', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    mkdirSync(join(skillsDir, 'bad'), { recursive: true })
    writeFileSync(join(skillsDir, 'bad', 'SKILL.md'), '---\nname: bad\n---\n# Bad')

    await checkSkillsHealth(testDir)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('missing frontmatter fields: description, origin'))
    warn.mockRestore()
    log.mockRestore()
  })

  it('warns when SKILL.md has no frontmatter at all', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    mkdirSync(join(skillsDir, 'nofm'), { recursive: true })
    writeFileSync(join(skillsDir, 'nofm', 'SKILL.md'), '# No Frontmatter')

    await checkSkillsHealth(testDir)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('missing YAML frontmatter'))
    warn.mockRestore()
    log.mockRestore()
  })
})
