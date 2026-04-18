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
    canDelete: false,
    ...overrides,
  }
}

describe('CapabilityRegistry — listByProvides', () => {
  it('returns every capability matching the type, regardless of enabled', () => {
    const reg = new CapabilityRegistry()
    reg.load([
      makeCap({ name: 'browser-chrome', provides: 'browser-control', enabled: true, canDelete: true }),
      makeCap({ name: 'browser-edge', provides: 'browser-control', enabled: false, canDelete: true }),
      makeCap({ name: 'desktop', provides: 'desktop-control', enabled: true }),
    ])
    const browsers = reg.listByProvides('browser-control')
    expect(browsers).toHaveLength(2)
    expect(browsers.map(c => c.name).sort()).toEqual(['browser-chrome', 'browser-edge'])
  })

  it('returns capabilities even when status is unavailable', () => {
    const reg = new CapabilityRegistry()
    reg.load([
      makeCap({ name: 'browser-chrome', provides: 'browser-control', status: 'unavailable', canDelete: true }),
    ])
    expect(reg.listByProvides('browser-control')).toHaveLength(1)
  })

  it('returns empty array for unknown type', () => {
    const reg = new CapabilityRegistry()
    reg.load([makeCap({ name: 'x', provides: 'audio-to-text', enabled: true })])
    expect(reg.listByProvides('browser-control')).toEqual([])
  })

  it('returns empty array when registry is empty', () => {
    const reg = new CapabilityRegistry()
    reg.load([])
    expect(reg.listByProvides('browser-control')).toEqual([])
  })
})

describe('CapabilityRegistry — toggleByName', () => {
  let dir1: string
  let dir2: string

  beforeEach(() => {
    dir1 = join(tmpdir(), `reg-tname-${Date.now()}-1`)
    dir2 = join(tmpdir(), `reg-tname-${Date.now()}-2`)
    mkdirSync(dir1, { recursive: true })
    mkdirSync(dir2, { recursive: true })
  })

  afterEach(() => {
    rmSync(dir1, { recursive: true, force: true })
    rmSync(dir2, { recursive: true, force: true })
  })

  it('toggles only the named capability when multiple share a provides', () => {
    const reg = new CapabilityRegistry()
    reg.load([
      makeCap({ name: 'browser-chrome', provides: 'browser-control', enabled: false, path: dir1, canDelete: true }),
      makeCap({ name: 'browser-edge', provides: 'browser-control', enabled: false, path: dir2, canDelete: true }),
    ])

    const result = reg.toggleByName('browser-edge')
    expect(result).toBe(true)
    expect(existsSync(join(dir2, '.enabled'))).toBe(true)
    expect(existsSync(join(dir1, '.enabled'))).toBe(false)
  })

  it('disables an enabled capability — removes .enabled file', () => {
    writeFileSync(join(dir1, '.enabled'), 'now')
    const reg = new CapabilityRegistry()
    reg.load([
      makeCap({ name: 'browser-chrome', provides: 'browser-control', enabled: true, path: dir1, canDelete: true }),
    ])

    expect(reg.toggleByName('browser-chrome')).toBe(false)
    expect(existsSync(join(dir1, '.enabled'))).toBe(false)
  })

  it('returns undefined when name is unknown', () => {
    const reg = new CapabilityRegistry()
    reg.load([])
    expect(reg.toggleByName('nope')).toBeUndefined()
  })

  it('emits capability:changed with name + provides', () => {
    const reg = new CapabilityRegistry()
    reg.load([
      makeCap({ name: 'browser-chrome', provides: 'browser-control', enabled: false, path: dir1, canDelete: true }),
    ])
    const events: unknown[] = []
    reg.on('capability:changed', (e) => events.push(e))
    reg.toggleByName('browser-chrome')
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ type: 'browser-control', enabled: true, name: 'browser-chrome' })
  })
})

