import { describe, it, expect, afterEach } from 'vitest'
import { McpCapabilitySpawner } from '../../src/capabilities/mcp-spawner.js'
import { join } from 'node:path'

const FIXTURE_PATH = join(import.meta.dirname, '..', 'fixtures', 'desktop-x11-fixture')

describe('McpCapabilitySpawner crash recovery (desktop-x11 fixture)', () => {
  let spawner: McpCapabilitySpawner

  afterEach(async () => {
    if (spawner) await spawner.shutdownAll()
  })

  it('emits crash event when child process is killed', async () => {
    spawner = new McpCapabilitySpawner()

    const handle = await spawner.spawn(
      { name: 'desktop-x11-test', path: FIXTURE_PATH, entrypoint: 'npx tsx src/server.ts' },
      'test-session-1',
    )

    expect(handle.tools.length).toBeGreaterThan(0)
    expect(handle.pid).toBeGreaterThan(0)
    expect(spawner.listActive()).toHaveLength(1)

    // Kill the child process — should trigger crash event
    const crashPromise = new Promise<{ capabilityName: string; sessionId: string; pid: number }>((resolve) => {
      spawner.on('crash', resolve)
    })

    handle.process?.kill('SIGKILL')

    const crashEvent = await crashPromise
    expect(crashEvent.capabilityName).toBe('desktop-x11-test')
    expect(crashEvent.pid).toBe(handle.pid)

    // Handle should be removed from active list
    expect(spawner.listActive()).toHaveLength(0)
  }, 15_000)

  it('lists tools from the MCP server', async () => {
    spawner = new McpCapabilitySpawner()

    const handle = await spawner.spawn(
      { name: 'desktop-x11-test', path: FIXTURE_PATH, entrypoint: 'npx tsx src/server.ts' },
      'test-session-2',
    )

    const toolNames = handle.tools.map(t => t.name)
    expect(toolNames).toContain('desktop_info')
    expect(toolNames).toContain('desktop_screenshot')
    expect(toolNames).toContain('desktop_click')

    await handle.shutdown()
    expect(spawner.listActive()).toHaveLength(0)
  }, 15_000)
})
