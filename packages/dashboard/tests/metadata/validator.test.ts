import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { writeFrontmatter } from "../../src/metadata/frontmatter.js";
import {
  validateFrontmatter,
  validateAndNotify,
  attemptHaikuRepair,
} from "../../src/metadata/validator.js";

describe("validateFrontmatter", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "validator-test-"));
    mkdirSync(join(tmpDir, "notebook", "config"), { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns no errors for valid work-patterns.md", () => {
    const file = join(tmpDir, "notebook", "config", "work-patterns.md");
    writeFrontmatter(file, {
      jobs: {
        "morning-prep": { cadence: "daily:08:00", model: "haiku" },
      },
    });

    const errors = validateFrontmatter(file, tmpDir);
    expect(errors).toEqual([]);
  });

  it("returns errors for invalid work-patterns.md", () => {
    const file = join(tmpDir, "notebook", "config", "work-patterns.md");
    writeFrontmatter(file, {
      jobs: {
        "bad-job": { cadence: "hourly:30", model: "haiku" },
      },
    });

    const errors = validateFrontmatter(file, tmpDir);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].errors[0]).toContain("cadence");
  });

  it("returns errors for missing jobs key", () => {
    const file = join(tmpDir, "notebook", "config", "work-patterns.md");
    writeFrontmatter(file, { title: "oops" });

    const errors = validateFrontmatter(file, tmpDir);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].errors[0]).toContain("jobs");
  });

  it("returns empty for unknown file path (no schema)", () => {
    const file = join(tmpDir, "random", "file.md");
    mkdirSync(join(tmpDir, "random"), { recursive: true });
    writeFrontmatter(file, { anything: "goes" });

    const errors = validateFrontmatter(file, tmpDir);
    expect(errors).toEqual([]);
  });

  it("returns error for malformed YAML", () => {
    const file = join(tmpDir, "notebook", "config", "work-patterns.md");
    writeFileSync(file, "---\n: broken: yaml: [\n---\n");

    const errors = validateFrontmatter(file, tmpDir);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].errors[0]).toContain("parse");
  });
});

describe("validateAndNotify", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "validator-notify-"));
    mkdirSync(join(tmpDir, "notebook", "config"), { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates notification on validation error", () => {
    const file = join(tmpDir, "notebook", "config", "work-patterns.md");
    writeFrontmatter(file, { jobs: { "bad": { cadence: "invalid" } } });

    const notifications: any[] = [];
    const mockService = {
      requestInput: (input: any) => {
        notifications.push(input);
        return { id: "test-id" };
      },
      notify: () => {},
    };

    const errors = validateAndNotify(file, tmpDir, mockService);
    expect(errors.length).toBeGreaterThan(0);
    expect(notifications).toHaveLength(1);
    expect(notifications[0].question).toContain("validation error");
    expect(notifications[0].options).toHaveLength(2);
  });

  it("does not create notification when valid", () => {
    const file = join(tmpDir, "notebook", "config", "work-patterns.md");
    writeFrontmatter(file, {
      jobs: { "morning-prep": { cadence: "daily:08:00", model: "haiku" } },
    });

    const notifications: any[] = [];
    const mockService = {
      requestInput: (input: any) => {
        notifications.push(input);
        return { id: "test-id" };
      },
      notify: () => {},
    };

    const errors = validateAndNotify(file, tmpDir, mockService);
    expect(errors).toEqual([]);
    expect(notifications).toHaveLength(0);
  });
});

describe("attemptHaikuRepair", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "validator-repair-"));
    mkdirSync(join(tmpDir, "notebook", "config"), { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("repairs broken frontmatter when haiku returns valid JSON", async () => {
    const file = join(tmpDir, "notebook", "config", "work-patterns.md");
    writeFrontmatter(file, { jobs: { "bad": { cadence: "invalid" } } }, "# Body");

    const errors = validateFrontmatter(file, tmpDir);

    // Mock haiku returning corrected JSON
    const mockHaiku = async () =>
      JSON.stringify({
        jobs: { "bad": { cadence: "daily:08:00", model: "haiku" } },
      });

    const result = await attemptHaikuRepair(file, tmpDir, errors, mockHaiku);
    expect(result).toBe(true);

    // Verify the file is now valid
    const afterErrors = validateFrontmatter(file, tmpDir);
    expect(afterErrors).toEqual([]);
  });

  it("returns false and notifies when haiku response is still invalid", async () => {
    const file = join(tmpDir, "notebook", "config", "work-patterns.md");
    writeFrontmatter(file, { jobs: { "bad": { cadence: "invalid" } } });

    const errors = validateFrontmatter(file, tmpDir);
    const notifications: any[] = [];

    const mockHaiku = async () =>
      JSON.stringify({ jobs: { "still-bad": { cadence: "still-invalid" } } });

    const mockNotify = {
      notify: (input: any) => notifications.push(input),
    };

    const result = await attemptHaikuRepair(file, tmpDir, errors, mockHaiku, mockNotify);
    expect(result).toBe(false);
    expect(notifications).toHaveLength(1);
    expect(notifications[0].message).toContain("Auto-repair failed");
  });

  it("returns false when haiku returns non-JSON", async () => {
    const file = join(tmpDir, "notebook", "config", "work-patterns.md");
    writeFrontmatter(file, { jobs: { "bad": { cadence: "invalid" } } });

    const errors = validateFrontmatter(file, tmpDir);
    const notifications: any[] = [];

    const mockHaiku = async () => "I don't know how to fix this";
    const mockNotify = {
      notify: (input: any) => notifications.push(input),
    };

    const result = await attemptHaikuRepair(file, tmpDir, errors, mockHaiku, mockNotify);
    expect(result).toBe(false);
    expect(notifications).toHaveLength(1);
  });
});
