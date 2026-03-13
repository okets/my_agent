import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { stringify } from "yaml";

// loadPreferences is in packages/core/src/config.ts
// We import it using a relative path from packages/dashboard context
import { loadPreferences } from "../../core/src/config.js";

describe("Task 4: outboundChannel preference", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "config-prefs-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("loadPreferences returns outboundChannel with default 'web'", () => {
    // No config file — should get default
    const prefs = loadPreferences(tmpDir);
    expect(prefs.outboundChannel).toBe("web");
  });

  it("loadPreferences reads outboundChannel from config", () => {
    const configPath = path.join(tmpDir, "config.yaml");
    const yaml = stringify({
      preferences: {
        outboundChannel: "whatsapp",
      },
    });
    fs.writeFileSync(configPath, yaml, "utf-8");

    const prefs = loadPreferences(tmpDir);
    expect(prefs.outboundChannel).toBe("whatsapp");
  });
});
