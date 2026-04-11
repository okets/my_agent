import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { CapabilityRegistry } from '../../src/capabilities/registry.js'
import type { Capability } from '../../src/capabilities/types.js'

function makeCap(overrides: Partial<Capability> & { name: string }): Capability {
  return {
    provides: undefined,
    interface: 'script',
    path: '/tmp/fake',
    status: 'available',
    health: 'untested',
    enabled: true,
    ...overrides,
  }
}

describe('CapabilityRegistry — enabled gate', () => {
  it('get() returns capability when available AND enabled', () => {
    const reg = new CapabilityRegistry()
    reg.load([makeCap({ name: 'STT', provides: 'audio-to-text', enabled: true })])
    expect(reg.get('audio-to-text')).toBeDefined()
    expect(reg.get('audio-to-text')!.name).toBe('STT')
  })

  it('get() returns undefined when available but disabled', () => {
    const reg = new CapabilityRegistry()
    reg.load([makeCap({ name: 'STT', provides: 'audio-to-text', enabled: false })])
    expect(reg.get('audio-to-text')).toBeUndefined()
  })

  it('get() returns undefined when enabled but unavailable', () => {
    const reg = new CapabilityRegistry()
    reg.load([makeCap({ name: 'STT', provides: 'audio-to-text', enabled: true, status: 'unavailable' })])
    expect(reg.get('audio-to-text')).toBeUndefined()
  })

  it('has() respects enabled gate', () => {
    const reg = new CapabilityRegistry()
    reg.load([makeCap({ name: 'STT', provides: 'audio-to-text', enabled: false })])
    expect(reg.has('audio-to-text')).toBe(false)
  })

  it('isEnabled() returns explicit boolean', () => {
    const reg = new CapabilityRegistry()
    reg.load([
      makeCap({ name: 'STT', provides: 'audio-to-text', enabled: true }),
      makeCap({ name: 'TTS', provides: 'text-to-audio', enabled: false }),
    ])
    expect(reg.isEnabled('audio-to-text')).toBe(true)
    expect(reg.isEnabled('text-to-audio')).toBe(false)
    expect(reg.isEnabled('nonexistent')).toBe(false)
  })

  it('list() returns all capabilities regardless of enabled state', () => {
    const reg = new CapabilityRegistry()
    reg.load([
      makeCap({ name: 'STT', provides: 'audio-to-text', enabled: true }),
      makeCap({ name: 'TTS', provides: 'text-to-audio', enabled: false }),
    ])
    expect(reg.list()).toHaveLength(2)
  })
})

describe('CapabilityRegistry — toggle()', () => {
  let capDir: string

  beforeEach(() => {
    capDir = join(tmpdir(), `reg-toggle-${Date.now()}`)
    mkdirSync(capDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(capDir, { recursive: true, force: true })
  })

  it('toggle() enables a disabled capability — writes .enabled file', () => {
    const reg = new CapabilityRegistry()
    reg.load([makeCap({ name: 'STT', provides: 'audio-to-text', enabled: false, path: capDir })])

    const result = reg.toggle('audio-to-text')
    expect(result).toBe(true) // now enabled
    expect(existsSync(join(capDir, '.enabled'))).toBe(true)
    expect(reg.isEnabled('audio-to-text')).toBe(true)
  })

  it('toggle() disables an enabled capability — removes .enabled file', () => {
    writeFileSync(join(capDir, '.enabled'), new Date().toISOString())
    const reg = new CapabilityRegistry()
    reg.load([makeCap({ name: 'STT', provides: 'audio-to-text', enabled: true, path: capDir })])

    const result = reg.toggle('audio-to-text')
    expect(result).toBe(false) // now disabled
    expect(existsSync(join(capDir, '.enabled'))).toBe(false)
    expect(reg.isEnabled('audio-to-text')).toBe(false)
  })

  it('toggle() returns undefined for unknown type', () => {
    const reg = new CapabilityRegistry()
    reg.load([])
    expect(reg.toggle('nonexistent')).toBeUndefined()
  })

  it('toggle() emits capability:changed event', () => {
    const reg = new CapabilityRegistry()
    reg.load([makeCap({ name: 'STT', provides: 'audio-to-text', enabled: false, path: capDir })])

    const events: unknown[] = []
    reg.on('capability:changed', (e) => events.push(e))

    reg.toggle('audio-to-text')
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ type: 'audio-to-text', enabled: true, name: 'STT' })
  })
})
