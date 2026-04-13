import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, cpSync, existsSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { CapabilityRegistry } from '../src/capabilities/registry.js'
import { scanCapabilities } from '../src/capabilities/scanner.js'
import { testCapability } from '../src/capabilities/test-harness.js'

const FIXTURES = join(import.meta.dirname, 'fixtures')

/**
 * Copy the source-controlled fixtures into a fresh tmpdir capabilities root so
 * destructive operations (toggle writes .enabled, delete removes the folder)
 * cannot mutate the checked-in fixture trees. node_modules are linked via the
 * fixture's package install — we copy the whole directory including
 * node_modules so npx tsx can resolve @modelcontextprotocol/sdk + zod.
 */
function stageFixtures(...names: string[]): { capsDir: string; envPath: string } {
  const root = join(tmpdir(), `browser-fixture-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  const capsDir = join(root, 'capabilities')
  mkdirSync(capsDir, { recursive: true })
  for (const name of names) {
    cpSync(join(FIXTURES, name), join(capsDir, name), { recursive: true })
  }
  const envPath = join(root, '.env')
  writeFileSync(envPath, '')
  return { capsDir, envPath }
}

describe('browser-control fixture — Phase E', () => {
  let staged: { capsDir: string; envPath: string }

  afterEach(() => {
    if (staged?.capsDir) {
      try { rmSync(join(staged.capsDir, '..'), { recursive: true, force: true }) } catch { /* ignore */ }
    }
  })

  describe('scanner discovers the fixture correctly', () => {
    it('reads provides, interface, entrypoint from frontmatter', async () => {
      staged = stageFixtures('browser-chrome-fixture')
      const caps = await scanCapabilities(staged.capsDir, staged.envPath)
      expect(caps).toHaveLength(1)
      const cap = caps[0]
      expect(cap.name).toBe('browser-chrome')
      expect(cap.provides).toBe('browser-control')
      expect(cap.interface).toBe('mcp')
      expect(cap.entrypoint).toBe('npx tsx src/server.ts')
      expect(cap.status).toBe('available')
    })

    it('marks browser-control instances as canDelete: true via well-known allowlist', async () => {
      staged = stageFixtures('browser-chrome-fixture')
      const caps = await scanCapabilities(staged.capsDir, staged.envPath)
      expect(caps[0].canDelete).toBe(true)
    })

    it('starts disabled when no .enabled file is present', async () => {
      staged = stageFixtures('browser-chrome-fixture')
      const caps = await scanCapabilities(staged.capsDir, staged.envPath)
      expect(caps[0].enabled).toBe(false)
    })
  })

  describe('listByProvides + toggleByName against real fixture', () => {
    it('listByProvides returns the staged capability', async () => {
      staged = stageFixtures('browser-chrome-fixture')
      const reg = new CapabilityRegistry()
      reg.load(await scanCapabilities(staged.capsDir, staged.envPath))
      const browsers = reg.listByProvides('browser-control')
      expect(browsers.map(c => c.name)).toEqual(['browser-chrome'])
    })

    it('toggleByName writes .enabled in the right folder, then removes it', async () => {
      staged = stageFixtures('browser-chrome-fixture')
      const reg = new CapabilityRegistry()
      reg.load(await scanCapabilities(staged.capsDir, staged.envPath))
      const enabledPath = join(staged.capsDir, 'browser-chrome-fixture', '.enabled')

      expect(existsSync(enabledPath)).toBe(false)
      const onState = reg.toggleByName('browser-chrome')
      expect(onState).toBe(true)
      expect(existsSync(enabledPath)).toBe(true)

      const offState = reg.toggleByName('browser-chrome')
      expect(offState).toBe(false)
      expect(existsSync(enabledPath)).toBe(false)
    })

    it('toggleByName emits capability:changed with provides + name', async () => {
      staged = stageFixtures('browser-chrome-fixture')
      const reg = new CapabilityRegistry()
      reg.load(await scanCapabilities(staged.capsDir, staged.envPath))
      const events: unknown[] = []
      reg.on('capability:changed', (e) => events.push(e))
      reg.toggleByName('browser-chrome')
      expect(events).toHaveLength(1)
      expect(events[0]).toMatchObject({
        type: 'browser-control',
        enabled: true,
        name: 'browser-chrome',
      })
    })
  })

  describe('registry.delete against real fixture', () => {
    it('removes the capability folder from disk and drops it from the registry', async () => {
      staged = stageFixtures('browser-chrome-fixture')
      const reg = new CapabilityRegistry()
      reg.load(await scanCapabilities(staged.capsDir, staged.envPath))
      const folder = join(staged.capsDir, 'browser-chrome-fixture')
      expect(existsSync(folder)).toBe(true)

      const ok = reg.delete('browser-chrome')
      expect(ok).toBe(true)
      expect(existsSync(folder)).toBe(false)
      expect(reg.list().find(c => c.name === 'browser-chrome')).toBeUndefined()
    })

    it('emits capability:changed with deleted: true', async () => {
      staged = stageFixtures('browser-chrome-fixture')
      const reg = new CapabilityRegistry()
      reg.load(await scanCapabilities(staged.capsDir, staged.envPath))
      const events: any[] = []
      reg.on('capability:changed', (e) => events.push(e))
      reg.delete('browser-chrome')
      expect(events).toHaveLength(1)
      expect(events[0]).toMatchObject({
        type: 'browser-control',
        enabled: false,
        name: 'browser-chrome',
        deleted: true,
        wipedProfile: false,
      })
    })

    it('throws when canDelete is false (singleton guard)', async () => {
      // Synthesize a singleton-style capability inline — not all singletons live
      // on disk in this repo (e.g. desktop-x11 is the only one). Loading directly
      // bypasses the scanner so we control canDelete precisely.
      const reg = new CapabilityRegistry()
      reg.load([
        {
          name: 'voice-input',
          provides: 'audio-to-text',
          interface: 'script',
          path: '/tmp/should-not-be-touched',
          status: 'available',
          health: 'untested',
          enabled: true,
          canDelete: false,
        },
      ])
      expect(() => reg.delete('voice-input')).toThrow(/not deletable/)
    })

    it('returns false for unknown name (no throw)', () => {
      const reg = new CapabilityRegistry()
      reg.load([])
      expect(reg.delete('does-not-exist')).toBe(false)
    })
  })

  describe('harness spawns the fixture and lists tools', () => {
    it('testCapability returns ok with at least one tool', async () => {
      staged = stageFixtures('browser-chrome-fixture')
      const reg = new CapabilityRegistry()
      reg.load(await scanCapabilities(staged.capsDir, staged.envPath))
      const cap = reg.list()[0]
      const result = await testCapability(cap, '')
      expect(result.status).toBe('ok')
      expect(result.latencyMs).toBeGreaterThan(0)
    }, 30_000)
  })

  describe('multi-instance — Phase E item 24', () => {
    it('two browser-control fixtures both register, distinct names', async () => {
      staged = stageFixtures('browser-chrome-fixture', 'browser-edge-fixture')
      const reg = new CapabilityRegistry()
      reg.load(await scanCapabilities(staged.capsDir, staged.envPath))
      const browsers = reg.listByProvides('browser-control')
      expect(browsers.map(c => c.name).sort()).toEqual(['browser-chrome', 'browser-edge'])
      expect(browsers.every(c => c.canDelete)).toBe(true)
    })

    it('toggle one without affecting the other', async () => {
      staged = stageFixtures('browser-chrome-fixture', 'browser-edge-fixture')
      const reg = new CapabilityRegistry()
      reg.load(await scanCapabilities(staged.capsDir, staged.envPath))

      reg.toggleByName('browser-chrome')
      const after = Object.fromEntries(reg.listByProvides('browser-control').map(c => [c.name, c.enabled]))
      expect(after['browser-chrome']).toBe(true)
      expect(after['browser-edge']).toBe(false)

      const chromeEnabled = join(staged.capsDir, 'browser-chrome-fixture', '.enabled')
      const edgeEnabled = join(staged.capsDir, 'browser-edge-fixture', '.enabled')
      expect(existsSync(chromeEnabled)).toBe(true)
      expect(existsSync(edgeEnabled)).toBe(false)
    })

    it('delete one without affecting the other', async () => {
      staged = stageFixtures('browser-chrome-fixture', 'browser-edge-fixture')
      const reg = new CapabilityRegistry()
      reg.load(await scanCapabilities(staged.capsDir, staged.envPath))

      reg.delete('browser-chrome')
      const remaining = reg.listByProvides('browser-control')
      expect(remaining.map(c => c.name)).toEqual(['browser-edge'])
      expect(existsSync(join(staged.capsDir, 'browser-chrome-fixture'))).toBe(false)
      expect(existsSync(join(staged.capsDir, 'browser-edge-fixture'))).toBe(true)
    })

    it('both fixtures pass the harness as distinct MCP servers', async () => {
      staged = stageFixtures('browser-chrome-fixture', 'browser-edge-fixture')
      const reg = new CapabilityRegistry()
      reg.load(await scanCapabilities(staged.capsDir, staged.envPath))

      const results = await Promise.all(
        reg.listByProvides('browser-control').map(c => testCapability(c, '')),
      )
      expect(results).toHaveLength(2)
      for (const r of results) {
        expect(r.status).toBe('ok')
      }
    }, 45_000)
  })
})
