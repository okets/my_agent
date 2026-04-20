/**
 * M9.5-S7 Phase E item 25 — singleton capability rows visual regression.
 *
 * Asserts the Settings → Capabilities card renders the singleton rows
 * (Voice Input, Voice Output, Image Generation, Desktop Control) byte-identical
 * to the committed baseline. This guards against the multi-instance refactor
 * silently regressing the singleton layout.
 *
 * Approach: intercept /api/settings/capabilities/v2 with a fixed payload
 * (3 installed singletons, 1 not-installed singleton, 1 multi-instance group
 * with one enabled instance). Open the dashboard, navigate to Settings, locate
 * the Capabilities card, screenshot it, compare to baseline.
 *
 * On first run (or when UPDATE_VISUAL_BASELINES=1) the baseline is written and
 * the assertion is skipped. On subsequent runs the screenshot must match the
 * baseline byte-for-byte.
 *
 * Gate: DASHBOARD_URL env (default http://localhost:4321). Skips if dashboard
 * is unreachable.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { chromium, type Browser, type Page, type Route } from 'playwright'
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, resolve } from 'node:path'

const DASHBOARD_URL = process.env.DASHBOARD_URL || 'http://localhost:4321'
const UPDATE_BASELINE = process.env.UPDATE_VISUAL_BASELINES === '1'

const BASELINE_DIR = resolve(
  process.cwd(),
  '../../docs/sprints/m9.5-s7-browser-capability/screenshots/baseline',
)
const BASELINE_FILE = join(BASELINE_DIR, 'capabilities-singletons.png')

async function isDashboardReachable(): Promise<boolean> {
  try {
    const res = await fetch(`${DASHBOARD_URL}/api/automations`, {
      signal: AbortSignal.timeout(3000),
    })
    return res.ok
  } catch {
    return false
  }
}

const dashboardAvailable = await isDashboardReachable()

/**
 * Synthetic /v2 payload: a stable mix of singleton states plus a single
 * multi-instance group. Mirrors the production response shape so the Alpine
 * card renders the same DOM regardless of what's actually installed locally.
 */
const FAKE_V2 = {
  capabilities: [
    {
      type: 'audio-to-text',
      label: 'Voice Input',
      multiInstance: false,
      hint: 'Ask Nina to add voice input',
      iconSlug: undefined,
      instances: [
        {
          name: 'Deepgram STT',
          state: 'healthy',
          enabled: true,
          canToggle: true,
          canDelete: false,
          iconSlug: undefined,
        },
      ],
    },
    {
      type: 'text-to-audio',
      label: 'Voice Output',
      multiInstance: false,
      hint: 'Ask Nina to add voice output',
      iconSlug: undefined,
      instances: [],
    },
    {
      type: 'text-to-image',
      label: 'Image Generation',
      multiInstance: false,
      hint: 'Ask Nina to add image generation',
      iconSlug: undefined,
      instances: [],
    },
    {
      type: 'desktop-control',
      label: 'Desktop Control',
      multiInstance: false,
      hint: 'Ask Nina to add desktop control',
      iconSlug: undefined,
      instances: [
        {
          name: 'Desktop X11',
          state: 'healthy',
          enabled: true,
          canToggle: true,
          canDelete: false,
          iconSlug: undefined,
        },
      ],
    },
    {
      type: 'browser-control',
      label: 'Browsers',
      multiInstance: true,
      hint: 'Ask Nina to add any browser.',
      iconSlug: 'browser',
      instances: [
        {
          name: 'browser-chrome',
          state: 'healthy',
          enabled: true,
          canToggle: true,
          canDelete: true,
          iconSlug: 'googlechrome',
        },
      ],
    },
  ],
}

function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex')
}

describe.skipIf(!dashboardAvailable)(
  'Capabilities singleton visual regression (Phase E item 25)',
  () => {
    let browser: Browser
    let page: Page

    beforeAll(async () => {
      mkdirSync(BASELINE_DIR, { recursive: true })
      browser = await chromium.launch({ headless: true })
      page = await browser.newPage({
        viewport: { width: 1280, height: 1600 },
        deviceScaleFactor: 1,
      })
      // Intercept the v2 endpoint with a deterministic payload before nav.
      await page.route('**/api/settings/capabilities/v2', (route: Route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(FAKE_V2),
        }),
      )
    }, 30_000)

    afterAll(async () => {
      await browser?.close()
      // Clean up the diff-failure inspection capture so it doesn't pollute
      // the changelog. The baseline (capabilities-singletons.png) stays.
      rmSync(join(BASELINE_DIR, 'capabilities-singletons.actual.png'), { force: true })
    })

    it('renders singleton rows pixel-identical to baseline', async () => {
      await page.goto(DASHBOARD_URL, { waitUntil: 'networkidle' })

      // Open Settings tab via the Alpine root (more reliable than clicking
      // the gear icon which lives inside a conditional header).
      await page.evaluate(() => {
        const root = document.querySelector('[x-data]') as HTMLElement | null
        // @ts-expect-error — Alpine attaches __x to the root for runtime access
        const data = root?._x_dataStack?.[0] ?? null
        if (data && typeof data.openTab === 'function') {
          data.openTab({ id: 'settings', type: 'settings', title: 'Settings', icon: '\u2699\uFE0F', closeable: true })
        }
      })
      await page.waitForTimeout(500)

      // Locate the Capabilities card scoped to the settings tab pane (M9.5-S7
      // version sits next to the API Keys card). There are multiple
      // glass-strong cards on the page — narrow by header text and require
      // visibility (multi-instance group with type=browser-control sets the
      // "Browsers" label).
      const card = page
        .locator('div.glass-strong:has(h3:has-text("Capabilities"))')
        .filter({ hasText: 'Voice Input' })
        .first()
      await card.waitFor({ state: 'visible', timeout: 10_000 })

      // Wait for Alpine to render rows (loading=false) — labels rendered
      // inside the card.
      await card.locator('text=Voice Input').first().waitFor({ timeout: 10_000 })
      await card.locator('text=Image Generation').first().waitFor({ timeout: 10_000 })
      await card.locator('text=Desktop Control').first().waitFor({ timeout: 10_000 })
      await card.locator('text=Browsers').first().waitFor({ timeout: 10_000 })

      // Disable the dot pulse animation so the screenshot is deterministic.
      await page.addStyleTag({
        content: `
          .animate-pulse { animation: none !important; }
          *, *::before, *::after { animation-duration: 0s !important; transition-duration: 0s !important; }
        `,
      })
      await page.waitForTimeout(200)

      const buf = await card.first().screenshot({ type: 'png' })

      if (UPDATE_BASELINE || !existsSync(BASELINE_FILE)) {
        writeFileSync(BASELINE_FILE, buf)
        console.log(
          `[visual-regression] baseline ${UPDATE_BASELINE ? 'updated' : 'created'} at ${BASELINE_FILE} (${buf.length} bytes)`,
        )
        return
      }

      const expected = readFileSync(BASELINE_FILE)
      const actualHash = sha256(buf)
      const expectedHash = sha256(expected)

      if (actualHash !== expectedHash) {
        // Save the failing capture for inspection — same dir, .actual.png suffix.
        const failPath = join(BASELINE_DIR, 'capabilities-singletons.actual.png')
        writeFileSync(failPath, buf)
        console.error(
          `[visual-regression] mismatch — actual saved at ${failPath} for diff. ` +
            `Re-run with UPDATE_VISUAL_BASELINES=1 if this is an intended change.`,
        )
      }

      expect(actualHash).toBe(expectedHash)
    }, 30_000)
  },
)
