/**
 * Acceptance Tests — CapabilityWatcher (M9.6-S3)
 *
 * Verifies that the watcher triggers registry rescan on filesystem changes
 * to CAPABILITY.md and .enabled files.
 */

import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, unlinkSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { CapabilityWatcher } from '../../src/capabilities/watcher.js'
import { CapabilityRegistry } from '../../src/capabilities/registry.js'

const FAKE_ENV_PATH = '/nonexistent/.env'

function makeCapabilityMd(provides: string): string {
  return `---\nname: test-${provides}\nprovides: ${provides}\ninterface: script\n---\nTest capability.\n`
}

function makeTestSetup(provides: string = 'audio-to-text') {
  const capabilitiesDir = mkdtempSync(join(tmpdir(), 'cap-watcher-test-'))
  const capDir = join(capabilitiesDir, `test-${provides}`)
  mkdirSync(capDir)
  writeFileSync(join(capDir, 'CAPABILITY.md'), makeCapabilityMd(provides))

  const registry = new CapabilityRegistry()
  return { capabilitiesDir, capDir, registry }
}

let watcher: CapabilityWatcher | null = null
let tempDir: string | null = null

afterEach(async () => {
  if (watcher) {
    await watcher.stop()
    watcher = null
  }
  if (tempDir) {
    try { rmSync(tempDir, { recursive: true, force: true }) } catch { /* ok */ }
    tempDir = null
  }
})

describe('CapabilityWatcher — .enabled file written', () => {
  it('flips registry.isEnabled() to true within 2.5s', async () => {
    const { capabilitiesDir, capDir, registry } = makeTestSetup('audio-to-text')
    tempDir = capabilitiesDir

    watcher = new CapabilityWatcher(capabilitiesDir, FAKE_ENV_PATH, registry)
    await watcher.start()

    // Verify not yet enabled
    expect(registry.isEnabled('audio-to-text')).toBe(false)

    // Write the .enabled file to simulate capability activation
    writeFileSync(join(capDir, '.enabled'), new Date().toISOString())

    // Poll until registry reflects the change (debounce 500ms + poll 1000ms = up to 1.5s)
    const deadline = Date.now() + 2500
    while (Date.now() < deadline) {
      if (registry.isEnabled('audio-to-text')) break
      await new Promise((r) => setTimeout(r, 100))
    }

    expect(registry.isEnabled('audio-to-text')).toBe(true)
  }, 5000)
})

describe('CapabilityWatcher — CAPABILITY.md deleted', () => {
  it('removes capability from registry.list() within 2.5s', async () => {
    const { capabilitiesDir, capDir, registry } = makeTestSetup('text-to-audio')
    tempDir = capabilitiesDir

    // Pre-load registry with the capability so there is something to remove
    const { scanCapabilities } = await import('../../src/capabilities/scanner.js')
    const caps = await scanCapabilities(capabilitiesDir, FAKE_ENV_PATH)
    registry.load(caps)
    expect(registry.list().some((c) => c.provides === 'text-to-audio')).toBe(true)

    watcher = new CapabilityWatcher(capabilitiesDir, FAKE_ENV_PATH, registry)
    await watcher.start()

    // Delete CAPABILITY.md — scanner will find no capability in that folder
    unlinkSync(join(capDir, 'CAPABILITY.md'))

    const deadline = Date.now() + 2500
    while (Date.now() < deadline) {
      if (!registry.list().some((c) => c.provides === 'text-to-audio')) break
      await new Promise((r) => setTimeout(r, 100))
    }

    expect(registry.list().some((c) => c.provides === 'text-to-audio')).toBe(false)
  }, 5000)
})
