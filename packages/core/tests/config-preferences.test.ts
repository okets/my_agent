import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { stringify } from "yaml";
import { loadPreferences } from "../src/config.js";

describe("loadPreferences", () => {
  const tmpDir = join(import.meta.dirname, ".tmp-config-test");

  beforeEach(() => {
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("should return defaults when config.yaml has no preferences section", () => {
    writeFileSync(join(tmpDir, "config.yaml"), stringify({ agent: { nickname: "Test" } }));
    const prefs = loadPreferences(tmpDir);
    expect(prefs.morningBrief.time).toBe("08:00");
    expect(prefs.morningBrief.model).toBe("sonnet");
    expect(prefs.morningBrief.channel).toBe("default");
    expect(prefs.timezone).toBe("UTC");
  });

  it("should return defaults when config.yaml does not exist", () => {
    const prefs = loadPreferences(join(tmpDir, "nonexistent"));
    expect(prefs.morningBrief.time).toBe("08:00");
    expect(prefs.timezone).toBe("UTC");
  });

  it("should parse preferences from config.yaml", () => {
    const yaml = {
      agent: { nickname: "Test" },
      preferences: {
        morningBrief: { time: "09:30", model: "opus" },
        timezone: "Asia/Bangkok",
      },
    };
    writeFileSync(join(tmpDir, "config.yaml"), stringify(yaml));
    const prefs = loadPreferences(tmpDir);
    expect(prefs.morningBrief.time).toBe("09:30");
    expect(prefs.morningBrief.model).toBe("opus");
    expect(prefs.morningBrief.channel).toBe("default"); // not in yaml, uses default
    expect(prefs.timezone).toBe("Asia/Bangkok");
  });
});
