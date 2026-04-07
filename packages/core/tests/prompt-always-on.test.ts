import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { assembleSystemPrompt } from '../src/prompt.js'

/**
 * Tests for brain-level skill loading via framework skills/ directory.
 *
 * M9.2-S7: Skills with level:brain frontmatter in repo-root skills/ are
 * automatically included in the system prompt. Old loading paths
 * (SKILL_CONTENT_FILES, ALWAYS_ON_SKILLS) have been removed.
 */

describe('assembleSystemPrompt — framework brain-level skills', () => {
  // Structure: testDir/my_agent/brain/ (brainDir), testDir/skills/ (framework skills)
  const testDir = join(tmpdir(), `prompt-always-on-test-${Date.now()}`)
  const agentDir = join(testDir, 'my_agent')
  const brainDir = join(agentDir, 'brain')
  const frameworkSkillsDir = join(testDir, 'skills')

  beforeEach(() => {
    mkdirSync(brainDir, { recursive: true })
    mkdirSync(frameworkSkillsDir, { recursive: true })
    writeFileSync(join(brainDir, 'AGENTS.md'), '# Test Agent\nYou are a test agent.')
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  it('includes skills with level:brain frontmatter', async () => {
    writeFileSync(
      join(frameworkSkillsDir, 'conversation-role.md'),
      '---\nname: conversation-role\ndescription: test\nlevel: brain\n---\n\n## Your Role: Conversation Agent\nYou are the conversation layer.'
    )

    const prompt = await assembleSystemPrompt(brainDir)
    expect(prompt).toContain('Conversation Agent')
    expect(prompt).toContain('conversation layer')
  })

  it('includes memory-tools skill with level:brain', async () => {
    writeFileSync(
      join(frameworkSkillsDir, 'memory-tools.md'),
      '---\nname: memory-tools\ndescription: test\nlevel: brain\n---\n\n# Memory & Notebook\nUse MCP tools for persistent memory.'
    )

    const prompt = await assembleSystemPrompt(brainDir)
    expect(prompt).toContain('Memory & Notebook')
    expect(prompt).toContain('persistent memory')
  })

  it('does NOT include skills without level:brain', async () => {
    writeFileSync(
      join(frameworkSkillsDir, 'some-other-skill.md'),
      '---\nname: some-other\ndescription: test\nlevel: worker\n---\n\n# Worker Skill\nThis should NOT appear in brain prompt.'
    )

    const prompt = await assembleSystemPrompt(brainDir)
    expect(prompt).not.toContain('This should NOT appear in brain prompt')
  })

  it('does NOT include skills without frontmatter', async () => {
    writeFileSync(
      join(frameworkSkillsDir, 'no-frontmatter.md'),
      '# No Frontmatter\nThis skill has no YAML frontmatter and should not load.'
    )

    const prompt = await assembleSystemPrompt(brainDir)
    expect(prompt).not.toContain('This skill has no YAML frontmatter')
  })

  it('strips YAML frontmatter before injection', async () => {
    writeFileSync(
      join(frameworkSkillsDir, 'task-triage.md'),
      '---\nname: task-triage\ndescription: Message routing\nlevel: brain\n---\n\n## Task Delegation\n\nFor anything beyond a quick WebSearch, use `create_automation`.'
    )

    const prompt = await assembleSystemPrompt(brainDir)
    expect(prompt).toContain('For anything beyond a quick WebSearch')
    expect(prompt).not.toContain('name: task-triage')
    expect(prompt).not.toContain('level: brain')
  })

  it('does NOT include an Available Commands section (SDK handles discovery)', async () => {
    const prompt = await assembleSystemPrompt(brainDir)
    expect(prompt).not.toContain('Available Commands')
    expect(prompt).not.toContain('/my-agent:')
  })
})
