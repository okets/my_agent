import { describe, it, expect, beforeEach } from 'vitest'
import { createDelegationEnforcer } from '../src/hooks/delegation.js'
import type { PreToolUseHookInput } from '@anthropic-ai/claude-agent-sdk'

function makePreToolInput(toolName: string): PreToolUseHookInput {
  return {
    hook_event_name: 'PreToolUse',
    tool_name: toolName,
    tool_input: toolName === 'WebSearch' ? { query: 'test query' } : {},
    tool_use_id: `toolu_${Math.random().toString(36).slice(2)}`,
  } as PreToolUseHookInput
}

const signal = new AbortController().signal

describe('createDelegationEnforcer', () => {
  let enforcer: ReturnType<typeof createDelegationEnforcer>

  beforeEach(() => {
    enforcer = createDelegationEnforcer(2)
  })

  it('should allow first WebSearch call', async () => {
    const result = await enforcer.preToolUse(makePreToolInput('WebSearch'), 'tool-1', { signal })
    expect(result).toEqual({})
  })

  it('should allow second WebSearch call (at budget)', async () => {
    await enforcer.preToolUse(makePreToolInput('WebSearch'), 'tool-1', { signal })
    const result = await enforcer.preToolUse(makePreToolInput('WebSearch'), 'tool-2', { signal })
    expect(result).toEqual({})
  })

  it('should deny on the call that exceeds budget', async () => {
    await enforcer.preToolUse(makePreToolInput('WebSearch'), 'tool-1', { signal })
    await enforcer.preToolUse(makePreToolInput('WebSearch'), 'tool-2', { signal })
    const result = await enforcer.preToolUse(makePreToolInput('WebSearch'), 'tool-3', { signal })

    expect(result).toHaveProperty('systemMessage')
    expect((result as any).systemMessage).toContain('create_automation')
    expect((result as any).systemMessage).toContain('once: true')
    expect((result as any).hookSpecificOutput.hookEventName).toBe('PreToolUse')
    expect((result as any).hookSpecificOutput.permissionDecision).toBe('deny')
  })

  it('should block all subsequent calls after exceeding budget', async () => {
    for (let i = 0; i < 3; i++) {
      await enforcer.preToolUse(makePreToolInput('WebSearch'), `tool-${i}`, { signal })
    }
    const result = await enforcer.preToolUse(makePreToolInput('WebSearch'), 'tool-4', { signal })

    expect((result as any).hookSpecificOutput.permissionDecision).toBe('deny')
  })

  it('should not affect non-WebSearch tools', async () => {
    const result = await enforcer.preToolUse(makePreToolInput('Read'), 'tool-1', { signal })
    expect(result).toEqual({})
  })

  it('should reset count on new turn', async () => {
    // Exhaust budget
    await enforcer.preToolUse(makePreToolInput('WebSearch'), 'tool-1', { signal })
    await enforcer.preToolUse(makePreToolInput('WebSearch'), 'tool-2', { signal })
    await enforcer.preToolUse(makePreToolInput('WebSearch'), 'tool-3', { signal })

    // Reset
    enforcer.resetTurn()

    // Should be allowed again
    const result = await enforcer.preToolUse(makePreToolInput('WebSearch'), 'tool-4', { signal })
    expect(result).toEqual({})
  })

  it('should work with custom budget', async () => {
    const strict = createDelegationEnforcer(1)
    // First call allowed
    const r1 = await strict.preToolUse(makePreToolInput('WebSearch'), 'tool-1', { signal })
    expect(r1).toEqual({})
    // Second call denied
    const r2 = await strict.preToolUse(makePreToolInput('WebSearch'), 'tool-2', { signal })
    expect((r2 as any).hookSpecificOutput.permissionDecision).toBe('deny')
  })
})
