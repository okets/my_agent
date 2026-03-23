import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, utimes } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  ensureStagingDir,
  stagingPath,
  cleanStaging,
} from "../../src/automations/media-staging.js";

describe("Media Staging", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "media-staging-test-"));
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  describe("ensureStagingDir", () => {
    it("creates staging directory", async () => {
      const dir = await ensureStagingDir(testDir);
      expect(dir).toBe(join(testDir, "staging"));
      expect(existsSync(dir)).toBe(true);
    });

    it("is idempotent", async () => {
      await ensureStagingDir(testDir);
      const dir = await ensureStagingDir(testDir);
      expect(existsSync(dir)).toBe(true);
    });
  });

  describe("stagingPath", () => {
    it("returns a unique path with correct extension", () => {
      const p = stagingPath(testDir, "invoice.pdf");
      expect(p).toContain(join(testDir, "staging"));
      expect(p).toMatch(/\.pdf$/);
    });

    it("uses .bin for files without extension", () => {
      const p = stagingPath(testDir, "noext");
      expect(p).toMatch(/\.bin$/);
    });

    it("generates unique paths for same filename", () => {
      const p1 = stagingPath(testDir, "doc.pdf");
      const p2 = stagingPath(testDir, "doc.pdf");
      expect(p1).not.toBe(p2);
    });
  });

  describe("cleanStaging", () => {
    it("removes files older than maxAge", async () => {
      const dir = await ensureStagingDir(testDir);
      const oldFile = join(dir, "old.pdf");
      await writeFile(oldFile, "old content");

      // Set mtime to 2 days ago
      const twoDaysAgo = new Date(Date.now() - 2 * 86_400_000);
      await utimes(oldFile, twoDaysAgo, twoDaysAgo);

      const cleaned = await cleanStaging(testDir);
      expect(cleaned).toBe(1);
      expect(existsSync(oldFile)).toBe(false);
    });

    it("preserves recent files", async () => {
      const dir = await ensureStagingDir(testDir);
      const recentFile = join(dir, "recent.pdf");
      await writeFile(recentFile, "recent content");

      const cleaned = await cleanStaging(testDir);
      expect(cleaned).toBe(0);
      expect(existsSync(recentFile)).toBe(true);
    });

    it("returns 0 when staging dir does not exist", async () => {
      const cleaned = await cleanStaging(join(testDir, "nonexistent"));
      expect(cleaned).toBe(0);
    });
  });
});
