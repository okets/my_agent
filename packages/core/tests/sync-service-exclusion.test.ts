import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SyncService } from "../src/memory/sync-service.js";

const mockDb = {
  getFile: vi.fn().mockReturnValue(null),
  deleteChunksForFile: vi.fn(),
  deleteFile: vi.fn(),
  insertChunk: vi.fn().mockReturnValue(1),
  upsertFile: vi.fn(),
  listFiles: vi.fn().mockReturnValue([]),
  setIndexMeta: vi.fn(),
  getCachedEmbedding: vi.fn().mockReturnValue(null),
  cacheEmbedding: vi.fn(),
  insertChunkVector: vi.fn(),
} as any;

let tmpDir: string;

describe("SyncService excludePatterns", () => {
  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "sync-excl-"));
    mkdirSync(join(tmpDir, "knowledge", "extracted"), { recursive: true });
    mkdirSync(join(tmpDir, "reference"), { recursive: true });

    writeFileSync(join(tmpDir, "reference", "user-info.md"), "Test user info");
    writeFileSync(join(tmpDir, "knowledge", "extracted", "staged.md"), "Staged fact");
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("fullSync excludes files matching excludePatterns", async () => {
    const service = new SyncService({
      notebookDir: tmpDir,
      db: mockDb,
      getPlugin: () => null,
      excludePatterns: ["knowledge/extracted/**"],
    });

    await service.fullSync();

    const upsertCalls = mockDb.upsertFile.mock.calls.map((c: any[]) => c[0].path);
    expect(upsertCalls).toContain("reference/user-info.md");
    expect(upsertCalls).not.toContain("knowledge/extracted/staged.md");
  });
});
