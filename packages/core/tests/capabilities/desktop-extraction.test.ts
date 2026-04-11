import { describe, it, expect, afterEach } from 'vitest'
import { scanCapabilities } from '../../src/capabilities/scanner.js'
import { CapabilityRegistry } from '../../src/capabilities/registry.js'
import { join } from 'node:path'
import { writeFileSync, unlinkSync, existsSync } from 'node:fs'

const FIXTURES_DIR = join(import.meta.dirname, '..', 'fixtures')
const FIXTURE_ENABLED_PATH = join(FIXTURES_DIR, 'desktop-x11-fixture', '.enabled')

// Ensure cleanup after each test in case a test fails mid-way
afterEach(() => {
  try { unlinkSync(FIXTURE_ENABLED_PATH) } catch { /* already gone */ }
})

describe('Desktop extraction integration', () => {
  it('scanner discovers desktop-x11-fixture as mcp capability with entrypoint', async () => {
    const caps = await scanCapabilities(FIXTURES_DIR, '/dev/null')
    const desktop = caps.find(c => c.provides === 'desktop-control')

    expect(desktop).toBeDefined()
    expect(desktop!.interface).toBe('mcp')
    expect(desktop!.entrypoint).toBe('npx tsx src/server.ts')
    expect(desktop!.status).toBe('available')
  })

  it('registry toggle writes/removes .enabled file in capability folder', async () => {
    const caps = await scanCapabilities(FIXTURES_DIR, '/dev/null')
    const registry = new CapabilityRegistry()
    registry.load(caps)

    // Should not be enabled initially (no .enabled file)
    expect(registry.isEnabled('desktop-control')).toBe(false)

    // Toggle on
    const result = registry.toggle('desktop-control')
    expect(result).toBe(true)
    expect(existsSync(FIXTURE_ENABLED_PATH)).toBe(true)

    // Toggle off
    const result2 = registry.toggle('desktop-control')
    expect(result2).toBe(false)
    expect(existsSync(FIXTURE_ENABLED_PATH)).toBe(false)
  })

  it('test harness validates desktop-x11-fixture MCP server', async () => {
    // Enable the fixture capability so registry.get() returns it
    writeFileSync(FIXTURE_ENABLED_PATH, new Date().toISOString())

    const caps = await scanCapabilities(FIXTURES_DIR, '/dev/null')
    const registry = new CapabilityRegistry()
    registry.setProjectRoot(join(FIXTURES_DIR, '..', '..'))
    registry.load(caps)

    const testResult = await registry.test('desktop-control')
    expect(testResult.status).toBe('ok')
    expect(testResult.latencyMs).toBeGreaterThan(0)
  }, 30_000)
})
