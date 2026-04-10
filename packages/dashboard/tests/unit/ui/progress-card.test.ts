/**
 * M9.4-S3: Progress Card — Structural Verification
 *
 * Verifies progress card templates exist in both desktop and mobile
 * sections of index.html, and that progress-card.js has required methods.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const indexHtml = readFileSync(
  join(__dirname, "../../../public/index.html"),
  "utf-8",
);

const progressCardJs = readFileSync(
  join(__dirname, "../../../public/js/progress-card.js"),
  "utf-8",
);

describe("Progress card — template structure", () => {
  const cardBlocks = indexHtml
    .split("\n")
    .map((line, i) => ({ line, num: i + 1 }))
    .filter((l) => l.line.includes("progressCard()"));

  it("progress card template exists in the HTML", () => {
    expect(cardBlocks.length).toBeGreaterThan(0);
  });

  it("appears in both desktop and mobile sections", () => {
    const xDataLines = cardBlocks.map((l) => l.num);
    expect(xDataLines.length, "Expected 2 x-data templates (desktop + mobile)").toBeGreaterThanOrEqual(2);

    if (xDataLines.length >= 2) {
      const gap = xDataLines[xDataLines.length - 1] - xDataLines[0];
      expect(gap, "Desktop and mobile should be in separate sections").toBeGreaterThan(1000);
    }
  });

  it("uses glass-strong styling", () => {
    const glassLines = indexHtml.split("\n").filter(l => l.includes("glass-strong") && l.includes("rounded-lg"));
    expect(glassLines.length).toBeGreaterThanOrEqual(2);
  });

  it("has collapsed and expanded views", () => {
    expect(indexHtml).toContain('x-show="!isExpanded(job.id)"');
    expect(indexHtml).toContain('x-show="isExpanded(job.id)"');
  });

  it("collapsed view shows current step text", () => {
    expect(indexHtml).toContain("currentStepText(job)");
  });

  it("has dismiss button", () => {
    expect(indexHtml).toContain("dismiss(job.id)");
  });

  it("has scrollable step list", () => {
    expect(indexHtml).toContain("max-h-[6.5rem]");
    expect(indexHtml).toContain("overflow-y-auto");
  });

  it("uses correct status colors from design spec", () => {
    expect(progressCardJs).toContain("text-green-400/60");
    expect(progressCardJs).toContain("text-blue-400");
    expect(progressCardJs).toContain("text-orange-400/60");
    expect(progressCardJs).toContain("text-gray-500");
  });

  it("uses correct status icons", () => {
    expect(progressCardJs).toContain("\\u2713");   // ✓
    expect(progressCardJs).toContain("\\u21bb");   // ↻
    expect(progressCardJs).toContain("\\u2298");   // ⊘
    expect(progressCardJs).toContain("\\u25cb");   // ○
  });

  it("old delegation progress bar is removed", () => {
    expect(indexHtml).not.toContain("msg.delegationProgress");
    expect(indexHtml).not.toContain("delegationProgress.fading");
  });
});

describe("Progress card — component structure", () => {
  it("has required methods", () => {
    expect(progressCardJs).toContain("toggle(");
    expect(progressCardJs).toContain("dismiss(");
    expect(progressCardJs).toContain("statusIcon(");
    expect(progressCardJs).toContain("statusClass(");
    expect(progressCardJs).toContain("currentStepText(");
    expect(progressCardJs).toContain("isDone(");
    expect(progressCardJs).toContain("handleJobCompleted(");
  });

  it("has two-phase completion: 'done' then 'fading'", () => {
    expect(progressCardJs).toContain('"done"');
    expect(progressCardJs).toContain('"fading"');
    expect(progressCardJs).toContain("1500");
    expect(progressCardJs).toContain("2000");
  });

  it("has init method with $watch", () => {
    expect(progressCardJs).toContain("init()");
    expect(progressCardJs).toContain("$watch");
  });
});
