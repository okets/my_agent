/**
 * M9.4-S5: Progress Card Handoff — Playwright browser verification
 *
 * Validates the three-phase handoff (running → handing-off → fading).
 * Jobs are injected via Alpine.store("jobs").update() and DOM events
 * are dispatched directly to window — no backend alerts are triggered,
 * so these tests do not bleed to real channels.
 *
 * Mirrors tests/browser/progress-card.test.ts style (vitest + playwright,
 * not @playwright/test).
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { chromium, type Browser, type Page } from "playwright";

const DASHBOARD_URL = process.env.DASHBOARD_URL || "http://localhost:4321";

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

// NOTE: we do NOT default `notify` to "immediate" — JS replaces explicit
// `undefined` args with default values, which would clobber our AC6b case.
// Pass explicitly: "immediate" | "none" | "debrief" | null for absent.
function makeJob(
  id: string,
  status: "running" | "completed" | "failed" | "needs_review",
  notify: string | null,
  todoCount = 2,
): Record<string, unknown> {
  const job: Record<string, unknown> = {
    id,
    automationId: "test-auto",
    automationName: `Test ${id}`,
    status,
    created: new Date().toISOString(),
    completed: status === "running" ? undefined : new Date().toISOString(),
    todoProgress: {
      done: status === "running" ? 0 : todoCount,
      total: todoCount,
      current: status === "running" ? "Step 1" : null,
      items: Array.from({ length: todoCount }, (_, i) => ({
        id: `${id}-t${i}`,
        text: `Step ${i + 1}`,
        status:
          status === "running" ? (i === 0 ? "in_progress" : "pending") : "done",
      })),
    },
  };
  if (notify !== null) job.notify = notify;
  return job;
}

async function injectJobs(page: Page, jobs: unknown[]): Promise<void> {
  await page.evaluate((jobs) => {
    // @ts-ignore
    Alpine.store("jobs").update(jobs);
  }, jobs);
  await page.waitForTimeout(150);
}

async function injectStartEvent(
  page: Page,
  triggerJobId: string,
): Promise<void> {
  await page.evaluate((triggerJobId) => {
    window.dispatchEvent(
      new CustomEvent("assistant-turn-start", {
        detail: { triggerJobId },
      }),
    );
  }, triggerJobId);
  await page.waitForTimeout(50);
}

async function injectHandoffPending(page: Page, jobId: string): Promise<void> {
  await page.evaluate((jobId) => {
    window.dispatchEvent(
      new CustomEvent("handoff-pending", { detail: { jobId } }),
    );
  }, jobId);
  await page.waitForTimeout(50);
}

async function resetState(page: Page): Promise<void> {
  await page.evaluate(() => {
    // @ts-ignore
    const store = Alpine.store("jobs");
    store.items = [];
    store.dismissed = [];
    store.completedCards = [];
    store.loading = false;
    // @ts-ignore
    const els = document.querySelectorAll('[x-data="progressCard()"]');
    for (const el of els) {
      // @ts-ignore
      const data = Alpine.$data(el);
      if (data) {
        data.expanded = {};
        data.fading = {};
        data.phase = {};
        data.frozenSnapshot = {};
        // Clear any outstanding safety timers
        for (const k of Object.keys(data.safetyTimers || {})) {
          clearTimeout(data.safetyTimers[k]);
        }
        data.safetyTimers = {};
      }
    }
  });
  await page.waitForTimeout(100);
}

async function isDoneVisible(page: Page): Promise<boolean> {
  // A handing-off card renders its label as "Done" via the existing isDone() check.
  // We look for at least one rendered progressCard() wrapper showing "Done" text.
  const locator = page.locator('[x-data="progressCard()"]').first();
  const visible = await locator.isVisible();
  if (!visible) return false;
  const text = (await locator.textContent()) ?? "";
  return text.includes("Done");
}

describe.skipIf(!dashboardAvailable)(
  "Progress Card Handoff (M9.4-S5)",
  () => {
    let browser: Browser;
    let page: Page;

    beforeAll(async () => {
      browser = await chromium.launch({ headless: true });
      page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
      await page.goto(DASHBOARD_URL);
      await page.waitForTimeout(2000);
    });

    afterAll(async () => {
      await browser?.close();
    });

    beforeEach(async () => {
      await resetState(page);
    });

    it("AC4: card stays in 'Done' until matching tagged start arrives", { timeout: 30000 }, async () => {
      const job = makeJob("h-ac4", "running", "immediate");
      await injectJobs(page, [job]);
      await injectJobs(page, [makeJob("h-ac4", "completed", "immediate")]);

      // Card should show "Done" immediately
      expect(await isDoneVisible(page)).toBe(true);

      // Wait 3s (past the legacy 2s fade mark) — card must still be visible
      await page.waitForTimeout(3000);
      expect(await isDoneVisible(page)).toBe(true);

      // Inject the tagged start — card should fade within ~2.5s
      await injectStartEvent(page, "h-ac4");
      await page.waitForTimeout(2500);
      expect(await isDoneVisible(page)).toBe(false);
    });

    it("AC5: sibling card resets safety net when A fades", { timeout: 30000 }, async () => {
      const jobA = makeJob("h-a", "running", "immediate");
      const jobB = makeJob("h-b", "running", "immediate");
      await injectJobs(page, [jobA, jobB]);
      await injectJobs(page, [
        makeJob("h-a", "completed", "immediate"),
        makeJob("h-b", "completed", "immediate"),
      ]);

      // Wait 8s — both siblings at t=8/10
      await page.waitForTimeout(8000);

      // Fade A, which should reset B's timer
      await injectStartEvent(page, "h-a");
      await page.waitForTimeout(2500); // A fades

      // B should still be visible at t≈10.5s (expired without sibling reset)
      expect(await isDoneVisible(page)).toBe(true);

      // Fade B with its own start
      await injectStartEvent(page, "h-b");
      await page.waitForTimeout(2500);
      expect(await isDoneVisible(page)).toBe(false);
    });

    it("AC6: notify='none' runs legacy 2s fade, no handing-off", { timeout: 15000 }, async () => {
      await injectJobs(page, [makeJob("h-none", "running", "none")]);
      await injectJobs(page, [makeJob("h-none", "completed", "none")]);

      // Card should fade within ~2.5s with no further input
      await page.waitForTimeout(2500);
      expect(await isDoneVisible(page)).toBe(false);
    });

    it("AC6b: notify=undefined treated as debrief (legacy fade)", { timeout: 15000 }, async () => {
      await injectJobs(page, [makeJob("h-undef", "running", null)]);
      await injectJobs(page, [makeJob("h-undef", "completed", null)]);

      await page.waitForTimeout(2500);
      expect(await isDoneVisible(page)).toBe(false);
    });

    it("AC7: safety net fires at 10s with no start and no handoff_pending", { timeout: 30000 }, async () => {
      await injectJobs(page, [makeJob("h-stale", "running", "immediate")]);
      await injectJobs(page, [makeJob("h-stale", "completed", "immediate")]);

      // Past the 2s legacy mark — must still be visible (handing-off)
      await page.waitForTimeout(3000);
      expect(await isDoneVisible(page)).toBe(true);

      // Wait past 10s + 2s fade = 12.5s total
      await page.waitForTimeout(10000);
      expect(await isDoneVisible(page)).toBe(false);
    });

    it("AC12: handoff_pending for own jobId resets safety net (cold-start)", { timeout: 30000 }, async () => {
      await injectJobs(page, [makeJob("h-cold", "running", "immediate")]);
      await injectJobs(page, [makeJob("h-cold", "completed", "immediate")]);

      // Wait 8s, then send handoff_pending for THIS jobId — resets timer
      await page.waitForTimeout(8000);
      await injectHandoffPending(page, "h-cold");

      // t≈14s; would have expired at t=10 without the reset
      await page.waitForTimeout(6000);
      expect(await isDoneVisible(page)).toBe(true);
    });
  },
);
