import { describe, it, expect } from "vitest";
import { detectPlaywrightStatus } from "../../../src/playwright/playwright-status.js";

describe("detectPlaywrightStatus", () => {
  it("returns a PlaywrightStatus object", async () => {
    const status = await detectPlaywrightStatus();

    expect(status).toHaveProperty("installed");
    expect(status).toHaveProperty("browsers");
    expect(status).toHaveProperty("setupNeeded");
    expect(typeof status.installed).toBe("boolean");
    expect(Array.isArray(status.browsers)).toBe(true);
    expect(Array.isArray(status.setupNeeded)).toBe(true);
  });

  it("browsers array contains objects with name and installed", async () => {
    const status = await detectPlaywrightStatus();

    for (const browser of status.browsers) {
      expect(browser).toHaveProperty("name");
      expect(browser).toHaveProperty("installed");
      expect(typeof browser.name).toBe("string");
      expect(typeof browser.installed).toBe("boolean");
    }
  });

  it("setupNeeded is non-empty when browsers are missing", async () => {
    const status = await detectPlaywrightStatus();

    const anyMissing = status.browsers.some((b) => !b.installed);
    if (anyMissing) {
      expect(status.setupNeeded.length).toBeGreaterThan(0);
    }
  });

  it("passes enabled parameter through", async () => {
    const enabled = await detectPlaywrightStatus(true);
    expect(enabled.enabled).toBe(true);

    const disabled = await detectPlaywrightStatus(false);
    expect(disabled.enabled).toBe(false);
  });

  it("has ready=true only when at least one browser is installed", async () => {
    const status = await detectPlaywrightStatus();
    const anyInstalled = status.browsers.some((b) => b.installed);
    expect(status.ready).toBe(anyInstalled);
  });
});
