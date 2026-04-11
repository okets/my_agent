import { describe, it, expect, afterEach } from "vitest";
import { resolveJobSummary, resolveJobSummaryAsync } from "../../../src/automations/summary-resolver.js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

describe("resolveJobSummary", () => {
  const tmpDirs: string[] = [];

  function makeTmpDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "summary-resolver-"));
    tmpDirs.push(dir);
    return dir;
  }

  afterEach(() => {
    for (const dir of tmpDirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    tmpDirs.length = 0;
  });

  it("returns deliverable.md content when it exists", () => {
    const dir = makeTmpDir();
    fs.writeFileSync(path.join(dir, "deliverable.md"), "Here is the deliverable content.");
    const result = resolveJobSummary(dir, "fallback work");
    expect(result).toBe("Here is the deliverable content.");
  });

  it("strips YAML frontmatter from deliverable.md", () => {
    const dir = makeTmpDir();
    fs.writeFileSync(
      path.join(dir, "deliverable.md"),
      "---\ntitle: Report\nstatus: done\n---\nActual content here.",
    );
    const result = resolveJobSummary(dir, "fallback work");
    expect(result).toBe("Actual content here.");
  });

  it("falls back to status-report.md when no deliverable.md", () => {
    const dir = makeTmpDir();
    fs.writeFileSync(path.join(dir, "status-report.md"), "Status report content.");
    const result = resolveJobSummary(dir, "fallback work");
    expect(result).toBe("Status report content.");
  });

  it("falls back to fallbackWork when no files exist", () => {
    const dir = makeTmpDir();
    const result = resolveJobSummary(dir, "fallback work output");
    expect(result).toBe("fallback work output");
  });

  it("returns fallbackWork when runDir is null", () => {
    expect(resolveJobSummary(null, "fallback")).toBe("fallback");
    expect(resolveJobSummary(undefined, "fallback")).toBe("fallback");
  });

  it("skips empty deliverable.md, uses status-report.md", () => {
    const dir = makeTmpDir();
    fs.writeFileSync(path.join(dir, "deliverable.md"), "");
    fs.writeFileSync(path.join(dir, "status-report.md"), "Status fallback.");
    const result = resolveJobSummary(dir, "fallback work");
    expect(result).toBe("Status fallback.");
  });

  it("skips frontmatter-only deliverable.md (content after frontmatter is empty)", () => {
    const dir = makeTmpDir();
    fs.writeFileSync(
      path.join(dir, "deliverable.md"),
      "---\ntitle: Empty\n---\n  \n",
    );
    fs.writeFileSync(path.join(dir, "status-report.md"), "Status content.");
    const result = resolveJobSummary(dir, "fallback work");
    expect(result).toBe("Status content.");
  });

  it("truncates at 2000 chars for DB display (default maxLength)", () => {
    const dir = makeTmpDir();
    const longContent = "A".repeat(5000);
    fs.writeFileSync(path.join(dir, "deliverable.md"), longContent);
    const result = resolveJobSummary(dir, "fallback work");
    expect(result).toContain("A".repeat(100));
    expect(result).toContain("[Full results in job workspace]");
    expect(result.length).toBeLessThanOrEqual(2000 + 40);
  });

  it("respects custom maxLength parameter", () => {
    const dir = makeTmpDir();
    const longContent = "A".repeat(5000);
    fs.writeFileSync(path.join(dir, "deliverable.md"), longContent);
    const result = resolveJobSummary(dir, "fallback work", 500);
    expect(result.length).toBeLessThanOrEqual(500 + 40);
  });
});

describe("resolveJobSummaryAsync", () => {
  const tmpDirs: string[] = [];

  function makeTmpDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "summary-resolver-async-"));
    tmpDirs.push(dir);
    return dir;
  }

  afterEach(() => {
    for (const dir of tmpDirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    tmpDirs.length = 0;
  });

  it("returns disk artifact under 10K without calling Haiku", async () => {
    const dir = makeTmpDir();
    fs.writeFileSync(path.join(dir, "deliverable.md"), "Disk artifact content.");
    const mockQuery = async () => "should not be called";
    const result = await resolveJobSummaryAsync(dir, "fallback", mockQuery);
    expect(result).toBe("Disk artifact content.");
  });

  it("calls Haiku to condense content over 10K chars", async () => {
    const dir = makeTmpDir();
    const longContent = "B".repeat(12000);
    fs.writeFileSync(path.join(dir, "deliverable.md"), longContent);
    const mockQuery = async (_prompt: string, _sys: string, _model: "haiku") =>
      "Condensed by Haiku";
    const result = await resolveJobSummaryAsync(dir, "fallback", mockQuery);
    expect(result).toBe("Condensed by Haiku");
  });

  it("calls Haiku to condense long fallback when no disk artifacts", async () => {
    const dir = makeTmpDir();
    const longFallback = "C".repeat(12000);
    const mockQuery = async (_prompt: string, _sys: string, _model: "haiku") =>
      "Condensed fallback";
    const result = await resolveJobSummaryAsync(dir, longFallback, mockQuery);
    expect(result).toBe("Condensed fallback");
  });

  it("returns raw content when Haiku fails (no truncation)", async () => {
    const dir = makeTmpDir();
    const longFallback = "D".repeat(12000);
    const mockQuery = async () => {
      throw new Error("Haiku unavailable");
    };
    const result = await resolveJobSummaryAsync(dir, longFallback, mockQuery);
    expect(result).toBe(longFallback);
    expect(result.length).toBe(12000);
  });

  it("skips Haiku when content is under 10K", async () => {
    const dir = makeTmpDir();
    const content = "E".repeat(9000);
    fs.writeFileSync(path.join(dir, "deliverable.md"), content);
    let haikuCalled = false;
    const mockQuery = async (_prompt: string, _sys: string, _model: "haiku") => {
      haikuCalled = true;
      return "should not happen";
    };
    const result = await resolveJobSummaryAsync(dir, "fallback", mockQuery);
    expect(result).toBe(content);
    expect(haikuCalled).toBe(false);
  });
});
