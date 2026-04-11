import { describe, it, expect, afterEach } from 'vitest'
import { scanCapabilities } from '../../src/capabilities/scanner.js'
import { CapabilityRegistry } from '../../src/capabilities/registry.js'
import { join } from 'node:path'
import { writeFileSync, unlinkSync } from 'node:fs'

const FIXTURES_DIR = join(import.meta.dirname, '..', 'fixtures')
const FIXTURE_ENABLED_PATH = join(FIXTURES_DIR, 'desktop-x11-fixture', '.enabled')

afterEach(() => {
  try { unlinkSync(FIXTURE_ENABLED_PATH) } catch { /* already gone */ }
})

describe('MCP tool schema validation', () => {
  it('validates all 7 required desktop-control tools are present', async () => {
    writeFileSync(FIXTURE_ENABLED_PATH, new Date().toISOString())

    const caps = await scanCapabilities(FIXTURES_DIR, '/dev/null')
    const registry = new CapabilityRegistry()
    registry.setProjectRoot(join(FIXTURES_DIR, '..', '..'))
    registry.load(caps)

    const result = await registry.test('desktop-control')
    expect(result.status).toBe('ok')
  }, 30_000)

  it('reports error when required tool is missing', async () => {
    const { DESKTOP_CONTROL_CONTRACT } = await import('../../src/capabilities/tool-contracts.js')
    expect(DESKTOP_CONTROL_CONTRACT.required).toHaveLength(7)
    expect(DESKTOP_CONTROL_CONTRACT.required.map(t => t.name)).toEqual([
      'desktop_screenshot',
      'desktop_click',
      'desktop_type',
      'desktop_key',
      'desktop_scroll',
      'desktop_info',
      'desktop_wait',
    ])
  })

  it('validates required tool input parameters', async () => {
    const { validateToolContract } = await import('../../src/capabilities/tool-contracts.js')

    const tools = [
      { name: 'desktop_screenshot', inputSchema: { type: 'object', properties: { region: { type: 'object' } } } },
      { name: 'desktop_click', inputSchema: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' } }, required: ['x', 'y'] } },
      { name: 'desktop_type', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } },
      { name: 'desktop_key', inputSchema: { type: 'object', properties: { key: { type: 'string' } }, required: ['key'] } },
      { name: 'desktop_scroll', inputSchema: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' }, direction: {} }, required: ['x', 'y', 'direction'] } },
      { name: 'desktop_info', inputSchema: { type: 'object', properties: { query: {} }, required: ['query'] } },
      { name: 'desktop_wait', inputSchema: { type: 'object', properties: { seconds: { type: 'number' } }, required: ['seconds'] } },
    ]

    const result = validateToolContract('desktop-control', tools)
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('detects missing required tool', async () => {
    const { validateToolContract } = await import('../../src/capabilities/tool-contracts.js')

    // Missing desktop_wait
    const tools = [
      { name: 'desktop_screenshot', inputSchema: { type: 'object', properties: {} } },
      { name: 'desktop_click', inputSchema: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' } }, required: ['x', 'y'] } },
      { name: 'desktop_type', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } },
      { name: 'desktop_key', inputSchema: { type: 'object', properties: { key: { type: 'string' } }, required: ['key'] } },
      { name: 'desktop_scroll', inputSchema: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' }, direction: {} }, required: ['x', 'y', 'direction'] } },
      { name: 'desktop_info', inputSchema: { type: 'object', properties: { query: {} }, required: ['query'] } },
    ]

    const result = validateToolContract('desktop-control', tools)
    expect(result.valid).toBe(false)
    expect(result.errors).toContainEqual(expect.stringContaining('desktop_wait'))
  })

  it('detects missing required parameter', async () => {
    const { validateToolContract } = await import('../../src/capabilities/tool-contracts.js')

    // desktop_click missing required 'x' param
    const tools = [
      { name: 'desktop_screenshot', inputSchema: { type: 'object', properties: {} } },
      { name: 'desktop_click', inputSchema: { type: 'object', properties: { y: { type: 'number' } }, required: ['y'] } },
      { name: 'desktop_type', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } },
      { name: 'desktop_key', inputSchema: { type: 'object', properties: { key: { type: 'string' } }, required: ['key'] } },
      { name: 'desktop_scroll', inputSchema: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' }, direction: {} }, required: ['x', 'y', 'direction'] } },
      { name: 'desktop_info', inputSchema: { type: 'object', properties: { query: {} }, required: ['query'] } },
      { name: 'desktop_wait', inputSchema: { type: 'object', properties: { seconds: { type: 'number' } }, required: ['seconds'] } },
    ]

    const result = validateToolContract('desktop-control', tools)
    expect(result.valid).toBe(false)
    expect(result.errors).toContainEqual(expect.stringContaining('desktop_click'))
    expect(result.errors).toContainEqual(expect.stringContaining('x'))
  })
})
