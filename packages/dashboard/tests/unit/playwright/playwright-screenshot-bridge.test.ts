import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PlaywrightScreenshotBridge } from "../../../src/playwright/playwright-screenshot-bridge.js";
import { VisualActionService } from "../../../src/visual/visual-action-service.js";
describe("PlaywrightScreenshotBridge", () => {
  let vas: VisualActionService;
  let bridge: PlaywrightScreenshotBridge;
  let agentDir: string;

  beforeEach(() => {
    agentDir = mkdtempSync(join(tmpdir(), "pw-bridge-"));
    vas = new VisualActionService(agentDir);
    bridge = new PlaywrightScreenshotBridge(vas);
  });

  it("stores a base64 screenshot via VisualActionService", () => {
    const base64 = Buffer.from("fake-png-data").toString("base64");

    const screenshot = bridge.storeFromBase64(base64, {
      description: "Playwright: navigated to google.com",
    });

    expect(screenshot.id).toMatch(/^ss-/);
    expect(screenshot.description).toBe(
      "Playwright: navigated to google.com",
    );
    expect(screenshot.refs).toEqual([]);
    expect(screenshot.source).toBe("playwright");
  });

  it("lists stored screenshots", () => {
    const base64 = Buffer.from("data").toString("base64");

    bridge.storeFromBase64(base64, { description: "first" });
    bridge.storeFromBase64(base64, { description: "second" });

    const screenshots = vas.listUnreferenced();
    expect(screenshots).toHaveLength(2);
  });

  it("uses default description when not provided", () => {
    const base64 = Buffer.from("data").toString("base64");

    const screenshot = bridge.storeFromBase64(base64, {});
    expect(screenshot.description).toBe("Playwright browser screenshot");
  });

  it("uses default dimensions when not provided", () => {
    const base64 = Buffer.from("data").toString("base64");

    const screenshot = bridge.storeFromBase64(base64, {});
    expect(screenshot.width).toBe(1280);
    expect(screenshot.height).toBe(720);
  });

  it("closeBrowser is safe to call when no browser is open", async () => {
    // Should not throw
    await bridge.closeBrowser();
  });
});
