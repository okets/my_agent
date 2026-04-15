/**
 * Acceptance Tests — CapabilityRegistry.getHealth() (M9.6-S3)
 *
 * Verifies that getHealth() returns one row per capability and correctly flags
 * unhealthy entries (enabled+unavailable, or available+degraded).
 */

import { describe, it, expect } from 'vitest'
import { CapabilityRegistry } from '../../src/capabilities/registry.js'
import type { Capability } from '../../src/capabilities/types.js'

function makeCap(overrides: Partial<Capability>): Capability {
  return {
    name: 'test-cap',
    provides: 'audio-to-text',
    interface: 'script',
    path: '/tmp/fake',
    status: 'available',
    health: 'healthy',
    enabled: true,
    canDelete: false,
    ...overrides,
  }
}

describe('CapabilityRegistry.getHealth()', () => {
  it('returns empty array when no capabilities loaded', () => {
    const registry = new CapabilityRegistry()
    expect(registry.getHealth()).toEqual([])
  })

  it('returns one row per loaded capability', () => {
    const registry = new CapabilityRegistry()
    registry.load([
      makeCap({ name: 'stt', provides: 'audio-to-text', status: 'available', health: 'healthy', enabled: true }),
      makeCap({ name: 'tts', provides: 'text-to-audio', status: 'available', health: 'healthy', enabled: true }),
    ])
    expect(registry.getHealth()).toHaveLength(2)
  })

  it('does not include issue for healthy+enabled capability', () => {
    const registry = new CapabilityRegistry()
    registry.load([
      makeCap({ name: 'stt', status: 'available', health: 'healthy', enabled: true }),
    ])
    const [row] = registry.getHealth()
    expect(row.issue).toBeUndefined()
  })

  it('flags issue when capability is enabled but unavailable', () => {
    const registry = new CapabilityRegistry()
    registry.load([
      makeCap({
        name: 'stt',
        status: 'unavailable',
        unavailableReason: 'missing DEEPGRAM_API_KEY',
        health: 'untested',
        enabled: true,
      }),
    ])
    const [row] = registry.getHealth()
    expect(row.issue).toMatch(/enabled but unavailable/)
    expect(row.issue).toMatch(/missing DEEPGRAM_API_KEY/)
  })

  it('flags issue when capability is available but degraded', () => {
    const registry = new CapabilityRegistry()
    registry.load([
      makeCap({
        name: 'stt',
        status: 'available',
        health: 'degraded',
        degradedReason: '401 Unauthorized',
        enabled: true,
      }),
    ])
    const [row] = registry.getHealth()
    expect(row.issue).toMatch(/degraded/)
    expect(row.issue).toMatch(/401 Unauthorized/)
  })

  it('does not flag issue for disabled+unavailable capability', () => {
    // Disabled capabilities are intentionally off — not an issue
    const registry = new CapabilityRegistry()
    registry.load([
      makeCap({ name: 'stt', status: 'unavailable', health: 'untested', enabled: false }),
    ])
    const [row] = registry.getHealth()
    expect(row.issue).toBeUndefined()
  })

  it('does not flag issue for available+untested capability', () => {
    const registry = new CapabilityRegistry()
    registry.load([
      makeCap({ name: 'stt', status: 'available', health: 'untested', enabled: true }),
    ])
    const [row] = registry.getHealth()
    expect(row.issue).toBeUndefined()
  })

  it('returns correct row shape for each capability', () => {
    const registry = new CapabilityRegistry()
    registry.load([
      makeCap({
        name: 'stt-deepgram',
        provides: 'audio-to-text',
        status: 'available',
        health: 'degraded',
        degradedReason: 'timeout',
        enabled: true,
      }),
    ])
    const [row] = registry.getHealth()
    expect(row).toMatchObject({
      type: 'audio-to-text',
      name: 'stt-deepgram',
      enabled: true,
      status: 'available',
      health: 'degraded',
    })
  })

  it('uses "custom" type for capabilities with no provides field', () => {
    const registry = new CapabilityRegistry()
    registry.load([
      makeCap({ name: 'my-custom', provides: undefined, status: 'available', health: 'healthy', enabled: true }),
    ])
    const [row] = registry.getHealth()
    expect(row.type).toBe('custom')
  })
})
