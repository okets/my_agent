import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { handleManageStagedKnowledge } from "../src/mcp/manage-staged-knowledge.js";

describe("manage_staged_knowledge handler", () => {
  const tmpDir = join(import.meta.dirname, ".tmp-mcp-test");
  const stagingDir = join(tmpDir, "notebook", "knowledge", "extracted");
  const referenceDir = join(tmpDir, "notebook", "reference");

  beforeEach(() => {
    mkdirSync(stagingDir, { recursive: true });
    mkdirSync(join(referenceDir, "preferences"), { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeStagingFixture(): string {
    const filePath = join(stagingDir, "conv-abc-123.md");
    writeFileSync(filePath, [
      "# Extracted: 2026-03-12T14:30:00Z",
      '# Source: conv-abc ("Trip Planning")',
      "",
      "## Pending -- Propose in Morning Brief",
      "- [user-info, attempts: 0] Has two daughters, Noa (5) and Maya (3)",
      "- [contact, attempts: 1] Kai — tour guide in Chiang Mai",
    ].join("\n"));
    return filePath;
  }

  it("should approve a fact and write to correct reference file", async () => {
    const filePath = writeStagingFixture();
    const result = await handleManageStagedKnowledge({
      action: "approve",
      stagingFile: filePath,
      factText: "Has two daughters",
      agentDir: tmpDir,
    });
    expect(result.approved).toBe(true);
    expect(result.destination).toContain("user-info.md");
    // Fact should be in reference file
    const userInfo = readFileSync(join(referenceDir, "user-info.md"), "utf-8");
    expect(userInfo).toContain("Has two daughters");
    // Fact should be removed from staging
    const staging = readFileSync(filePath, "utf-8");
    expect(staging).not.toContain("Has two daughters");
    expect(staging).toContain("Kai"); // other fact remains
  });

  it("should approve with enrichment", async () => {
    const filePath = writeStagingFixture();
    const result = await handleManageStagedKnowledge({
      action: "approve",
      stagingFile: filePath,
      factText: "Has two daughters",
      enrichment: "Noa born 2021-01-15, Maya born 2023-06-22",
      agentDir: tmpDir,
    });
    expect(result.approved).toBe(true);
    const userInfo = readFileSync(join(referenceDir, "user-info.md"), "utf-8");
    expect(userInfo).toContain("Noa born 2021-01-15");
  });

  it("should reject a fact and remove from staging", async () => {
    const filePath = writeStagingFixture();
    const result = await handleManageStagedKnowledge({
      action: "reject",
      stagingFile: filePath,
      factText: "Has two daughters",
      agentDir: tmpDir,
    });
    expect(result.rejected).toBe(true);
    const staging = readFileSync(filePath, "utf-8");
    expect(staging).not.toContain("Has two daughters");
  });

  it("should skip a fact and increment attempts", async () => {
    const filePath = writeStagingFixture();
    const result = await handleManageStagedKnowledge({
      action: "skip",
      stagingFile: filePath,
      factText: "Kai — tour guide",
      agentDir: tmpDir,
    });
    expect(result.skipped).toBe(true);
    expect(result.attempts).toBe(2); // was 1, now 2
  });

  it("should delete staging file when last fact is approved", async () => {
    const filePath = writeStagingFixture();
    await handleManageStagedKnowledge({ action: "approve", stagingFile: filePath, factText: "Has two daughters", agentDir: tmpDir });
    await handleManageStagedKnowledge({ action: "approve", stagingFile: filePath, factText: "Kai — tour guide", agentDir: tmpDir });
    expect(existsSync(filePath)).toBe(false);
  });

  it("should route contact subcategory to contacts.md", async () => {
    const filePath = writeStagingFixture();
    const result = await handleManageStagedKnowledge({
      action: "approve",
      stagingFile: filePath,
      factText: "Kai — tour guide",
      agentDir: tmpDir,
    });
    expect(result.destination).toContain("contacts.md");
    const contacts = readFileSync(join(referenceDir, "contacts.md"), "utf-8");
    expect(contacts).toContain("Kai");
  });

  it("should error on non-existent fact", async () => {
    const filePath = writeStagingFixture();
    await expect(handleManageStagedKnowledge({
      action: "approve",
      stagingFile: filePath,
      factText: "nonexistent",
      agentDir: tmpDir,
    })).rejects.toThrow();
  });
});
