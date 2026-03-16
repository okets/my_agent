/**
 * Unit Tests — createBashBlocker (extended patterns)
 *
 * Verifies that the extended patterns added for M6.9-S4 correctly block
 * service-stopping, process-killing, permission-wiping, and chown commands
 * while allowing normal benign usage.
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

describe('createBashBlocker — extended patterns (blocked)', () => {
  const blocker = createBashBlocker()

  it('blocks systemctl stop nina-dashboard', async () => {
    const result = await blocker(makeInput('systemctl stop nina-dashboard.service'), 'id1', undefined as never)
    expect(result.decision).toBe('block')
  })

  it('blocks systemctl disable nina-brain', async () => {
    const result = await blocker(makeInput('systemctl disable nina-brain.service'), 'id2', undefined as never)
    expect(result.decision).toBe('block')
  })

  it('blocks systemctl stop nina- (case-insensitive)', async () => {
    const result = await blocker(makeInput('SYSTEMCTL STOP NINA-FOO'), 'id3', undefined as never)
    expect(result.decision).toBe('block')
  })

  it('blocks kill command targeting nina', async () => {
    const result = await blocker(makeInput('kill -9 $(pgrep -f nina)'), 'id4', undefined as never)
    expect(result.decision).toBe('block')
  })

  it('blocks killall nina', async () => {
    const result = await blocker(makeInput('killall nina-brain'), 'id5', undefined as never)
    expect(result.decision).toBe('block')
  })

  it('blocks chmod 000 on a file', async () => {
    const result = await blocker(makeInput('chmod 000 /home/user/.my_agent/brain/AGENTS.md'), 'id6', undefined as never)
    expect(result.decision).toBe('block')
  })

  it('blocks chown on brain path', async () => {
    const result = await blocker(makeInput('chown root /home/user/.my_agent/brain'), 'id7', undefined as never)
    expect(result.decision).toBe('block')
  })

  it('blocks chown on .env', async () => {
    const result = await blocker(makeInput('chown www-data /app/.env'), 'id8', undefined as never)
    expect(result.decision).toBe('block')
  })

  it('blocks chown on auth path', async () => {
    const result = await blocker(makeInput('chown nobody /home/user/.my_agent/auth'), 'id9', undefined as never)
    expect(result.decision).toBe('block')
  })
})

describe('createBashBlocker — extended patterns (allowed)', () => {
  const blocker = createBashBlocker()

  it('allows systemctl status nina-dashboard', async () => {
    const result = await blocker(makeInput('systemctl status nina-dashboard.service'), 'id10', undefined as never)
    expect(result.decision).toBeUndefined()
  })

  it('allows systemctl start nina-dashboard', async () => {
    const result = await blocker(makeInput('systemctl start nina-dashboard.service'), 'id11', undefined as never)
    expect(result.decision).toBeUndefined()
  })

  it('allows normal kill of a non-nina PID', async () => {
    const result = await blocker(makeInput('kill -15 12345'), 'id12', undefined as never)
    expect(result.decision).toBeUndefined()
  })

  it('allows chmod 755 (not 000)', async () => {
    const result = await blocker(makeInput('chmod 755 /tmp/script.sh'), 'id13', undefined as never)
    expect(result.decision).toBeUndefined()
  })

  it('allows chown on non-infrastructure paths', async () => {
    const result = await blocker(makeInput('chown user:user /tmp/myfile.txt'), 'id14', undefined as never)
    expect(result.decision).toBeUndefined()
  })

  it('allows ls command', async () => {
    const result = await blocker(makeInput('ls -la /home/user'), 'id15', undefined as never)
    expect(result.decision).toBeUndefined()
  })

  it('allows git status', async () => {
    const result = await blocker(makeInput('git status'), 'id16', undefined as never)
    expect(result.decision).toBeUndefined()
  })
})
