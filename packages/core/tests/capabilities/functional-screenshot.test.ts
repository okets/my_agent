import { describe, it, expect, afterEach } from 'vitest'
import { scanCapabilities } from '../../src/capabilities/scanner.js'
import { testMcpScreenshot } from '../../src/capabilities/test-harness.js'
import { join } from 'node:path'
import { writeFileSync, unlinkSync } from 'node:fs'

const FIXTURES_DIR = join(import.meta.dirname, '..', 'fixtures')
const FIXTURE_ENABLED_PATH = join(FIXTURES_DIR, 'desktop-x11-fixture', '.enabled')

afterEach(() => {
  try { unlinkSync(FIXTURE_ENABLED_PATH) } catch { /* already gone */ }
})

describe('Functional screenshot test', () => {
  it('desktop_screenshot returns valid image content', async () => {
    writeFileSync(FIXTURE_ENABLED_PATH, new Date().toISOString())

    const caps = await scanCapabilities(FIXTURES_DIR, '/dev/null')
    const desktop = caps.find(c => c.provides === 'desktop-control')
    expect(desktop).toBeDefined()

    const result = await testMcpScreenshot(desktop!)
    expect(result.status).toBe('ok')
  }, 30_000)
})
