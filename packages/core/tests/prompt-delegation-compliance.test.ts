import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { assembleSystemPrompt } from '../src/prompt.js'

/**
 * Level 1: Verify delegation compliance fixes in system prompt.
 *
 * After M9.3-S1 prompt corrections, the system prompt must:
 * - NOT contain advisory delegation language ("your call", "consider delegating")
 * - Contain explicit WebSearch scope limits
 * - Contain motivation for why delegation matters
 * - Contain self-check instruction
 */

// Phrases that MUST NOT appear (contradictions removed in M9.3-S1)
const BANNED_PHRASES = [
  'your call',
  'consider delegating',
]

// Phrases that MUST appear (added in M9.3-S1)
const REQUIRED_PHRASES = [
  // Motivation: why delegation matters
  'paper trail',
  'debrief integration',
  // Exhaustive WebSearch scope
  'You may use WebSearch ONLY for',
  'You MUST delegate via create_automation for',
  // Self-check
  'before calling WebSearch a second time',
  // conversation-role identity (unchanged, verify still present)
  'You are the conversation layer',
  'You do not do work yourself',
]

describe('M9.3-S1: delegation compliance prompt fixes', () => {
  const testDir = join(tmpdir(), `delegation-compliance-${Date.now()}`)
  const agentDir = join(testDir, 'my_agent')
  const brainDir = join(agentDir, 'brain')
  const frameworkSkillsDir = join(testDir, 'skills')

  beforeEach(() => {
    mkdirSync(brainDir, { recursive: true })
    mkdirSync(frameworkSkillsDir, { recursive: true })

    writeFileSync(join(brainDir, 'AGENTS.md'), '# Test Agent\nYou are a test agent.')

    // Copy actual framework skills from repo
    for (const skill of ['conversation-role.md', 'task-triage.md', 'operational-rules.md']) {
      writeFileSync(
        join(frameworkSkillsDir, skill),
        readFileSync(join(__dirname, '../../../skills', skill), 'utf-8'),
      )
    }
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  it('should not contain advisory delegation language', async () => {
    const prompt = await assembleSystemPrompt(brainDir)
    for (const phrase of BANNED_PHRASES) {
      expect(prompt.toLowerCase()).not.toContain(phrase.toLowerCase())
    }
  })

  it('should contain explicit WebSearch scope and delegation motivation', async () => {
    const prompt = await assembleSystemPrompt(brainDir)
    for (const phrase of REQUIRED_PHRASES) {
      expect(prompt).toContain(phrase)
    }
  })
})
