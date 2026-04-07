/**
 * Level 3: Behavioral Regression Tests
 *
 * Verifies that Nina's routing decisions (delegate vs direct) are unchanged
 * after extracting task-triage into a SKILL.md.
 *
 * Uses the Anthropic SDK directly (not queryModel from dashboard — avoids
 * circular cross-package dependency). Calls claude-haiku for fast, cheap
 * classification.
 *
 * Prerequisites: npm install @anthropic-ai/sdk (not in core's deps — install manually to run)
 * Run: cd packages/core && npx vitest run tests/triage-behavioral.test.ts --timeout 120000
 * Note: Requires ANTHROPIC_API_KEY environment variable to be set.
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { assembleSystemPrompt } from '../src/prompt.js'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

// Skip entirely if .my_agent doesn't exist (CI / fresh clone)
const AGENT_DIR = join(import.meta.dirname, '../../../.my_agent')
const BRAIN_DIR = join(AGENT_DIR, 'brain')
const HAS_AGENT = existsSync(BRAIN_DIR)

// Skip if no API key
const HAS_AUTH = !!process.env.ANTHROPIC_API_KEY

// Skip if @anthropic-ai/sdk is not installed (it's not in core's deps)
let Anthropic: typeof import('@anthropic-ai/sdk').default | null = null
try {
  Anthropic = (await import('@anthropic-ai/sdk')).default
} catch {
  // SDK not installed — tests will be skipped
}

const canRun = HAS_AGENT && HAS_AUTH && Anthropic !== null
const describeIf = canRun ? describe : describe.skip

describeIf('Level 3: triage routing decisions (live LLM)', () => {
  let systemPrompt: string
  let client: InstanceType<NonNullable<typeof Anthropic>>

  beforeAll(async () => {
    systemPrompt = await assembleSystemPrompt(BRAIN_DIR)
    client = new Anthropic!()
  })

  async function queryRouting(userMessage: string): Promise<string> {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 10,
      system: systemPrompt,
      messages: [{
        role: 'user',
        content: `Respond with ONLY one word — "DELEGATE" if you would use create_automation for this, or "DIRECT" if you would answer directly or use WebSearch/recall.\n\nUser message: "${userMessage}"`,
      }],
    })

    const text = response.content
      .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
      .map(b => b.text)
      .join('')
    return text.trim().toUpperCase()
  }

  // Run each scenario 3x, expect 2/3 match (per spec)
  async function assertRouting(message: string, expected: 'DELEGATE' | 'DIRECT') {
    const results: string[] = []
    for (let i = 0; i < 3; i++) {
      results.push(await queryRouting(message))
    }
    const matches = results.filter(r => r.includes(expected)).length
    expect(matches, `Expected ${expected} for "${message}" but got: ${results}`).toBeGreaterThanOrEqual(2)
  }

  it('delegates research requests', async () => {
    await assertRouting('Research the best flights to Tokyo next week', 'DELEGATE')
  }, 30000)

  it('answers time questions directly', async () => {
    await assertRouting('What time is it in Tokyo?', 'DIRECT')
  }, 30000)

  it('delegates code writing', async () => {
    await assertRouting('Write a script to backup my notebook daily', 'DELEGATE')
  }, 30000)

  it('answers factual questions directly', async () => {
    await assertRouting('Who is the president of France?', 'DIRECT')
  }, 30000)

  it('delegates comparative analysis', async () => {
    await assertRouting('Compare the top 3 project management tools', 'DELEGATE')
  }, 30000)

  it('delegates tasks with delivery actions', async () => {
    await assertRouting('Research Tokyo restaurants and send me the list on WhatsApp', 'DELEGATE')
  }, 30000)

  it('answers memory recall directly', async () => {
    await assertRouting('Do you remember where I\'m traveling next?', 'DIRECT')
  }, 30000)
})
