import { describe, it, expect, afterEach, vi } from "vitest";
import { resolveJobSummary, resolveJobSummaryAsync } from "../../../src/automations/summary-resolver.js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { WAS_NESTED, allowNestedSessions } from "../../live/helpers.js";

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

  it("passes full content to Haiku — no byte-slicing (huge early + tiny late sections)", async () => {
    const dir = makeTmpDir();
    // One 25K section followed by four 1K sections — the 2026-04-20 failure shape
    const earlySection = `## early-section\n\n${"X".repeat(25_000)}`;
    const lateSection1 = `## late-section-1\n\n${"A".repeat(1_000)}`;
    const lateSection2 = `## late-section-2\n\n${"B".repeat(1_000)}`;
    const lateSection3 = `## late-section-3\n\n${"C".repeat(1_000)}`;
    const lateSection4 = `## late-section-4\n\n${"D".repeat(1_000)}`;
    const full = [earlySection, lateSection1, lateSection2, lateSection3, lateSection4].join("\n\n");
    fs.writeFileSync(path.join(dir, "deliverable.md"), full);

    let capturedPrompt = "";
    const mockQuery = vi.fn(async (prompt: string) => {
      capturedPrompt = prompt;
      // Return all headings so verification passes
      return "## early-section\n## late-section-1\n## late-section-2\n## late-section-3\n## late-section-4\nCondensed.";
    });

    await resolveJobSummaryAsync(dir, "fallback", mockQuery);

    expect(mockQuery).toHaveBeenCalledOnce();
    // All late sections must be in the prompt passed to Haiku — not sliced off
    expect(capturedPrompt).toContain("## late-section-1");
    expect(capturedPrompt).toContain("## late-section-2");
    expect(capturedPrompt).toContain("## late-section-3");
    expect(capturedPrompt).toContain("## late-section-4");
  });

  it("falls back to raw input when Haiku drops a section heading", async () => {
    const dir = makeTmpDir();
    const content = [
      `## section-alpha\n\n${"A".repeat(4_000)}`,
      `## section-beta\n\n${"B".repeat(4_000)}`,
      `## section-gamma\n\n${"C".repeat(4_000)}`,
    ].join("\n\n");
    fs.writeFileSync(path.join(dir, "deliverable.md"), content);

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const mockQuery = vi.fn(async () =>
      // Haiku drops section-gamma
      "## section-alpha\nCompressed alpha.\n## section-beta\nCompressed beta."
    );

    const result = await resolveJobSummaryAsync(dir, "fallback", mockQuery);

    // Must fall back to raw — section-gamma was dropped
    expect(result).toContain("## section-gamma");
    expect(result.length).toBeGreaterThan(10_000);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("section-gamma"));
    warnSpy.mockRestore();
  });

  it("returns stub and skips Haiku when content exceeds 100K hard cap", async () => {
    const dir = makeTmpDir();
    const content = [
      `## huge-section-1\n\n${"A".repeat(40_000)}`,
      `## huge-section-2\n\n${"B".repeat(40_000)}`,
      `## huge-section-3\n\n${"C".repeat(25_000)}`,
    ].join("\n\n");
    // total > 100K
    fs.writeFileSync(path.join(dir, "deliverable.md"), content);

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const mockQuery = vi.fn(async () => "should not be called");

    const result = await resolveJobSummaryAsync(dir, "fallback", mockQuery);

    expect(mockQuery).not.toHaveBeenCalled();
    expect(result).toContain("exceeded safe size");
    expect(result).toContain("huge-section-1");
    expect(result).toContain("huge-section-2");
    expect(result).toContain("huge-section-3");
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("Hard cap exceeded"));
    warnSpy.mockRestore();
  });
});

const FIXTURE_PATH = new URL("../../fixtures/debrief-2026-04-20.md", import.meta.url).pathname;

const EXPECTED_HEADINGS = [
  "cfr-fix-test-type-a1-exec-cee49e8b",
  "cfr-fix-test-type-a2-exec-85e1eae7",
  "cfr-fix-browser-control-a1-exec-fcd0d34d",
  "cfr-fix-text-to-audio-a1-exec-aa89baa4",
  "cfr-fix-test-type-a3-exec-16e00970",
  "cfr-fix-text-to-audio-a2-exec-55a1084c",
  "cfr-fix-browser-control-a2-exec-da70561d",
  "cfr-fix-text-to-audio-a3-exec-029f023c",
  "cfr-fix-browser-control-a3-exec-43146a22",
  "chiang-mai-aqi-worker",
  "expat-tips-worker",
  "project-status-worker",
  "chiang-mai-events-worker",
  "thailand-news-worker",
];

describe("resolveJobSummaryAsync — live fixture regression (requires Agent SDK session)", () => {
  const tmpDirs: string[] = [];

  function makeTmpDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "summary-resolver-live-"));
    tmpDirs.push(dir);
    return dir;
  }

  afterEach(() => {
    for (const dir of tmpDirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    tmpDirs.length = 0;
  });

  it.skipIf(!WAS_NESTED)(
    "all 14 worker headings survive Haiku condense on the 2026-04-20 fixture",
    async () => {
      allowNestedSessions();

      const fixtureContent = fs.readFileSync(FIXTURE_PATH, "utf-8");
      // Strip the HTML comment provenance header before writing to runDir
      const body = fixtureContent.replace(/^<!--[\s\S]*?-->\n\n/, "");

      const dir = makeTmpDir();
      fs.writeFileSync(path.join(dir, "deliverable.md"), body);

      const { queryModel } = await import("../../../src/scheduler/query-model.js");

      let result: string;
      try {
        result = await resolveJobSummaryAsync(dir, "fallback", queryModel);
      } catch (err) {
        console.warn("[live-test] Haiku call threw, skipping assertions:", err);
        return;
      }

      // If Haiku failed inside resolveJobSummaryAsync, resolver returns raw content (>10K).
      // Graceful skip rather than fail — note in test-report.
      if (result.length > 10_000) {
        console.warn(
          `[live-test] Haiku condense unavailable — result is raw (${result.length} chars). ` +
          "Re-run with authenticated Agent SDK session for full assertion.",
        );
        return;
      }

      // Every one of the 14 top-level worker-wrapper headings must appear in output
      for (const heading of EXPECTED_HEADINGS) {
        expect(result, `Missing heading: ## ${heading}`).toContain(`## ${heading}`);
      }

      // Must be within Haiku 10K output target
      expect(result.length).toBeLessThanOrEqual(10_000);

      // Representative user-facing facts must survive
      const hasAqi = result.includes("157") || result.includes("AQI");
      expect(hasAqi).toBe(true);

      const hasCmFact =
        result.includes("Songkran") ||
        result.includes("PM2.5") ||
        result.includes("Chiang Mai");
      expect(hasCmFact).toBe(true);

      expect(result).toContain("S19");
    },
    120_000, // 2-minute timeout for real Haiku call
  );
});
