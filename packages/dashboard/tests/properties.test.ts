import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

let tmpDir: string;

describe("properties utilities", () => {
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "props-"));
    mkdirSync(join(tmpDir, "notebook", "properties"), { recursive: true });
  });

  afterEach(() => {
    if (tmpDir && existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("readProperties returns empty object when file missing", async () => {
    const { readProperties } = await import("../src/conversations/properties.js");
    const result = await readProperties(tmpDir);
    expect(result).toEqual({});
  });

  it("readProperties parses existing YAML", async () => {
    writeFileSync(
      join(tmpDir, "notebook", "properties", "status.yaml"),
      `location:
  value: "Chiang Mai, Thailand"
  confidence: high
  updated: "2026-03-12"
  source: "explicit mention"
`
    );

    const { readProperties } = await import("../src/conversations/properties.js");
    const result = await readProperties(tmpDir);
    expect(result.location.value).toBe("Chiang Mai, Thailand");
    expect(result.location.confidence).toBe("high");
  });

  it("updateProperty sets a new property", async () => {
    const { updateProperty, readProperties } = await import("../src/conversations/properties.js");

    await updateProperty(tmpDir, "location", {
      value: "Krabi, Thailand",
      confidence: "high",
      source: "user stated",
    });

    const result = await readProperties(tmpDir);
    expect(result.location.value).toBe("Krabi, Thailand");
    expect(result.location.confidence).toBe("high");
    expect(result.location.updated).toBeDefined();
  });

  it("updateProperty overwrites existing property", async () => {
    const { updateProperty, readProperties } = await import("../src/conversations/properties.js");

    await updateProperty(tmpDir, "location", {
      value: "Chiang Mai",
      confidence: "high",
      source: "test",
    });

    await updateProperty(tmpDir, "location", {
      value: "Krabi",
      confidence: "medium",
      source: "inferred",
    });

    const result = await readProperties(tmpDir);
    expect(result.location.value).toBe("Krabi");
    expect(result.location.confidence).toBe("medium");
  });

  it("updateProperty preserves other properties", async () => {
    const { updateProperty, readProperties } = await import("../src/conversations/properties.js");

    await updateProperty(tmpDir, "location", {
      value: "Chiang Mai",
      confidence: "high",
      source: "test",
    });

    await updateProperty(tmpDir, "timezone", {
      value: "Asia/Bangkok",
      confidence: "high",
      source: "inferred from location",
    });

    const result = await readProperties(tmpDir);
    expect(result.location.value).toBe("Chiang Mai");
    expect(result.timezone.value).toBe("Asia/Bangkok");
  });
});
