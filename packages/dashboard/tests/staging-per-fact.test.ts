import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  findStagedFact,
  incrementFactAttempts,
  incrementAllAttempts,
  deleteStagedFact,
  cleanExpiredFacts,
  readStagingFiles,
} from "../src/conversations/knowledge-staging.js";

describe("per-fact staging operations", () => {
  const tmpDir = join(import.meta.dirname, ".tmp-staging-test");
  const stagingDir = join(tmpDir, "notebook", "knowledge", "extracted");

  beforeEach(() => {
    mkdirSync(stagingDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeStagingFixture(filename: string): string {
    const filePath = join(stagingDir, filename);
    writeFileSync(filePath, [
      "# Extracted: 2026-03-12T14:30:00Z",
      '# Source: conv-abc ("Trip Planning")',
      "",
      "## Pending -- Propose in Morning Brief",
      "- [user-info, attempts: 0] Has two daughters, Noa (5) and Maya (3)",
      "- [contact, attempts: 1] Kai — tour guide in Chiang Mai",
      "- [preference:personal, attempts: 2] Loves pad krapao, prefers spicy",
    ].join("\n"));
    return filePath;
  }

  describe("findStagedFact", () => {
    it("should find a fact by text substring", async () => {
      const files = await readStagingFiles(tmpDir);
      // Need a fixture first
      writeStagingFixture("conv-abc-123.md");
      const files2 = await readStagingFiles(tmpDir);
      const idx = findStagedFact(files2[0].facts, "Has two daughters");
      expect(idx).toBe(0);
    });

    it("should return -1 for non-matching text", async () => {
      writeStagingFixture("conv-abc-123.md");
      const files = await readStagingFiles(tmpDir);
      const idx = findStagedFact(files[0].facts, "nonexistent fact");
      expect(idx).toBe(-1);
    });
  });

  describe("incrementFactAttempts", () => {
    it("should increment a specific fact's attempts", async () => {
      const filePath = writeStagingFixture("conv-abc-123.md");
      const newCount = await incrementFactAttempts(filePath, "Kai — tour guide");
      expect(newCount).toBe(2);
      // Verify other facts unchanged
      const files = await readStagingFiles(tmpDir);
      expect(files[0].facts[0].attempts).toBe(0); // unchanged
      expect(files[0].facts[1].attempts).toBe(2); // incremented
      expect(files[0].facts[2].attempts).toBe(2); // unchanged
    });
  });

  describe("incrementAllAttempts", () => {
    it("should increment all facts in a file", async () => {
      const filePath = writeStagingFixture("conv-abc-123.md");
      await incrementAllAttempts(filePath);
      const files = await readStagingFiles(tmpDir);
      expect(files[0].facts[0].attempts).toBe(1);
      expect(files[0].facts[1].attempts).toBe(2);
      expect(files[0].facts[2].attempts).toBe(3);
    });
  });

  describe("deleteStagedFact", () => {
    it("should delete a specific fact by text", async () => {
      const filePath = writeStagingFixture("conv-abc-123.md");
      await deleteStagedFact(filePath, "Kai — tour guide");
      const files = await readStagingFiles(tmpDir);
      expect(files[0].facts).toHaveLength(2);
      expect(files[0].facts[0].text).toContain("Has two daughters");
      expect(files[0].facts[1].text).toContain("Loves pad krapao");
    });

    it("should delete staging file when last fact is removed", async () => {
      const filePath = writeStagingFixture("conv-single.md");
      // Rewrite with single fact
      writeFileSync(filePath, [
        "# Extracted: 2026-03-12T14:30:00Z",
        '# Source: conv-abc ("Trip Planning")',
        "",
        "## Pending -- Propose in Morning Brief",
        "- [user-info, attempts: 0] Only fact here",
      ].join("\n"));
      await deleteStagedFact(filePath, "Only fact here");
      const files = await readStagingFiles(tmpDir);
      expect(files).toHaveLength(0);
    });
  });

  describe("cleanExpiredFacts", () => {
    it("should delete facts with attempts >= maxAttempts", async () => {
      writeStagingFixture("conv-abc-123.md");
      // fact[2] has attempts: 2, so with maxAttempts=3 it stays
      const deleted = await cleanExpiredFacts(tmpDir, 3);
      expect(deleted).toBe(0);

      // Now set maxAttempts=2
      const deleted2 = await cleanExpiredFacts(tmpDir, 2);
      expect(deleted2).toBe(1); // the pad krapao fact (attempts: 2)
    });
  });
});
