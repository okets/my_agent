/**
 * Acceptance Tests — Restart-blocking patterns (M9.6-S3)
 *
 * Verifies that the new restart/self-kill patterns added to BLOCKED_BASH_PATTERNS
 * correctly deny agent self-restart attempts while allowing unrelated service commands.
 */

import { describe, it, expect } from 'vitest'
import type { PreToolUseHookInput } from '@anthropic-ai/claude-agent-sdk'
import { createBashBlocker } from '../../src/hooks/safety.js'

function makeInput(command: string): PreToolUseHookInput {
  return {
    tool_name: 'Bash',
    tool_input: { command },
  } as unknown as PreToolUseHookInput
}

describe('createBashBlocker — restart-blocking patterns (blocked)', () => {
  const blocker = createBashBlocker()

  it('blocks systemctl restart nina-dashboard', async () => {
    const result = await blocker(makeInput('systemctl restart nina-dashboard.service'), 'id1', undefined as never)
    expect(result.decision).toBe('block')
  })

  it('blocks systemctl start nina-dashboard', async () => {
    // After M9.6-S3: self-starting our own service is also blocked (same as restart)
    const result = await blocker(makeInput('systemctl start nina-dashboard.service'), 'id2', undefined as never)
    expect(result.decision).toBe('block')
  })

  it('blocks systemctl reload nina-brain', async () => {
    const result = await blocker(makeInput('systemctl reload nina-brain.service'), 'id3', undefined as never)
    expect(result.decision).toBe('block')
  })

  it('blocks systemctl restart nina- (case-insensitive)', async () => {
    const result = await blocker(makeInput('SYSTEMCTL RESTART NINA-FOO'), 'id4', undefined as never)
    expect(result.decision).toBe('block')
  })

  it('blocks pkill targeting nina', async () => {
    const result = await blocker(makeInput('pkill -f nina-dashboard'), 'id5', undefined as never)
    expect(result.decision).toBe('block')
  })

  it('blocks kill -9 on node process', async () => {
    const result = await blocker(makeInput('kill -9 $(pgrep node)'), 'id6', undefined as never)
    expect(result.decision).toBe('block')
  })

  it('blocks kill on nina process', async () => {
    const result = await blocker(makeInput('kill -15 $(pgrep nina)'), 'id7', undefined as never)
    expect(result.decision).toBe('block')
  })

  it('blocks legacy service syntax restart', async () => {
    const result = await blocker(makeInput('service nina-dashboard restart'), 'id8', undefined as never)
    expect(result.decision).toBe('block')
  })

  it('blocks legacy service syntax start', async () => {
    const result = await blocker(makeInput('service nina-brain start'), 'id9', undefined as never)
    expect(result.decision).toBe('block')
  })
})

describe('createBashBlocker — restart-blocking patterns (allowed)', () => {
  const blocker = createBashBlocker()

  it('allows systemctl restart on an unrelated service', async () => {
    const result = await blocker(makeInput('systemctl restart nginx.service'), 'id10', undefined as never)
    expect(result.decision).toBeUndefined()
  })

  it('allows systemctl start on an unrelated service', async () => {
    const result = await blocker(makeInput('systemctl start postgresql.service'), 'id11', undefined as never)
    expect(result.decision).toBeUndefined()
  })

  it('allows systemctl status nina-dashboard (read-only)', async () => {
    const result = await blocker(makeInput('systemctl status nina-dashboard.service'), 'id12', undefined as never)
    expect(result.decision).toBeUndefined()
  })

  it('allows pkill targeting a non-nina process', async () => {
    const result = await blocker(makeInput('pkill -f some-other-process'), 'id13', undefined as never)
    expect(result.decision).toBeUndefined()
  })

  it('allows kill on an arbitrary PID (not node/nina)', async () => {
    const result = await blocker(makeInput('kill -15 12345'), 'id14', undefined as never)
    expect(result.decision).toBeUndefined()
  })

  it('allows service status check', async () => {
    const result = await blocker(makeInput('service nginx status'), 'id15', undefined as never)
    expect(result.decision).toBeUndefined()
  })
})
