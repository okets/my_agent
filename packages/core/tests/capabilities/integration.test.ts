import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, rmSync, cpSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { scanCapabilities } from '../../src/capabilities/scanner.js'
import { CapabilityRegistry } from '../../src/capabilities/registry.js'
import { McpCapabilitySpawner } from '../../src/capabilities/mcp-spawner.js'
import { createCapabilityRateLimiter } from '../../src/capabilities/mcp-middleware.js'

const smokeFixtureDir = join(import.meta.dirname, '..', 'fixtures', 'smoke-mcp-server')

describe('MCP capability integration', () => {
  let baseDir: string
  let capDir: string
  let envPath: string

  beforeEach(() => {
    baseDir = join(tmpdir(), `cap-integration-${Date.now()}`)
    capDir = join(baseDir, 'capabilities')
    mkdirSync(capDir, { recursive: true })
    envPath = join(baseDir, '.env')
    writeFileSync(envPath, '')
  })

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true })
  })

  it('full flow: scan → registry → spawn → rate limit → toggle → shutdown', async () => {
    // 1. Set up a capability folder with smoke server
    const destDir = join(capDir, 'smoke-test')
    cpSync(smokeFixtureDir, destDir, { recursive: true })
    writeFileSync(join(destDir, 'CAPABILITY.md'), [
      '---',
      'name: Smoke Test',
      'provides: smoke',
      'interface: mcp',
      'entrypoint: npx tsx server.ts',
      '---',
      'Smoke test MCP capability.',
    ].join('\n'))
    // Enable it
    writeFileSync(join(destDir, '.enabled'), new Date().toISOString())

    // 2. Scan
    const caps = await scanCapabilities(capDir, envPath)
    expect(caps).toHaveLength(1)
    expect(caps[0].enabled).toBe(true)
    expect(caps[0].entrypoint).toBe('npx tsx server.ts')

    // 3. Registry gates on enabled
    const registry = new CapabilityRegistry()
    registry.load(caps)
    expect(registry.get('smoke')).toBeDefined()
    expect(registry.isEnabled('smoke')).toBe(true)

    // 4. Spawner connects
    const spawner = new McpCapabilitySpawner()
    const cap = registry.get('smoke')!
    const handle = await spawner.spawn(cap, 'test-session')
    expect(handle.tools.length).toBeGreaterThanOrEqual(1)

    // 5. Rate limiter works
    const limiter = createCapabilityRateLimiter({ maxPerMinute: 2 })
    expect(limiter.check('smoke')).toBe(true)
    expect(limiter.check('smoke')).toBe(true)
    expect(limiter.check('smoke')).toBe(false)

    // 6. Toggle off — registry no longer returns it
    const events: unknown[] = []
    registry.on('capability:changed', (e) => events.push(e))
    registry.toggle('smoke')
    expect(registry.get('smoke')).toBeUndefined()
    expect(events).toHaveLength(1)

    // 7. Cleanup
    await spawner.shutdownAll()
  }, 30_000)
})
