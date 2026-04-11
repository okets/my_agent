import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { scanCapabilities } from '../../src/capabilities/scanner.js'

describe('scanner — system tools and entrypoint', () => {
  let capDir: string
  let envPath: string

  beforeEach(() => {
    const base = join(tmpdir(), `cap-scan-test-${Date.now()}`)
    capDir = join(base, 'capabilities')
    mkdirSync(capDir, { recursive: true })
    envPath = join(base, '.env')
    writeFileSync(envPath, '')
  })

  afterEach(() => {
    rmSync(capDir.replace('/capabilities', ''), { recursive: true, force: true })
  })

  it('reads entrypoint from frontmatter', async () => {
    const dir = join(capDir, 'test-mcp')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'CAPABILITY.md'), [
      '---',
      'name: Test MCP',
      'provides: test-type',
      'interface: mcp',
      'entrypoint: npx tsx src/server.ts',
      '---',
      'Test capability.',
    ].join('\n'))
    writeFileSync(join(dir, '.enabled'), new Date().toISOString())

    const caps = await scanCapabilities(capDir, envPath)
    expect(caps).toHaveLength(1)
    expect(caps[0].entrypoint).toBe('npx tsx src/server.ts')
    expect(caps[0].interface).toBe('mcp')
  })

  it('marks unavailable when required system tools are missing', async () => {
    const dir = join(capDir, 'needs-tools')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'CAPABILITY.md'), [
      '---',
      'name: Needs Tools',
      'provides: test-type',
      'interface: mcp',
      'entrypoint: ./bin/server',
      'requires:',
      '  system:',
      '    - definitely_not_a_real_tool_xyz',
      '---',
      'Test.',
    ].join('\n'))

    const caps = await scanCapabilities(capDir, envPath)
    expect(caps[0].status).toBe('unavailable')
    expect(caps[0].unavailableReason).toContain('definitely_not_a_real_tool_xyz')
  })

  it('marks available when system tools exist', async () => {
    const dir = join(capDir, 'has-tools')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'CAPABILITY.md'), [
      '---',
      'name: Has Tools',
      'provides: test-type',
      'interface: mcp',
      'entrypoint: ./bin/server',
      'requires:',
      '  system:',
      '    - ls',
      '---',
      'Test.',
    ].join('\n'))
    writeFileSync(join(dir, '.enabled'), new Date().toISOString())

    const caps = await scanCapabilities(capDir, envPath)
    expect(caps[0].status).toBe('available')
  })

  it('reads .enabled file — enabled when present', async () => {
    const dir = join(capDir, 'toggle-test')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'CAPABILITY.md'), [
      '---',
      'name: Toggle Test',
      'provides: test-type',
      'interface: script',
      '---',
      'Test.',
    ].join('\n'))
    writeFileSync(join(dir, '.enabled'), new Date().toISOString())

    const caps = await scanCapabilities(capDir, envPath)
    expect(caps[0].enabled).toBe(true)
  })

  it('reads .enabled file — disabled when absent', async () => {
    const dir = join(capDir, 'no-toggle')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'CAPABILITY.md'), [
      '---',
      'name: No Toggle',
      'provides: test-type',
      'interface: script',
      '---',
      'Test.',
    ].join('\n'))
    // No .enabled file

    const caps = await scanCapabilities(capDir, envPath)
    expect(caps[0].enabled).toBe(false)
  })

  it('existing .mcp.json capabilities still work after scanner changes', async () => {
    const dir = join(capDir, 'mcp-json-cap')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'CAPABILITY.md'), [
      '---',
      'name: MCP JSON Cap',
      'provides: test-type',
      'interface: mcp',
      '---',
      'Test.',
    ].join('\n'))
    // .mcp.json pattern — no entrypoint, uses direct passthrough
    writeFileSync(join(dir, '.mcp.json'), JSON.stringify({
      type: 'stdio',
      command: 'echo',
      args: ['test'],
    }))
    writeFileSync(join(dir, '.enabled'), new Date().toISOString())

    const caps = await scanCapabilities(capDir, envPath)
    expect(caps[0].status).toBe('available')
    expect(caps[0].mcpConfig).toBeDefined()
    expect(caps[0].entrypoint).toBeUndefined() // no entrypoint — uses .mcp.json
  })

  it('entrypoint and .mcp.json are mutually exclusive — entrypoint wins', async () => {
    const dir = join(capDir, 'both-patterns')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'CAPABILITY.md'), [
      '---',
      'name: Both Patterns',
      'provides: test-type',
      'interface: mcp',
      'entrypoint: npx tsx src/server.ts',
      '---',
      'Test.',
    ].join('\n'))
    // Both entrypoint AND .mcp.json present — entrypoint should win, .mcp.json ignored
    writeFileSync(join(dir, '.mcp.json'), JSON.stringify({
      type: 'stdio',
      command: 'echo',
      args: ['test'],
    }))
    writeFileSync(join(dir, '.enabled'), new Date().toISOString())

    const caps = await scanCapabilities(capDir, envPath)
    expect(caps[0].entrypoint).toBe('npx tsx src/server.ts')
    expect(caps[0].mcpConfig).toBeUndefined() // .mcp.json not loaded when entrypoint present
  })
})
