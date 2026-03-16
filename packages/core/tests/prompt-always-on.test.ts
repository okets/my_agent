import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { assembleSystemPrompt } from '../src/prompt.js'

describe('assembleSystemPrompt — always-on content from brain/', () => {
  const testDir = join(tmpdir(), `prompt-always-on-test-${Date.now()}`)
  const brainDir = join(testDir, 'brain')

  beforeEach(() => {
    mkdirSync(brainDir, { recursive: true })
    writeFileSync(join(brainDir, 'AGENTS.md'), '# Test Agent\nYou are a test agent.')
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  it('includes conversation-role.md content from brain/', async () => {
    writeFileSync(
      join(brainDir, 'conversation-role.md'),
      '## Your Role: Conversation Agent\nYou are the conversation layer.'
    )

    const prompt = await assembleSystemPrompt(brainDir)
    expect(prompt).toContain('Conversation Agent')
    expect(prompt).toContain('conversation layer')
  })

  it('includes notebook.md content from brain/', async () => {
    writeFileSync(
      join(brainDir, 'notebook.md'),
      '# Memory & Notebook\nUse MCP tools for persistent memory.'
    )

    const prompt = await assembleSystemPrompt(brainDir)
    expect(prompt).toContain('Memory & Notebook')
    expect(prompt).toContain('persistent memory')
  })

  it('does NOT include an Available Commands section (SDK handles discovery)', async () => {
    const prompt = await assembleSystemPrompt(brainDir)
    expect(prompt).not.toContain('Available Commands')
    expect(prompt).not.toContain('/my-agent:')
  })
})

describe('assembleSystemPrompt — always-on skills from .claude/skills/', () => {
  const testDir = join(tmpdir(), `prompt-skills-test-${Date.now()}`)
  const brainDir = join(testDir, 'brain')
  const skillsDir = join(testDir, '.claude', 'skills', 'task-triage')

  beforeEach(() => {
    mkdirSync(brainDir, { recursive: true })
    mkdirSync(skillsDir, { recursive: true })
    writeFileSync(join(brainDir, 'AGENTS.md'), '# Test Agent\nYou are a test agent.')
    writeFileSync(
      join(skillsDir, 'SKILL.md'),
      '---\nname: task-triage\ndescription: test\norigin: system\n---\n\n## Task Delegation\n\nFor anything beyond a quick WebSearch, use `create_task`.'
    )
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  it('loads always-on skill content from .claude/skills/', async () => {
    const prompt = await assembleSystemPrompt(brainDir)
    expect(prompt).toContain('For anything beyond a quick WebSearch, use `create_task`')
  })

  it('strips YAML frontmatter before injection', async () => {
    const prompt = await assembleSystemPrompt(brainDir)
    expect(prompt).not.toContain('name: task-triage')
    expect(prompt).not.toContain('origin: system')
  })

  it('does not load non-always-on skills (scheduling)', async () => {
    const otherSkillDir = join(testDir, '.claude', 'skills', 'scheduling')
    mkdirSync(otherSkillDir, { recursive: true })
    writeFileSync(
      join(otherSkillDir, 'SKILL.md'),
      '---\nname: scheduling\ndescription: test\norigin: system\n---\n\n# Scheduling\n\nThis should NOT appear.'
    )

    const prompt = await assembleSystemPrompt(brainDir)
    expect(prompt).not.toContain('This should NOT appear')
  })

  it('does not load knowledge-curation into always-on prompt', async () => {
    const kcDir = join(testDir, '.claude', 'skills', 'knowledge-curation')
    mkdirSync(kcDir, { recursive: true })
    writeFileSync(
      join(kcDir, 'SKILL.md'),
      '---\nname: knowledge-curation\ndescription: test\norigin: system\n---\n\n# Knowledge Curation\n\nKC content should NOT be always-on.'
    )

    const prompt = await assembleSystemPrompt(brainDir)
    expect(prompt).not.toContain('KC content should NOT be always-on')
  })
})