describe('CapabilityRegistry — delete', () => {
  let myAgentRoot: string
  let capDir: string
  let profileDir: string
  const capName = 'browser-chrome'

  beforeEach(() => {
    myAgentRoot = join(tmpdir(), `reg-del-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    capDir = join(myAgentRoot, 'capabilities', capName)
    profileDir = join(myAgentRoot, 'browser-profiles', capName)
    mkdirSync(capDir, { recursive: true })
    mkdirSync(profileDir, { recursive: true })
    writeFileSync(join(capDir, 'CAPABILITY.md'), '---\nname: browser-chrome\n---\n')
    writeFileSync(join(profileDir, 'cookies.db'), 'fake cookies')
  })

  afterEach(() => {
    rmSync(myAgentRoot, { recursive: true, force: true })
  })

  it('removes the capability folder and registry entry', () => {
    const reg = new CapabilityRegistry()
    reg.load([
      makeCap({ name: capName, provides: 'browser-control', path: capDir, canDelete: true }),
    ])
    expect(reg.delete(capName)).toBe(true)
    expect(existsSync(capDir)).toBe(false)
    expect(reg.listByProvides('browser-control')).toHaveLength(0)
  })

  it('preserves the profile folder by default (non-destructive)', () => {
    const reg = new CapabilityRegistry()
    reg.load([
      makeCap({ name: capName, provides: 'browser-control', path: capDir, canDelete: true }),
    ])
    reg.delete(capName)
    expect(existsSync(profileDir)).toBe(true)
    expect(existsSync(join(profileDir, 'cookies.db'))).toBe(true)
  })

  it('removes the profile folder when wipeProfile: true', () => {
    const reg = new CapabilityRegistry()
    reg.load([
      makeCap({ name: capName, provides: 'browser-control', path: capDir, canDelete: true }),
    ])
    reg.delete(capName, { wipeProfile: true })
    expect(existsSync(profileDir)).toBe(false)
  })

  it('throws when canDelete is false', () => {
    const reg = new CapabilityRegistry()
    reg.load([
      makeCap({ name: 'desktop', provides: 'desktop-control', path: capDir, canDelete: false }),
    ])
    expect(() => reg.delete('desktop')).toThrow(/not deletable/)
    // Folder must still exist — guard fired before destructive action
    expect(existsSync(capDir)).toBe(true)
  })

  it('returns false when name is unknown', () => {
    const reg = new CapabilityRegistry()
    reg.load([])
    expect(reg.delete('nonexistent')).toBe(false)
  })

  it('emits capability:changed with deleted: true', () => {
    const reg = new CapabilityRegistry()
    reg.load([
      makeCap({ name: capName, provides: 'browser-control', path: capDir, canDelete: true }),
    ])
    const events: Array<Record<string, unknown>> = []
    reg.on('capability:changed', (e) => events.push(e as Record<string, unknown>))
    reg.delete(capName, { wipeProfile: true })
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      type: 'browser-control',
      name: capName,
      deleted: true,
      wipedProfile: true,
    })
  })
})

// ── S14: isMultiInstance + getFallbackAction ──────────────────────────────────

describe('CapabilityRegistry.isMultiInstance (S14)', () => {
  it("returns true for browser-control (WELL_KNOWN_MULTI_INSTANCE fallback)", () => {
    const reg = new CapabilityRegistry()
    reg.load([makeCap({ name: "browser-chrome", provides: "browser-control", canDelete: true })])
    expect(reg.isMultiInstance("browser-control")).toBe(true)
  })

  it("returns true when multi_instance frontmatter is true", () => {
    const reg = new CapabilityRegistry()
    reg.load([makeCap({ name: "my-browser", provides: "browser-control", multiInstance: true, canDelete: true })])
    expect(reg.isMultiInstance("browser-control")).toBe(true)
  })

  it("returns false for audio-to-text (not multi-instance)", () => {
    const reg = new CapabilityRegistry()
    reg.load([makeCap({ name: "stt-deepgram", provides: "audio-to-text" })])
    expect(reg.isMultiInstance("audio-to-text")).toBe(false)
  })

  it("returns false for unknown type with no capabilities registered", () => {
    const reg = new CapabilityRegistry()
    reg.load([])
    expect(reg.isMultiInstance("nonexistent-type")).toBe(false)
  })
})

describe('CapabilityRegistry.getFallbackAction (S14)', () => {
  it("returns fallbackAction from capability frontmatter when set", () => {
    const reg = new CapabilityRegistry()
    reg.load([makeCap({ name: "stt-deepgram", provides: "audio-to-text", fallbackAction: "could you resend as text" })])
    expect(reg.getFallbackAction("audio-to-text")).toBe("could you resend as text")
  })

  it("returns default fallback when no capability has fallbackAction", () => {
    const reg = new CapabilityRegistry()
    reg.load([makeCap({ name: "stt-deepgram", provides: "audio-to-text" })])
    expect(reg.getFallbackAction("audio-to-text")).toBe("try again in a moment")
  })

  it("returns default fallback for unknown type", () => {
    const reg = new CapabilityRegistry()
    reg.load([])
    expect(reg.getFallbackAction("nonexistent-type")).toBe("try again in a moment")
  })
})

describe('CapabilityRegistry — legacy semantics regression', () => {
  // These tests guarantee the existing first-match semantics of has/get/isEnabled/toggle
  // are preserved. They duplicate intent from registry-toggle.test.ts but specifically
  // exercise the multi-instance edge case where two capabilities share `provides`.
  it('get() still returns first available+enabled match (does not enumerate)', () => {
    const reg = new CapabilityRegistry()
    reg.load([
      makeCap({ name: 'browser-chrome', provides: 'browser-control', enabled: true, canDelete: true }),
      makeCap({ name: 'browser-edge', provides: 'browser-control', enabled: true, canDelete: true }),
    ])
    const result = reg.get('browser-control')
    expect(result).toBeDefined()
    // First match returned — listByProvides is the multi-instance API.
    expect(['browser-chrome', 'browser-edge']).toContain(result!.name)
  })

  it('has() returns true if any matching capability is enabled+available', () => {
    const reg = new CapabilityRegistry()
    reg.load([
      makeCap({ name: 'browser-chrome', provides: 'browser-control', enabled: false, canDelete: true }),
      makeCap({ name: 'browser-edge', provides: 'browser-control', enabled: true, canDelete: true }),
    ])
    expect(reg.has('browser-control')).toBe(true)
  })
})
