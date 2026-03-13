import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readFrontmatter, writeFrontmatter } from "../../src/metadata/frontmatter.js";

describe("readFrontmatter", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "fm-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("parses YAML frontmatter and returns data + body", () => {
    const file = join(tmpDir, "test.md");
    writeFileSync(file, "---\nfoo: bar\ncount: 42\n---\n\n# Body\n\nSome text.");
    const result = readFrontmatter<{ foo: string; count: number }>(file);
    expect(result.data.foo).toBe("bar");
    expect(result.data.count).toBe(42);
    expect(result.body).toContain("# Body");
    expect(result.body).toContain("Some text.");
  });

  it("returns empty data when no frontmatter present", () => {
    const file = join(tmpDir, "test.md");
    writeFileSync(file, "# Just markdown\n\nNo frontmatter here.");
    const result = readFrontmatter(file);
    expect(result.data).toEqual({});
    expect(result.body).toContain("# Just markdown");
  });

  it("handles empty file", () => {
    const file = join(tmpDir, "test.md");
    writeFileSync(file, "");
    const result = readFrontmatter(file);
    expect(result.data).toEqual({});
    expect(result.body).toBe("");
  });

  it("handles frontmatter with no body", () => {
    const file = join(tmpDir, "test.md");
    writeFileSync(file, "---\nkey: value\n---\n");
    const result = readFrontmatter<{ key: string }>(file);
    expect(result.data.key).toBe("value");
    expect(result.body.trim()).toBe("");
  });

  it("throws on malformed YAML", () => {
    const file = join(tmpDir, "test.md");
    writeFileSync(file, "---\n: invalid: yaml: [broken\n---\n");
    expect(() => readFrontmatter(file)).toThrow();
  });

  it("throws when file does not exist", () => {
    expect(() => readFrontmatter(join(tmpDir, "nonexistent.md"))).toThrow();
  });
});

describe("writeFrontmatter", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "fm-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("writes YAML frontmatter + body", () => {
    const file = join(tmpDir, "test.md");
    writeFrontmatter(file, { foo: "bar", count: 42 }, "# Hello\n\nWorld.");
    const raw = readFileSync(file, "utf-8");
    expect(raw).toMatch(/^---\n/);
    expect(raw).toContain("foo: bar");
    expect(raw).toContain("count: 42");
    expect(raw).toContain("# Hello");
    expect(raw).toContain("World.");
  });

  it("roundtrips correctly", () => {
    const file = join(tmpDir, "test.md");
    const data = { jobs: { "debrief-prep": { cadence: "daily:08:00", model: "haiku" } } };
    const body = "# Work Patterns\n\nDebrief prep runs at 08:00.";
    writeFrontmatter(file, data, body);
    const result = readFrontmatter<typeof data>(file);
    expect(result.data).toEqual(data);
    expect(result.body).toContain("# Work Patterns");
  });

  it("preserves existing body when body param is omitted", () => {
    const file = join(tmpDir, "test.md");
    writeFileSync(file, "---\nold: data\n---\n\n# Existing Body\n\nKeep this.");
    writeFrontmatter(file, { new: "data" });
    const result = readFrontmatter<{ new: string }>(file);
    expect(result.data.new).toBe("data");
    expect(result.body).toContain("# Existing Body");
    expect(result.body).toContain("Keep this.");
  });

  it("writes frontmatter with empty body", () => {
    const file = join(tmpDir, "test.md");
    writeFrontmatter(file, { key: "value" }, "");
    const raw = readFileSync(file, "utf-8");
    expect(raw).toMatch(/^---\n/);
    expect(raw).toContain("key: value");
  });
});
