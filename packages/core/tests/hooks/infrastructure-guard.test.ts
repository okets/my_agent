/**
 * Unit Tests — createInfrastructureGuard
 *
 * Verifies that the infrastructure guard blocks writes to protected paths
 * and allows writes to safe task workspaces.
 */

import { describe, it, expect } from 'vitest'
import type { PreToolUseHookInput } from '@anthropic-ai/claude-agent-sdk'
import { createInfrastructureGuard } from '../../src/hooks/safety.js'

const AGENT_DIR = '/home/user/.my_agent'

function makeInput(filePath: string | undefined): PreToolUseHookInput {
  return {
    tool_name: 'Write',
    tool_input: filePath !== undefined ? { file_path: filePath } : {},
  } as unknown as PreToolUseHookInput
}

function makeNullInput(): PreToolUseHookInput {
  return {
    tool_name: 'Write',
    tool_input: null,
  } as unknown as PreToolUseHookInput
}

describe('createInfrastructureGuard — blocked paths', () => {
  const guard = createInfrastructureGuard(AGENT_DIR)

  it('blocks Write to brain/AGENTS.md', async () => {
    const result = await guard(makeInput(`${AGENT_DIR}/brain/AGENTS.md`), 'id1', undefined as never)
    expect(result.decision).toBe('block')
  })

  it('blocks Write to a file inside .claude/skills/', async () => {
    const result = await guard(
      makeInput(`${AGENT_DIR}/.claude/skills/scheduling/SKILL.md`),
      'id2',
      undefined as never,
    )
    expect(result.decision).toBe('block')
  })

  it('blocks Write to config.yaml', async () => {
    const result = await guard(
      makeInput(`${AGENT_DIR}/config.yaml`),
      'id3',
      undefined as never,
    )
    expect(result.decision).toBe('block')
  })

  it('blocks Write to a .env file', async () => {
    const result = await guard(
      makeInput('/home/user/my_agent/packages/dashboard/.env'),
      'id4',
      undefined as never,
    )
    expect(result.decision).toBe('block')
  })

  it('blocks Write inside auth/', async () => {
    const result = await guard(
      makeInput(`${AGENT_DIR}/auth/whatsapp.json`),
      'id5',
      undefined as never,
    )
    expect(result.decision).toBe('block')
  })

  it('blocks Write to a .db file', async () => {
    const result = await guard(
      makeInput('/home/user/.my_agent/data/memory.db'),
      'id6',
      undefined as never,
    )
    expect(result.decision).toBe('block')
  })

  it('blocks Write to .guardrails', async () => {
    const result = await guard(
      makeInput('/home/user/my_agent/.guardrails'),
      'id7',
      undefined as never,
    )
    expect(result.decision).toBe('block')
  })

  it('blocks Write to .git/hooks/ scripts', async () => {
    const result = await guard(
      makeInput('/home/user/my_agent/.git/hooks/pre-commit'),
      'id8',
      undefined as never,
    )
    expect(result.decision).toBe('block')
  })

  it('blocks Write to a .service file', async () => {
    const result = await guard(
      makeInput('/home/user/.config/systemd/user/nina-dashboard.service'),
      'id9',
      undefined as never,
    )
    expect(result.decision).toBe('block')
  })

  it('returns hookSpecificOutput with deny on block', async () => {
    const result = await guard(makeInput(`${AGENT_DIR}/brain/AGENTS.md`), 'idX', undefined as never)
    expect(result.hookSpecificOutput).toBeDefined()
    expect(
      (result.hookSpecificOutput as { permissionDecision: string }).permissionDecision,
    ).toBe('deny')
  })
})

describe('createInfrastructureGuard — allowed paths', () => {
  const guard = createInfrastructureGuard(AGENT_DIR)

  it('allows Write to notebook/', async () => {
    const result = await guard(
      makeInput(`${AGENT_DIR}/notebook/daily-note.md`),
      'id10',
      undefined as never,
    )
    expect(result.decision).toBeUndefined()
  })

  it('allows Write to a task workspace', async () => {
    const result = await guard(
      makeInput(`${AGENT_DIR}/inbox/task-abc/output.md`),
      'id11',
      undefined as never,
    )
    expect(result.decision).toBeUndefined()
  })

  it('allows Write to properties/', async () => {
    const result = await guard(
      makeInput(`${AGENT_DIR}/properties/home.md`),
      'id12',
      undefined as never,
    )
    expect(result.decision).toBeUndefined()
  })

  it('allows Write to an arbitrary safe path', async () => {
    const result = await guard(
      makeInput('/tmp/scratch/output.txt'),
      'id13',
      undefined as never,
    )
    expect(result.decision).toBeUndefined()
  })
})

describe('createInfrastructureGuard — fail-closed behaviour', () => {
  const guard = createInfrastructureGuard(AGENT_DIR)

  it('blocks when tool_input is null', async () => {
    const result = await guard(makeNullInput(), 'id14', undefined as never)
    expect(result.decision).toBe('block')
  })

  it('blocks when file_path is missing from tool_input', async () => {
    const result = await guard(makeInput(undefined), 'id15', undefined as never)
    expect(result.decision).toBe('block')
  })
})
