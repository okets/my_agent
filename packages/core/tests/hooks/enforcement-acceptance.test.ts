import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createHooks } from '../../src/hooks/factory.js'
import type { PreToolUseHookInput } from '@anthropic-ai/claude-agent-sdk'

const PROJECT_ROOT = '/home/nina/my_agent'

function makeInput(toolName: string, filePath: string): PreToolUseHookInput {
  return {
    hook_event_name: 'PreToolUse',
    tool_name: toolName,
    tool_input: { file_path: filePath },
  } as PreToolUseHookInput
}

async function isBlocked(
  hooks: ReturnType<typeof createHooks>,
  toolName: string,
  filePath: string,
): Promise<boolean> {
  const preToolUse = hooks.PreToolUse ?? []
  for (const matcher of preToolUse) {
    if (matcher.matcher && !new RegExp(matcher.matcher).test(toolName)) continue
    for (const hook of matcher.hooks) {
      const result = await hook(makeInput(toolName, filePath), undefined, {} as any)
      if (result.decision === 'block') return true
    }
  }
  return false
}

describe('S4 Acceptance: enforcement hooks across trust levels', () => {
  it('source code protection blocks Write to packages/ at ALL trust levels', async () => {
    for (const level of ['brain', 'task', 'subagent'] as const) {
      const hooks = createHooks(level, {
        agentDir: '/home/nina/.my_agent',
        projectRoot: PROJECT_ROOT,
      })
      const blocked = await isBlocked(
        hooks,
        'Write',
        `${PROJECT_ROOT}/packages/core/src/brain.ts`,
      )
      expect(blocked, `${level} should block Write to packages/`).toBe(true)
    }
  })

  it('source code protection blocks Write to docs/ and scripts/', async () => {
    const hooks = createHooks('brain', { projectRoot: PROJECT_ROOT })
    expect(
      await isBlocked(hooks, 'Write', `${PROJECT_ROOT}/docs/design/spec.md`),
    ).toBe(true)
    expect(
      await isBlocked(hooks, 'Edit', `${PROJECT_ROOT}/scripts/deploy.sh`),
    ).toBe(true)
  })

  it('source code protection allows Write to .my_agent/notebook/', async () => {
    const hooks = createHooks('brain', { projectRoot: PROJECT_ROOT })
    // .my_agent/notebook/ is outside project root and not a capability path
    expect(
      await isBlocked(hooks, 'Write', '/home/nina/.my_agent/notebook/reference/notes.md'),
    ).toBe(false)
  })

  it('Read is never blocked by source code protection', async () => {
    for (const level of ['brain', 'task', 'subagent'] as const) {
      const hooks = createHooks(level, { projectRoot: PROJECT_ROOT })
      const blocked = await isBlocked(
        hooks,
        'Read',
        `${PROJECT_ROOT}/packages/core/src/brain.ts`,
      )
      expect(blocked, `${level} should never block Read`).toBe(false)
    }
  })

  it('capability routing blocks brain from editing capabilities', async () => {
    const hooks = createHooks('brain', { projectRoot: PROJECT_ROOT })
    expect(
      await isBlocked(hooks, 'Edit', '/home/nina/.my_agent/capabilities/stt-deepgram/config.yaml'),
    ).toBe(true)
    expect(
      await isBlocked(hooks, 'Write', '/home/nina/.my_agent/spaces/invoices/manifest.md'),
    ).toBe(true)
    expect(
      await isBlocked(hooks, 'Write', '/home/nina/.my_agent/config.yaml'),
    ).toBe(true)
  })

  it('capability routing does NOT block task level', async () => {
    const hooks = createHooks('task', {
      agentDir: '/home/nina/.my_agent',
      projectRoot: PROJECT_ROOT,
    })
    // Task workers need to write to capabilities
    expect(
      await isBlocked(hooks, 'Write', '/home/nina/.my_agent/capabilities/stt-deepgram/config.yaml'),
    ).toBe(false)
  })

  it('capability routing does NOT block subagent level', async () => {
    const hooks = createHooks('subagent', {
      projectRoot: PROJECT_ROOT,
      allowedPaths: ['/home/nina/.my_agent/capabilities/'],
    })
    expect(
      await isBlocked(hooks, 'Write', '/home/nina/.my_agent/capabilities/test/script.sh'),
    ).toBe(false)
  })

  describe('Stop hook soft reminder', () => {
    let tmpDir: string

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stop-accept-'))
    })

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    })

    it('task level gets Stop hook when todoPath is provided', () => {
      const todoPath = path.join(tmpDir, 'todos.json')
      fs.writeFileSync(todoPath, JSON.stringify({ items: [], last_activity: new Date().toISOString() }))

      const hooks = createHooks('task', {
        agentDir: '/home/nina/.my_agent',
        todoPath,
        projectRoot: PROJECT_ROOT,
      })
      expect(hooks.Stop).toBeDefined()
      expect(hooks.Stop).toHaveLength(1)
    })

    it('brain level does NOT get Stop hook', () => {
      const hooks = createHooks('brain', {
        todoPath: path.join(tmpDir, 'todos.json'),
        projectRoot: PROJECT_ROOT,
      })
      expect(hooks.Stop).toBeUndefined()
    })

    it('Stop hook returns reminder for incomplete mandatory items', async () => {
      const todoPath = path.join(tmpDir, 'todos.json')
      fs.writeFileSync(todoPath, JSON.stringify({
        items: [
          { id: 't1', text: 'Done task', status: 'done', mandatory: true },
          { id: 't2', text: 'Pending task', status: 'pending', mandatory: true },
        ],
        last_activity: new Date().toISOString(),
      }))

      const hooks = createHooks('task', {
        agentDir: '/home/nina/.my_agent',
        todoPath,
        projectRoot: PROJECT_ROOT,
      })

      const stopHooks = hooks.Stop!
      const result = await stopHooks[0].hooks[0]({} as any, undefined, {} as any)
      expect(result.systemMessage).toContain('1 incomplete mandatory items')
      expect(result.systemMessage).toContain('t2: Pending task')
    })
  })

  it('source code protection works from dashboard cwd (production path)', async () => {
    // In production, cwd = /home/nina/my_agent/packages/dashboard
    // Without projectRoot, path.relative would resolve to ../core/... which starts with ..
    // and would be allowed. With projectRoot = /home/nina/my_agent, it resolves correctly.
    const hooks = createHooks('task', {
      agentDir: '/home/nina/.my_agent',
      projectRoot: '/home/nina/my_agent', // must be set for production
    })
    expect(
      await isBlocked(hooks, 'Write', '/home/nina/my_agent/packages/core/src/brain.ts'),
    ).toBe(true)
    expect(
      await isBlocked(hooks, 'Edit', '/home/nina/my_agent/skills/capability-templates/test.md'),
    ).toBe(true)
  })

  it('existing bash blocker still works at task level', async () => {
    const hooks = createHooks('task', {
      agentDir: '/home/nina/.my_agent',
      projectRoot: PROJECT_ROOT,
    })
    const blocked = await isBlocked(hooks, 'Bash', 'rm -rf /')
    // Bash blocker checks command input, not file_path
    // We need to test with correct input shape
    const preToolUse = hooks.PreToolUse ?? []
    let bashBlocked = false
    for (const matcher of preToolUse) {
      if (matcher.matcher && !new RegExp(matcher.matcher).test('Bash')) continue
      for (const hook of matcher.hooks) {
        const result = await hook(
          {
            hook_event_name: 'PreToolUse',
            tool_name: 'Bash',
            tool_input: { command: 'rm -rf /' },
          } as any,
          undefined,
          {} as any,
        )
        if (result.decision === 'block') bashBlocked = true
      }
    }
    expect(bashBlocked).toBe(true)
  })
})
