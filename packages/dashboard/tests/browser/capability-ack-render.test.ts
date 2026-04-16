/**
 * S6-FU5 — capability_ack WS message renders as an assistant turn.
 *
 * Injects a synthetic capability_ack message via page.evaluate and asserts
 * that the ack text appears in the conversation transcript styled as an
 * assistant bubble (i.e. within the assistant-bubble CSS class).
 *
 * Gate: DASHBOARD_URL env (default http://localhost:4321). Skips if dashboard
 * is unreachable.
 *
 * Created in M9.6-S8 (S6-FU5 fix).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
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

describe.skipIf(!dashboardAvailable)(
  "capability_ack WS message renders in conversation view",
  () => {
    let browser: Browser;
    let page: Page;

    beforeAll(async () => {
      browser = await chromium.launch();
      page = await browser.newPage();
      await page.goto(DASHBOARD_URL, { waitUntil: "networkidle" });
    });

    afterAll(async () => {
      await browser.close();
    });

    it("injects capability_ack and sees ack text in an assistant bubble", async () => {
      const ackText = "hold on — voice transcription isn't working right, fixing now.";

      // Inject the message directly into the Alpine chat() component's WS handler
      await page.evaluate((text) => {
        // @ts-ignore — Alpine is a global injected by CDN
        const body = document.querySelector("body");
        // @ts-ignore
        const data = Alpine.$data(body);
        data.handleWebSocketMessage({
          type: "capability_ack",
          conversationId: data.currentConversationId || "test-conv-ack",
          content: text,
          timestamp: new Date().toISOString(),
        });
      }, ackText);

      // Assert the ack text appears in the messages list
      await expect(
        page.locator(".assistant-bubble", { hasText: ackText }),
      ).toBeVisible({ timeout: 3000 });
    });
  },
);
