import { describe, it, expect } from 'vitest'
import { CapabilityRegistry } from '../../src/capabilities/registry.js'
import type { Capability } from '../../src/capabilities/types.js'

function makeCap(overrides: Partial<Capability> & { name: string }): Capability {
  return {
    provides: undefined,
    interface: 'mcp',
    path: '/tmp/fake',
    status: 'available',
    health: 'untested',
    enabled: true,
    canDelete: false,
    ...overrides,
  }
}

describe('CapabilityRegistry.findByName()', () => {
  it('returns the correct capability by name', () => {
    const reg = new CapabilityRegistry()
    reg.load([
      makeCap({ name: 'browser-chrome', provides: 'browser-control' }),
      makeCap({ name: 'browser-firefox', provides: 'browser-control' }),
    ])
    const cap = reg.findByName('browser-chrome')
    expect(cap).toBeDefined()
    expect(cap!.name).toBe('browser-chrome')
  })

  it('returns undefined for a nonexistent name', () => {
    const reg = new CapabilityRegistry()
    reg.load([makeCap({ name: 'browser-chrome', provides: 'browser-control' })])
    expect(reg.findByName('nonexistent')).toBeUndefined()
  })

  it('returns the right capability when multiple capabilities share the same provides type', () => {
    const reg = new CapabilityRegistry()
    reg.load([
      makeCap({ name: 'browser-chrome', provides: 'browser-control' }),
      makeCap({ name: 'browser-firefox', provides: 'browser-control' }),
      makeCap({ name: 'browser-edge', provides: 'browser-control' }),
    ])

    // Each name resolves to the correct instance, not the first match by type
    expect(reg.findByName('browser-chrome')!.name).toBe('browser-chrome')
    expect(reg.findByName('browser-firefox')!.name).toBe('browser-firefox')
    expect(reg.findByName('browser-edge')!.name).toBe('browser-edge')
  })

  it('returns a capability regardless of enabled state', () => {
    const reg = new CapabilityRegistry()
    reg.load([makeCap({ name: 'browser-chrome', provides: 'browser-control', enabled: false })])
    // Unlike get(), findByName does not filter by enabled
    const cap = reg.findByName('browser-chrome')
    expect(cap).toBeDefined()
    expect(cap!.enabled).toBe(false)
  })

  it('returns a capability regardless of status (unavailable is still findable)', () => {
    const reg = new CapabilityRegistry()
    reg.load([
      makeCap({ name: 'browser-chrome', provides: 'browser-control', status: 'unavailable' }),
    ])
    // Unlike get(), findByName does not filter by status
    const cap = reg.findByName('browser-chrome')
    expect(cap).toBeDefined()
    expect(cap!.status).toBe('unavailable')
  })
})
