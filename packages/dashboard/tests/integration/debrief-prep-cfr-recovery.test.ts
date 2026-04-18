/**
 * debrief-prep CFR_RECOVERY.md reader — integration tests (M9.6-S12, Task 7)
 *
 * Verifies: when CFR_RECOVERY.md is present in a job's run directory,
 * formatCfrRecoverySection() extracts and formats the capability recovery
 * summary correctly; when absent or malformed it fails silently.
 *
 * Also verifies that runDebriefPrep() threads runDir through to the prompt
 * (production call-site wiring, Task 7 spec gap fix).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Mock queryModel so runDebriefPrep can be called without a live SDK session.
// The mock captures the user prompt so we can assert CFR content was injected.
let capturedPrompt = "";
vi.mock("../../src/scheduler/query-model.js", () => ({
  queryModel: vi.fn(async (userPrompt: string) => {
    capturedPrompt = userPrompt;
    return "mocked debrief output";
  }),
}));

import {
  formatCfrRecoverySection,
  runDebriefPrep,
} from "../../src/scheduler/jobs/debrief-prep.js";

describe("formatCfrRecoverySection", () => {
  let runDir: string;

  beforeEach(() => {
    runDir = mkdtempSync(join(tmpdir(), "debrief-cfr-test-"));
  });

  afterEach(() => {
    rmSync(runDir, { recursive: true, force: true });
  });

  it("returns empty string when CFR_RECOVERY.md is absent", () => {
    const result = formatCfrRecoverySection(runDir);
    expect(result).toBe("");
  });

  it("includes capability recovery section when CFR_RECOVERY.md is present", () => {
    writeFileSync(
      join(runDir, "CFR_RECOVERY.md"),
      [
        "---",
        "plug_name: browser-chrome",
        "plug_type: browser-control",
        "detected_at: 2026-04-17T10:00:00Z",
        "resolved_at: 2026-04-17T10:05:00Z",
        "attempts: 2",
        "outcome: fixed",
        "---",
        "",
        "# browser-chrome recovery summary",
        "",
        "The browser plugin failed to start due to a missing display. Restarting with DISPLAY=:0 resolved the issue.",
        "",
        "## Attempts",
        "",
        "| # | Hypothesis | Change | Result |",
        "|---|---|---|---|",
        "| 1 | env var | set DISPLAY | pass |",
      ].join("\n"),
    );

    const result = formatCfrRecoverySection(runDir);

    expect(result).toContain("Capability recovery during this job:");
    expect(result).toContain("- Plug: browser-chrome (browser-control)");
    expect(result).toContain("- Outcome: fixed");
    expect(result).toContain("- Attempts: 2");
    expect(result).toContain(
      "The browser plugin failed to start due to a missing display.",
    );
  });

  it('outcome: "fixed" → correct summary injected', () => {
    writeFileSync(
      join(runDir, "CFR_RECOVERY.md"),
      [
        "---",
        "plug_name: desktop-x11",
        "plug_type: desktop-automation",
        "attempts: 1",
        "outcome: fixed",
        "---",
        "",
        "# desktop-x11 recovery summary",
        "",
        "Fixed by restarting the X11 session.",
        "",
        "## Attempts",
        "",
        "| 1 | restart | restart X11 | pass |",
      ].join("\n"),
    );

    const result = formatCfrRecoverySection(runDir);

    expect(result).toContain("- Outcome: fixed");
    expect(result).toContain("- Plug: desktop-x11 (desktop-automation)");
    expect(result).toContain("- Summary: Fixed by restarting the X11 session.");
    // Must NOT contain the ## heading or table rows
    expect(result).not.toContain("## Attempts");
    expect(result).not.toContain("| 1 |");
  });

  it('outcome: "surrendered" with surrender_reason → correct summary injected', () => {
    writeFileSync(
      join(runDir, "CFR_RECOVERY.md"),
      [
        "---",
        "plug_name: browser-chrome",
        "plug_type: browser-control",
        "attempts: 3",
        "outcome: surrendered",
        "surrender_reason: iteration-3",
        "---",
        "",
        "# browser-chrome recovery summary",
        "",
        "Three fix attempts exhausted without resolving the browser startup failure.",
        "",
        "## Attempts",
        "",
        "| # | Hypothesis | Change | Result |",
      ].join("\n"),
    );

    const result = formatCfrRecoverySection(runDir);

    expect(result).toContain("- Outcome: surrendered");
    expect(result).toContain("- Attempts: 3");
    expect(result).toContain(
      "- Summary: Three fix attempts exhausted without resolving the browser startup failure.",
    );
  });

  it("absent CFR_RECOVERY.md → no capability recovery section", () => {
    // No file written — runDir is empty
    const result = formatCfrRecoverySection(runDir);
    expect(result).toBe("");
    expect(result).not.toContain("Capability recovery");
  });

  it("malformed YAML frontmatter → graceful handling (no crash, no section)", () => {
    writeFileSync(
      join(runDir, "CFR_RECOVERY.md"),
      [
        "---",
        ": invalid: yaml: [broken",
        "---",
        "",
        "body text",
      ].join("\n"),
    );

    // Must not throw
    let result: string | undefined;
    expect(() => {
      result = formatCfrRecoverySection(runDir);
    }).not.toThrow();

    // Should return empty (graceful skip)
    expect(result).toBe("");
  });

  it("file with no summary paragraph still produces header lines", () => {
    writeFileSync(
      join(runDir, "CFR_RECOVERY.md"),
      [
        "---",
        "plug_name: browser-chrome",
        "plug_type: browser-control",
        "attempts: 1",
        "outcome: fixed",
        "---",
        "",
        "## Attempts",
        "",
        "| 1 | env fix | set env | pass |",
      ].join("\n"),
    );

    const result = formatCfrRecoverySection(runDir);

    // Header is present even without a summary paragraph
    expect(result).toContain("Capability recovery during this job:");
    expect(result).toContain("- Plug: browser-chrome (browser-control)");
    expect(result).toContain("- Outcome: fixed");
    // No summary line (body first paragraph was the ## heading)
    expect(result).not.toContain("- Summary:");
  });
});

describe("runDebriefPrep — runDir integration (production call-site wiring)", () => {
  let runDir: string;

  beforeEach(() => {
    capturedPrompt = "";
    runDir = mkdtempSync(join(tmpdir(), "debrief-run-test-"));
  });

  afterEach(() => {
    rmSync(runDir, { recursive: true, force: true });
  });

  it("injects CFR recovery section into the model prompt when runDir contains CFR_RECOVERY.md", async () => {
    writeFileSync(
      join(runDir, "CFR_RECOVERY.md"),
      [
        "---",
        "plug_name: browser-chrome",
        "plug_type: browser-control",
        "attempts: 2",
        "outcome: fixed",
        "---",
        "",
        "# browser-chrome recovery summary",
        "",
        "Browser restarted successfully after setting DISPLAY=:0.",
      ].join("\n"),
    );

    await runDebriefPrep("some context", "sonnet", "", "", runDir);

    // The CFR section must be present in the prompt that reaches the model.
    expect(capturedPrompt).toContain("Capability recovery during this job:");
    expect(capturedPrompt).toContain("- Plug: browser-chrome (browser-control)");
    expect(capturedPrompt).toContain("- Outcome: fixed");
    expect(capturedPrompt).toContain("- Attempts: 2");
    expect(capturedPrompt).toContain(
      "Browser restarted successfully after setting DISPLAY=:0.",
    );
  });

  it("does not inject CFR section when runDir has no CFR_RECOVERY.md", async () => {
    // runDir exists but is empty — no CFR_RECOVERY.md
    await runDebriefPrep("some context", "sonnet", "", "", runDir);

    expect(capturedPrompt).not.toContain("Capability recovery during this job:");
  });

  it("does not inject CFR section when runDir is undefined", async () => {
    // Production call without runDir (e.g. inline call from debrief-reporter
    // using a synthetic jobId and no run directory).
    await runDebriefPrep("some context", "sonnet", "", "", undefined);

    expect(capturedPrompt).not.toContain("Capability recovery during this job:");
  });
});
