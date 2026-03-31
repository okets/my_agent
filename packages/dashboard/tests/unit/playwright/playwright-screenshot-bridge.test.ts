import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PlaywrightScreenshotBridge } from "../../../src/playwright/playwright-screenshot-bridge.js";
import { VisualActionService } from "../../../src/visual/visual-action-service.js";
import type { AssetContext } from "@my-agent/core";

describe("PlaywrightScreenshotBridge", () => {
  let vas: VisualActionService;
  let bridge: PlaywrightScreenshotBridge;
  let agentDir: string;

  beforeEach(() => {
    agentDir = mkdtempSync(join(tmpdir(), "pw-bridge-"));
    mkdirSync(join(agentDir, "conversations", "conv-1"), { recursive: true });
    vas = new VisualActionService(agentDir);
    bridge = new PlaywrightScreenshotBridge(vas);
  });

  it("stores a base64 screenshot via VisualActionService", () => {
    const base64 = Buffer.from("fake-png-data").toString("base64");
    const context: AssetContext = { type: "conversation", id: "conv-1" };

    const screenshot = bridge.storeFromBase64(base64, {
      context,
      description: "Playwright: navigated to google.com",
    });

    expect(screenshot.id).toMatch(/^ss-/);
    expect(screenshot.context).toEqual(context);
    expect(screenshot.description).toBe(
      "Playwright: navigated to google.com",
    );
    expect(screenshot.tag).toBe("keep");
  });

  it("stores with job context", () => {
    mkdirSync(
      join(agentDir, "automations", ".runs", "auto-1", "job-1"),
      { recursive: true },
    );
    const base64 = Buffer.from("fake-png-data").toString("base64");
    const context: AssetContext = {
      type: "job",
      id: "job-1",
      automationId: "auto-1",
    };

    const screenshot = bridge.storeFromBase64(base64, { context });
    expect(screenshot.context.type).toBe("job");
  });

  it("lists stored screenshots", () => {
    const base64 = Buffer.from("data").toString("base64");
    const context: AssetContext = { type: "conversation", id: "conv-1" };

    bridge.storeFromBase64(base64, { context, description: "first" });
    bridge.storeFromBase64(base64, { context, description: "second" });

    const screenshots = vas.list(context);
    expect(screenshots).toHaveLength(2);
  });

  it("uses default description when not provided", () => {
    const base64 = Buffer.from("data").toString("base64");
    const context: AssetContext = { type: "conversation", id: "conv-1" };

    const screenshot = bridge.storeFromBase64(base64, { context });
    expect(screenshot.description).toBe("Playwright browser screenshot");
  });

  it("uses default dimensions when not provided", () => {
    const base64 = Buffer.from("data").toString("base64");
    const context: AssetContext = { type: "conversation", id: "conv-1" };

    const screenshot = bridge.storeFromBase64(base64, { context });
    expect(screenshot.width).toBe(1280);
    expect(screenshot.height).toBe(720);
  });

  it("uses custom tag when provided", () => {
    const base64 = Buffer.from("data").toString("base64");
    const context: AssetContext = { type: "conversation", id: "conv-1" };

    const screenshot = bridge.storeFromBase64(base64, { context, tag: "skip" });
    expect(screenshot.tag).toBe("skip");
  });

  it("closeBrowser is safe to call when no browser is open", async () => {
    // Should not throw
    await bridge.closeBrowser();
  });
});
