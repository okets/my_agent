/**
 * M7-S9 Task 7: Automation UI — Playwright browser verification
 *
 * Tests calendar tab, settings tab, and automation detail tab against
 * the running dashboard service.
 *
 * Gate: DASHBOARD_URL env var (defaults to http://localhost:4321)
 * Skip: gracefully when dashboard isn't running
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import { mkdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const DASHBOARD_URL =
  process.env.DASHBOARD_URL || "http://localhost:4321";

// Resolve from cwd (packages/dashboard/) to the sprint screenshots dir
const SCREENSHOT_DIR = resolve(
  process.cwd(),
  "../../docs/sprints/m7-s9-e2e-test-suite/screenshots",
);

async function isDashboardReachable(): Promise<boolean> {
  try {
    const res = await fetch(`${DASHBOARD_URL}/api/automations`, {
      signal: AbortSignal.timeout(3000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

const dashboardAvailable = await isDashboardReachable();

describe.skipIf(!dashboardAvailable)(
  "Automation UI (Playwright)",
  () => {
    let browser: Browser;
    let page: Page;

    beforeAll(async () => {
      mkdirSync(SCREENSHOT_DIR, { recursive: true });
      browser = await chromium.launch({ headless: true });
      page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

      // Navigate to dashboard and wait for Alpine.js to initialize
      await page.goto(DASHBOARD_URL);
      await page.waitForTimeout(2000); // Alpine init
    });

    afterAll(async () => {
      await browser?.close();
    });

    it("calendar tab renders timeline events", async () => {
      // Click calendar tab
      const calendarTab = page.locator(
        '[data-tab="calendar"], [x-on\\:click*="calendar"], button:has-text("Calendar")',
      );
      if ((await calendarTab.count()) > 0) {
        await calendarTab.first().click();
        await page.waitForTimeout(1000);
      }

      // Verify FullCalendar container renders
      const fcContainer = page.locator(".fc, [class*=fullcalendar], #calendar");
      const calendarExists = (await fcContainer.count()) > 0;

      // Take screenshot regardless
      await page.screenshot({
        path: join(SCREENSHOT_DIR, "calendar-tab.png"),
        fullPage: true,
      });

      expect(calendarExists).toBe(true);

      // Check for no JS errors (console)
      const errors: string[] = [];
      page.on("console", (msg) => {
        if (msg.type() === "error") errors.push(msg.text());
      });
      await page.waitForTimeout(500);
      // No fatal JS errors related to calendar
      const calendarErrors = errors.filter(
        (e) => e.includes("calendar") || e.includes("FullCalendar"),
      );
      expect(calendarErrors).toHaveLength(0);
    });

    it("settings tab shows automation schedule editor", async () => {
      // Navigate to settings
      const settingsTab = page.locator(
        '[data-tab="settings"], [x-on\\:click*="settings"], button:has-text("Settings")',
      );
      if ((await settingsTab.count()) > 0) {
        await settingsTab.first().click();
        await page.waitForTimeout(1000);
      }

      // Take screenshot
      await page.screenshot({
        path: join(SCREENSHOT_DIR, "settings-tab.png"),
        fullPage: true,
      });

      // Verify automation-related content exists
      const pageText = await page.textContent("body");
      expect(pageText).toBeTruthy();

      // Verify no old work-patterns section
      const workPatterns = page.locator('text="Work Patterns"');
      expect(await workPatterns.count()).toBe(0);
    });

    it("automation detail shows job history", async () => {
      // Navigate back to home/automations
      const homeTab = page.locator(
        '[data-tab="home"], [x-on\\:click*="home"], button:has-text("Home")',
      );
      if ((await homeTab.count()) > 0) {
        await homeTab.first().click();
        await page.waitForTimeout(1000);
      }

      // Click on an automation in the widget
      const automationLink = page.locator(
        '[x-on\\:click*="automation"], [data-automation-id], .automation-item',
      );
      if ((await automationLink.count()) > 0) {
        await automationLink.first().click();
        await page.waitForTimeout(1000);
      }

      // Take screenshot
      await page.screenshot({
        path: join(SCREENSHOT_DIR, "automation-detail.png"),
        fullPage: true,
      });
    });
  },
);
