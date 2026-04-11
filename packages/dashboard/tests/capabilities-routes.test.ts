import { describe, it, expect, beforeEach } from 'vitest'
import { CapabilityRegistry } from '@my-agent/core'
import type { Capability } from '@my-agent/core'
import { buildCapabilityList, WELL_KNOWN_TYPES } from '../src/routes/capabilities.js'

function makeCap(overrides: Partial<Capability> & { name: string }): Capability {
  return {
    provides: undefined,
    interface: 'script' as const,
    path: '/tmp/fake',
    status: 'available' as const,
    health: 'untested' as const,
    enabled: true,
    ...overrides,
  }
}

describe('buildCapabilityList', () => {
  let registry: CapabilityRegistry

  beforeEach(() => {
    registry = new CapabilityRegistry()
  })

  it('returns all four well-known types even when registry is empty', () => {
    registry.load([])
    const result = buildCapabilityList(registry, 'TestAgent')
    expect(result).toHaveLength(4)
    const types = result.map(r => r.type)
    expect(types).toContain('audio-to-text')
    expect(types).toContain('text-to-audio')
    expect(types).toContain('text-to-image')
    expect(types).toContain('desktop-control')
  })

  it('not-installed types have status "not-installed" and hint with agent name', () => {
    registry.load([])
    const result = buildCapabilityList(registry, 'TestAgent')
    const stt = result.find(r => r.type === 'audio-to-text')!
    expect(stt.state).toBe('not-installed')
    expect(stt.hint).toBe('Ask TestAgent to add voice input')
    expect(stt.enabled).toBe(false)
    expect(stt.canToggle).toBe(false)
  })

  it('installed + available + enabled shows correct state', () => {
    registry.load([makeCap({ name: 'Deepgram STT', provides: 'audio-to-text', enabled: true, health: 'healthy' })])
    const result = buildCapabilityList(registry, 'TestAgent')
    const stt = result.find(r => r.type === 'audio-to-text')!
    expect(stt.state).toBe('healthy')
    expect(stt.enabled).toBe(true)
    expect(stt.canToggle).toBe(true)
    expect(stt.capabilityName).toBe('Deepgram STT')
  })

  it('installed + available + disabled shows correct state', () => {
    registry.load([makeCap({ name: 'Deepgram STT', provides: 'audio-to-text', enabled: false })])
    const result = buildCapabilityList(registry, 'TestAgent')
    const stt = result.find(r => r.type === 'audio-to-text')!
    expect(stt.state).toBe('disabled')
    expect(stt.enabled).toBe(false)
    expect(stt.canToggle).toBe(true)
  })

  it('installed + unavailable shows unavailable state with reason', () => {
    registry.load([makeCap({
      name: 'Deepgram STT',
      provides: 'audio-to-text',
      status: 'unavailable',
      unavailableReason: 'missing DEEPGRAM_API_KEY',
      enabled: true,
    })])
    const result = buildCapabilityList(registry, 'TestAgent')
    const stt = result.find(r => r.type === 'audio-to-text')!
    expect(stt.state).toBe('unavailable')
    expect(stt.unavailableReason).toBe('missing DEEPGRAM_API_KEY')
    expect(stt.canToggle).toBe(false)
  })

  it('installed + degraded shows degraded state with reason', () => {
    registry.load([makeCap({
      name: 'Deepgram STT',
      provides: 'audio-to-text',
      health: 'degraded',
      degradedReason: '401 Unauthorized',
      enabled: true,
    })])
    const result = buildCapabilityList(registry, 'TestAgent')
    const stt = result.find(r => r.type === 'audio-to-text')!
    expect(stt.state).toBe('degraded')
    expect(stt.degradedReason).toBe('401 Unauthorized')
    expect(stt.canToggle).toBe(true)
  })

  it('MCP interface reports toggleTiming as "next-session"', () => {
    registry.load([makeCap({
      name: 'Desktop X11',
      provides: 'desktop-control',
      interface: 'mcp',
      enabled: true,
      health: 'healthy',
    })])
    const result = buildCapabilityList(registry, 'TestAgent')
    const dc = result.find(r => r.type === 'desktop-control')!
    expect(dc.toggleTiming).toBe('next-session')
  })

  it('script interface reports toggleTiming as "immediate"', () => {
    registry.load([makeCap({
      name: 'Deepgram STT',
      provides: 'audio-to-text',
      interface: 'script',
      enabled: true,
      health: 'healthy',
    })])
    const result = buildCapabilityList(registry, 'TestAgent')
    const stt = result.find(r => r.type === 'audio-to-text')!
    expect(stt.toggleTiming).toBe('immediate')
  })
})

describe('toggle endpoint logic', () => {
  it('toggle returns new enabled state and timing', () => {
    const registry = new CapabilityRegistry()
    const capDir = '/tmp/fake-toggle-test'
    registry.load([makeCap({
      name: 'Deepgram STT',
      provides: 'audio-to-text',
      enabled: true,
      path: capDir,
    })])
    const result = registry.toggle('audio-to-text')
    expect(result).toBe(false)
  })

  it('toggle returns undefined for unknown type', () => {
    const registry = new CapabilityRegistry()
    registry.load([])
    expect(registry.toggle('nonexistent')).toBeUndefined()
  })
})
