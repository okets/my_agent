/**
 * M9.3-S3: Delegation Progress Bar — Structural Verification
 *
 * Verifies the progress bar template exists in both desktop and mobile
 * chat sections of index.html. Checks for correct design tokens and
 * required elements.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const indexHtml = readFileSync(
  join(__dirname, "../../../public/index.html"),
  "utf-8",
);

describe("Delegation progress bar — template structure", () => {
  // Find all progress bar template blocks
  const progressBarBlocks = indexHtml
    .split("\n")
    .map((line, i) => ({ line, num: i + 1 }))
    .filter((l) => l.line.includes("msg.delegationProgress"));

  it("progress bar template exists in the HTML", () => {
    expect(progressBarBlocks.length).toBeGreaterThan(0);
  });

  it("appears in both desktop and mobile sections", () => {
    // Desktop is roughly in the first half, mobile in the second half
    // The two x-if="msg.delegationProgress" templates should be at different locations
    const templateLines = progressBarBlocks
      .filter((l) => l.line.includes("x-if"))
      .map((l) => l.num);

    expect(
      templateLines.length,
      "Expected 2 x-if templates (desktop + mobile)",
    ).toBeGreaterThanOrEqual(2);

    // They should be at least 1000 lines apart (desktop vs mobile sections)
    if (templateLines.length >= 2) {
      const gap = templateLines[templateLines.length - 1] - templateLines[0];
      expect(
        gap,
        "Desktop and mobile templates should be in separate sections",
      ).toBeGreaterThan(1000);
    }
  });

  it("uses correct Tokyo Night design tokens", () => {
    // accent-blue fill
    expect(indexHtml).toContain("background:#7aa2f7");
    // panel background
    expect(indexHtml).toContain("background:#292e42");
    // muted text color
    expect(indexHtml).toContain("color:#565f89");
  });

  it("has 4px height and rounded corners", () => {
    expect(indexHtml).toContain("height:4px");
    expect(indexHtml).toContain("border-radius:9999px");
  });

  it("has smooth width transition", () => {
    expect(indexHtml).toContain("transition:width 0.3s ease");
  });

  it("has fade-out transition for completion", () => {
    expect(indexHtml).toContain("transition:opacity");
  });

  it("shows done/total text with current task", () => {
    // The text template includes done/total and current task
    expect(indexHtml).toContain("delegationProgress.done");
    expect(indexHtml).toContain("delegationProgress.total");
    expect(indexHtml).toContain("delegationProgress.current");
  });

  it("shows 'Done' text on completion (fading state)", () => {
    expect(indexHtml).toContain("delegationProgress.fading");
    // When fading, text shows "Done"
    expect(indexHtml).toContain("? 'Done'");
  });

  it("has text truncation for mobile", () => {
    expect(indexHtml).toContain("truncate");
  });
});

describe("Delegation progress sync — app.js structure", () => {
  const appJs = readFileSync(
    join(__dirname, "../../../public/js/app.js"),
    "utf-8",
  );

  it("has _syncDelegationProgress method", () => {
    expect(appJs).toContain("_syncDelegationProgress");
  });

  it("extracts automation ID from delegation message", () => {
    expect(appJs).toContain("delegationAutomationId");
    expect(appJs).toContain("created and fired");
  });

  it("cross-references automations store for once:true check", () => {
    // Should check automation.once, not hardcode
    expect(appJs).toContain("automation?.once");
  });

  it("has 2-second fade-out timeout on completion", () => {
    expect(appJs).toContain("2000");
    expect(appJs).toContain("delegationProgress = null");
  });
});
