/**
 * Integration tests for the memory sync subsystem.
 *
 * Validates: MemoryDb + SyncService + SearchService wired through AppHarness.
 * Covers indexing, FTS recall, deletion tracking, and exclusion patterns.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { writeFileSync, mkdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { AppHarness } from "./app-harness.js";

let harness: AppHarness;

describe("Memory sync integration", () => {
  beforeAll(async () => {
    harness = await AppHarness.create({ withMemory: true });
  });

  afterAll(async () => {
    await harness.shutdown();
  });

  it("initializes memory subsystem", () => {
    expect(harness.memoryDb).toBeTruthy();
    expect(harness.syncService).toBeTruthy();
    expect(harness.searchService).toBeTruthy();
  });

  it("indexes a new notebook file on sync", async () => {
    const filePath = join(harness.agentDir, "notebook", "reference", "test-sync.md");
    writeFileSync(filePath, "# Sync Test\n\nThis file should be indexed.\n");

    const result = await harness.syncService!.fullSync();

    expect(result.added).toBeGreaterThanOrEqual(1);
  });

  it("finds indexed content via FTS search", async () => {
    const filePath = join(harness.agentDir, "notebook", "reference", "searchable.md");
    writeFileSync(
      filePath,
      "# Quantum Computing\n\nQuantum entanglement enables instantaneous correlation between particles.\n",
    );

    await harness.syncService!.fullSync();

    const result = await harness.searchService!.recall("quantum entanglement");

    expect(result.notebook.length).toBeGreaterThanOrEqual(1);

    const match = result.notebook.find((r) =>
      r.snippet.toLowerCase().includes("quantum"),
    );
    expect(match).toBeDefined();
  });

  it("removes deleted files from index on sync", async () => {
    const filePath = join(harness.agentDir, "notebook", "reference", "ephemeral.md");
    writeFileSync(filePath, "# Ephemeral\n\nThis content will be removed shortly.\n");

    await harness.syncService!.fullSync();

    // Verify it was indexed
    const before = await harness.searchService!.recall("ephemeral removed shortly");
    expect(
      before.notebook.some((r) => r.snippet.toLowerCase().includes("ephemeral")),
    ).toBe(true);

    // Delete the file and re-sync
    unlinkSync(filePath);
    const syncResult = await harness.syncService!.fullSync();

    expect(syncResult.removed).toBeGreaterThanOrEqual(1);

    // Verify it is gone from search results
    const after = await harness.searchService!.recall("ephemeral removed shortly");
    const stillPresent = after.notebook.some((r) =>
      r.filePath.includes("ephemeral.md"),
    );
    expect(stillPresent).toBe(false);
  });

  it("excludes knowledge/extracted/ from indexing", async () => {
    const extractedDir = join(
      harness.agentDir,
      "notebook",
      "knowledge",
      "extracted",
    );
    mkdirSync(extractedDir, { recursive: true });

    writeFileSync(
      join(extractedDir, "staging-data.md"),
      "# Staging Only\n\nBioluminescent jellyfish migration patterns in the Arctic.\n",
    );

    await harness.syncService!.fullSync();

    const result = await harness.searchService!.recall(
      "bioluminescent jellyfish migration",
    );

    const fromExcluded = [
      ...result.notebook,
      ...result.daily,
    ].some((r) => r.filePath.includes("extracted"));
    expect(fromExcluded).toBe(false);
  });
});
