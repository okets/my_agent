import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { assembleSystemPrompt } from '../src/prompt.js'

/**
 * Level 1 regression tests — verify triage directives appear in system prompt
 * after M9.2-S7 framework/instance split.
 *
 * Skills now load from repo-root skills/ via level:brain frontmatter scan,
 * not from brain/ (SKILL_CONTENT_FILES) or .claude/skills/ (ALWAYS_ON_SKILLS).
 */

// Every triage directive that MUST appear in the assembled prompt
const TRIAGE_DIRECTIVES = [
  'For anything beyond a quick WebSearch, use `create_automation`',
  'WebSearch: single factual question, one search, instant answer',
  'create_automation: research, comparison, multi-step work',
  'Include ALL relevant context in the instructions',
  'Internal actions (safe to do freely)',
  'External actions (ask first)',
  'Respond when directly mentioned or when you can add genuine value',
  'Automation Design Checklist',
]

// Identity sentences from conversation-role.md
const IDENTITY_SENTENCES = [
  'You are the conversation layer',
  'What you do directly',
  'What you delegate',
]

describe('Level 1 regression — triage content in system prompt (framework skills)', () => {
  // Structure: testDir/my_agent/brain/ (brainDir), testDir/skills/ (framework skills)
  const testDir = join(tmpdir(), `prompt-triage-regression-${Date.now()}`)
  const agentDir = join(testDir, 'my_agent')
  const brainDir = join(agentDir, 'brain')
  const frameworkSkillsDir = join(testDir, 'skills')

  beforeEach(() => {
    mkdirSync(brainDir, { recursive: true })
    mkdirSync(frameworkSkillsDir, { recursive: true })

    // Minimal AGENTS.md
    writeFileSync(join(brainDir, 'AGENTS.md'), '# Test Agent\nYou are a test agent.')

    // Framework skill: conversation-role (level: brain)
    writeFileSync(
      join(frameworkSkillsDir, 'conversation-role.md'),
      readFileSync(join(__dirname, '../../../skills/conversation-role.md'), 'utf-8')
    )

    // Framework skill: task-triage (level: brain)
    writeFileSync(
      join(frameworkSkillsDir, 'task-triage.md'),
      readFileSync(join(__dirname, '../../../skills/task-triage.md'), 'utf-8')
    )
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  for (const directive of TRIAGE_DIRECTIVES) {
    it(`contains triage directive: "${directive.substring(0, 50)}..."`, async () => {
      const prompt = await assembleSystemPrompt(brainDir)
      expect(prompt).toContain(directive)
    })
  }

  for (const sentence of IDENTITY_SENTENCES) {
    it(`contains identity sentence: "${sentence}"`, async () => {
      const prompt = await assembleSystemPrompt(brainDir)
      expect(prompt).toContain(sentence)
    })
  }

  it('does not double-include triage content (no duplication)', async () => {
    const prompt = await assembleSystemPrompt(brainDir)
    const marker = 'For anything beyond a quick WebSearch, use `create_automation`'
    const firstIdx = prompt.indexOf(marker)
    const secondIdx = prompt.indexOf(marker, firstIdx + 1)
    expect(secondIdx).toBe(-1)
  })

  it('does not include YAML frontmatter from framework skills', async () => {
    const prompt = await assembleSystemPrompt(brainDir)
    expect(prompt).not.toContain('level: brain')
    expect(prompt).not.toContain('name: task-triage')
  })

  it('does not contain stale tool references', async () => {
    const prompt = await assembleSystemPrompt(brainDir)
    expect(prompt).not.toContain('create_task')
    expect(prompt).not.toContain('revise_task')
    expect(prompt).not.toContain('search_tasks')
    expect(prompt).not.toContain('update_property')
  })
})
