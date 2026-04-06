import { describe, it, expect } from 'vitest'
import { createSourceCodeProtection } from '../../src/hooks/safety.js'
import type { PreToolUseHookInput } from '@anthropic-ai/claude-agent-sdk'

function makeInput(toolName: string, filePath: string): PreToolUseHookInput {
  return {
    hook_event_name: 'PreToolUse',
    tool_name: toolName,
    tool_input: { file_path: filePath },
  } as PreToolUseHookInput
}

describe('createSourceCodeProtection', () => {
  const hook = createSourceCodeProtection('/home/nina/my_agent')

  it('blocks Write to packages/', async () => {
    const result = await hook(makeInput('Write', '/home/nina/my_agent/packages/core/src/brain.ts'), undefined, {} as any)
    expect(result.decision).toBe('block')
  })

  it('blocks Edit to packages/', async () => {
    const result = await hook(makeInput('Edit', '/home/nina/my_agent/packages/dashboard/src/app.ts'), undefined, {} as any)
    expect(result.decision).toBe('block')
  })

  it('blocks Write to skills/', async () => {
    const result = await hook(makeInput('Write', '/home/nina/my_agent/skills/capability-templates/test.md'), undefined, {} as any)
    expect(result.decision).toBe('block')
  })

  it('blocks Write to docs/', async () => {
    const result = await hook(makeInput('Write', '/home/nina/my_agent/docs/design/new-spec.md'), undefined, {} as any)
    expect(result.decision).toBe('block')
  })

  it('blocks Write to scripts/', async () => {
    const result = await hook(makeInput('Write', '/home/nina/my_agent/scripts/deploy.sh'), undefined, {} as any)
    expect(result.decision).toBe('block')
  })

  it('blocks Write to root CLAUDE.md', async () => {
    const result = await hook(makeInput('Write', '/home/nina/my_agent/CLAUDE.md'), undefined, {} as any)
    expect(result.decision).toBe('block')
  })

  it('blocks Write to root package.json', async () => {
    const result = await hook(makeInput('Write', '/home/nina/my_agent/package.json'), undefined, {} as any)
    expect(result.decision).toBe('block')
  })

  it('allows Write to .my_agent/', async () => {
    const result = await hook(makeInput('Write', '/home/nina/.my_agent/capabilities/test/config.yaml'), undefined, {} as any)
    expect(result.decision).toBeUndefined()
  })

  it('allows Read to packages/', async () => {
    const result = await hook(makeInput('Read', '/home/nina/my_agent/packages/core/src/brain.ts'), undefined, {} as any)
    expect(result.decision).toBeUndefined()
  })

  it('allows Bash (not Write/Edit)', async () => {
    const result = await hook(makeInput('Bash', '/home/nina/my_agent/packages/core/src/brain.ts'), undefined, {} as any)
    expect(result.decision).toBeUndefined()
  })
})
