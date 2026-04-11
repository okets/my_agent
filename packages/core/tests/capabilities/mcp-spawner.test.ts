import { describe, it, expect, afterEach } from 'vitest'
import { join } from 'node:path'
import { McpCapabilitySpawner } from '../../src/capabilities/mcp-spawner.js'
import type { Capability } from '../../src/capabilities/types.js'

const fixtureDir = join(import.meta.dirname, '..', 'fixtures', 'smoke-mcp-server')

function makeSmokeCap(): Capability {
  return {
    name: 'Smoke Test',
    provides: 'smoke',
    interface: 'mcp',
    path: fixtureDir,
    status: 'available',
    health: 'untested',
    enabled: true,
    entrypoint: 'npx tsx server.ts',
  }
}

describe('McpCapabilitySpawner', () => {
  let spawner: McpCapabilitySpawner

  afterEach(async () => {
    if (spawner) await spawner.shutdownAll()
  })

  it('spawns a server and lists tools', async () => {
    spawner = new McpCapabilitySpawner()
    const handle = await spawner.spawn(makeSmokeCap(), 'session-1')

    expect(handle.tools.length).toBeGreaterThanOrEqual(1)
    const toolNames = handle.tools.map(t => t.name)
    expect(toolNames).toContain('smoke_ping')
    expect(toolNames).toContain('smoke_echo')
  }, 15_000)

  it('creates separate instances per session (factory pattern)', async () => {
    spawner = new McpCapabilitySpawner()
    const h1 = await spawner.spawn(makeSmokeCap(), 'session-1')
    const h2 = await spawner.spawn(makeSmokeCap(), 'session-2')

    expect(h1.sessionId).toBe('session-1')
    expect(h2.sessionId).toBe('session-2')
    expect(h1.pid).not.toBe(h2.pid)
  }, 15_000)

  it('shuts down a specific session', async () => {
    spawner = new McpCapabilitySpawner()
    await spawner.spawn(makeSmokeCap(), 'session-1')

    await spawner.shutdown('Smoke Test', 'session-1')
    expect(spawner.listActive()).toHaveLength(0)
  }, 15_000)

  it('shuts down all sessions for a capability', async () => {
    spawner = new McpCapabilitySpawner()
    await spawner.spawn(makeSmokeCap(), 'session-1')
    await spawner.spawn(makeSmokeCap(), 'session-2')

    await spawner.shutdownCapability('Smoke Test')
    expect(spawner.listActive()).toHaveLength(0)
  }, 15_000)

  it('emits crash event when child process exits unexpectedly', async () => {
    spawner = new McpCapabilitySpawner()
    const handle = await spawner.spawn(makeSmokeCap(), 'crash-session')
    expect(handle.process).not.toBeNull()

    const crashPromise = new Promise<unknown>((resolve) => {
      spawner.on('crash', (event) => resolve(event))
    })

    // Kill the child process to simulate unexpected exit
    handle.process!.kill('SIGKILL')

    const event = await crashPromise as { capabilityName: string; sessionId: string; pid: number }
    expect(event.capabilityName).toBe('Smoke Test')
    expect(event.sessionId).toBe('crash-session')
    expect(event.pid).toBe(handle.pid)

    // Handle should be removed from active list
    expect(spawner.listActive()).toHaveLength(0)
  }, 15_000)
})
