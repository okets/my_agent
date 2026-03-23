import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  ensureDecisionsFile,
  readDecisions,
  appendDecision,
} from "../../src/spaces/decisions.js";

describe("DECISIONS.md utilities", () => {
  let spaceDir: string;

  beforeEach(() => {
    spaceDir = mkdtempSync(join(tmpdir(), "decisions-test-"));
  });

  it("ensureDecisionsFile creates template when file does not exist", () => {
    const filePath = ensureDecisionsFile(spaceDir);
    expect(filePath).toBe(join(spaceDir, "DECISIONS.md"));

    const content = readDecisions(spaceDir);
    expect(content).toContain("# Decisions");
    expect(content).toContain(
      "Operational history for this tool",
    );
  });

  it("ensureDecisionsFile does not overwrite existing file", () => {
    ensureDecisionsFile(spaceDir);
    appendDecision(spaceDir, {
      category: "created",
      summary: "Initial creation",
    });

    // Call again — should NOT reset content
    ensureDecisionsFile(spaceDir);
    const content = readDecisions(spaceDir);
    expect(content).toContain("Initial creation");
  });

  it("readDecisions returns empty string when file does not exist", () => {
    const content = readDecisions(spaceDir);
    expect(content).toBe("");
  });

  it("appendDecision creates file if missing and appends entry", () => {
    appendDecision(spaceDir, {
      category: "created",
      summary: "Tool created for web scraping",
    });

    const content = readDecisions(spaceDir);
    expect(content).toContain("# Decisions");
    expect(content).toContain("-- created");
    expect(content).toContain("Tool created for web scraping");
  });

  it("appendDecision appends entries chronologically", () => {
    appendDecision(spaceDir, {
      category: "created",
      summary: "Initial creation",
    });
    appendDecision(spaceDir, {
      category: "modified",
      summary: "Added retry logic",
    });
    appendDecision(spaceDir, {
      category: "failed",
      summary: "Timeout on large pages",
    });

    const content = readDecisions(spaceDir);
    const createdIdx = content.indexOf("-- created");
    const modifiedIdx = content.indexOf("-- modified");
    const failedIdx = content.indexOf("-- failed");

    expect(createdIdx).toBeLessThan(modifiedIdx);
    expect(modifiedIdx).toBeLessThan(failedIdx);
  });

  it("appendDecision includes ISO timestamp", () => {
    appendDecision(spaceDir, {
      category: "repaired",
      summary: "Fixed timeout issue",
    });

    const content = readDecisions(spaceDir);
    // ISO timestamp pattern: 2026-03-23T...
    expect(content).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });
});
