import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

let tmpDir: string;

describe("loadProperties", () => {
  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "load-props-"));
    mkdirSync(join(tmpDir, "notebook", "properties"), { recursive: true });
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns null when properties dir does not exist", async () => {
    const { loadProperties } = await import("../src/prompt.js");
    const result = await loadProperties("/nonexistent/dir");
    expect(result).toBeNull();
  });

  it("returns null when status.yaml does not exist", async () => {
    const emptyDir = mkdtempSync(join(tmpdir(), "no-yaml-"));
    mkdirSync(join(emptyDir, "notebook", "properties"), { recursive: true });

    const { loadProperties } = await import("../src/prompt.js");
    const result = await loadProperties(emptyDir);
    expect(result).toBeNull();

    rmSync(emptyDir, { recursive: true, force: true });
  });

  it("formats YAML properties as text block", async () => {
    writeFileSync(
      join(tmpDir, "notebook", "properties", "status.yaml"),
      `location:
  value: "Chiang Mai, Thailand"
  confidence: high
  updated: 2026-03-12
  source: "explicit mention in conversation"
timezone:
  value: "Asia/Bangkok"
  confidence: high
  updated: 2026-03-12
  source: "inferred from location"
availability:
  value: "vacation"
  confidence: medium
  updated: 2026-03-10
  source: "mentioned taking time off"
`
    );

    const { loadProperties } = await import("../src/prompt.js");
    const result = await loadProperties(tmpDir);

    expect(result).not.toBeNull();
    expect(result).toContain("[Dynamic Status]");
    expect(result).toContain("Location: Chiang Mai, Thailand");
    expect(result).toContain("high confidence");
    expect(result).toContain("Timezone: Asia/Bangkok");
    expect(result).toContain("Availability: vacation");
    expect(result).toContain("medium confidence");
    expect(result).toContain("[End Dynamic Status]");
  });
});
