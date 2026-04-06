import { describe, it, expect } from 'vitest'
import { createCapabilityRouting } from '../../src/hooks/safety.js'
import type { PreToolUseHookInput } from '@anthropic-ai/claude-agent-sdk'

function makeInput(toolName: string, filePath: string): PreToolUseHookInput {
  return {
    hook_event_name: 'PreToolUse',
    tool_name: toolName,
    tool_input: { file_path: filePath },
  } as PreToolUseHookInput
}

describe('createCapabilityRouting', () => {
  const hook = createCapabilityRouting()

  it('blocks Write to .my_agent/capabilities/', async () => {
    const result = await hook(makeInput('Write', '/home/nina/.my_agent/capabilities/stt-deepgram/config.yaml'), undefined, {} as any)
    expect(result.decision).toBe('block')
  })

  it('blocks Edit to .my_agent/capabilities/', async () => {
    const result = await hook(makeInput('Edit', '/home/nina/.my_agent/capabilities/stt-deepgram/CAPABILITY.md'), undefined, {} as any)
    expect(result.decision).toBe('block')
  })

  it('blocks Write to .my_agent/spaces/', async () => {
    const result = await hook(makeInput('Write', '/home/nina/.my_agent/spaces/invoices/manifest.md'), undefined, {} as any)
    expect(result.decision).toBe('block')
  })

  it('blocks Write to .my_agent/config.yaml', async () => {
    const result = await hook(makeInput('Write', '/home/nina/.my_agent/config.yaml'), undefined, {} as any)
    expect(result.decision).toBe('block')
  })

  it('allows Write to .my_agent/notebook/', async () => {
    const result = await hook(makeInput('Write', '/home/nina/.my_agent/notebook/reference/contacts.md'), undefined, {} as any)
    expect(result.decision).toBeUndefined()
  })

  it('allows Write to .my_agent/inbox/', async () => {
    const result = await hook(makeInput('Write', '/home/nina/.my_agent/inbox/task-1/CLAUDE.md'), undefined, {} as any)
    expect(result.decision).toBeUndefined()
  })

  it('allows Read to .my_agent/capabilities/', async () => {
    const result = await hook(makeInput('Read', '/home/nina/.my_agent/capabilities/stt-deepgram/config.yaml'), undefined, {} as any)
    expect(result.decision).toBeUndefined()
  })
})
