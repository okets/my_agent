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
