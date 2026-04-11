import { describe, it, expect } from 'vitest'
import { join } from 'node:path'
import { testCapability } from '../../src/capabilities/test-harness.js'
import type { Capability } from '../../src/capabilities/types.js'

const fixtureDir = join(import.meta.dirname, '..', 'fixtures', 'smoke-mcp-server')

describe('testCapability — MCP interface', () => {
  it('passes for valid MCP server with matching tools', async () => {
    const cap: Capability = {
      name: 'Smoke Test',
      provides: 'smoke',
      interface: 'mcp',
      path: fixtureDir,
      status: 'available',
      health: 'untested',
      enabled: true,
      entrypoint: 'npx tsx server.ts',
    }

    const result = await testCapability(cap, '')
    expect(result.status).toBe('ok')
    expect(result.latencyMs).toBeGreaterThan(0)
  }, 20_000)

  it('fails when entrypoint is missing', async () => {
    const cap: Capability = {
      name: 'No Entry',
      provides: 'smoke',
      interface: 'mcp',
      path: fixtureDir,
      status: 'available',
      health: 'untested',
      enabled: true,
    }

    const result = await testCapability(cap, '')
    expect(result.status).toBe('error')
    expect(result.message).toContain('entrypoint')
  })

  it('MCP capabilities without a specific test contract still get the generic MCP test', async () => {
    const cap: Capability = {
      name: 'Unknown',
      provides: 'nonexistent-type',
      interface: 'mcp',
      path: fixtureDir,
      status: 'available',
      health: 'untested',
      enabled: true,
      entrypoint: 'npx tsx server.ts',
    }

    const result = await testCapability(cap, '')
    expect(result.status).toBe('ok')
  }, 20_000)
})
