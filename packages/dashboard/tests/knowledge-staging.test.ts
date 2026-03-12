import { describe, it, expect, beforeEach, afterAll } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  existsSync,
  readFileSync,
  readdirSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

let tmpDir: string;

describe("knowledge-staging", () => {
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "staging-"));
  });

  afterAll(() => {
    if (tmpDir && existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("writeStagingFile creates file in knowledge/extracted/", async () => {
    const { writeStagingFile } = await import(
      "../src/conversations/knowledge-staging.js"
    );

    await writeStagingFile(tmpDir, "conv-abc123", "Thailand Planning", [
      { subcategory: "user-info", text: "Has two daughters" },
      { subcategory: "contact", text: "Kai -- tour guide" },
    ]);

    const extractedDir = join(tmpDir, "notebook", "knowledge", "extracted");
    expect(existsSync(extractedDir)).toBe(true);

    const files = readdirSync(extractedDir).filter((f) => f.endsWith(".md"));
    expect(files.length).toBe(1);

    const content = readFileSync(join(extractedDir, files[0]), "utf-8");
    expect(content).toContain("conv-abc123");
    expect(content).toContain("Has two daughters");
    expect(content).toContain("Kai");
    expect(content).toContain("attempts: 0");
  });

  it("readStagingFiles returns all pending staging files", async () => {
    const { writeStagingFile, readStagingFiles } = await import(
      "../src/conversations/knowledge-staging.js"
    );

    await writeStagingFile(tmpDir, "conv-1", "Conv 1", [
      { subcategory: "user-info", text: "Fact 1" },
    ]);
    await writeStagingFile(tmpDir, "conv-2", "Conv 2", [
      { subcategory: "contact", text: "Fact 2" },
    ]);

    const files = await readStagingFiles(tmpDir);
    expect(files.length).toBe(2);
  });

  it("incrementAttempts updates the counter", async () => {
    const { writeStagingFile, readStagingFiles, incrementAttempts } =
      await import("../src/conversations/knowledge-staging.js");

    await writeStagingFile(tmpDir, "conv-1", "Conv 1", [
      { subcategory: "user-info", text: "Fact 1" },
    ]);

    const files = await readStagingFiles(tmpDir);
    await incrementAttempts(files[0].filePath);

    const updated = await readStagingFiles(tmpDir);
    const fact = updated[0].facts.find((f) => f.text === "Fact 1");
    expect(fact?.attempts).toBe(1);
  });

  it("deleteStagingFile removes the file", async () => {
    const { writeStagingFile, deleteStagingFile } = await import(
      "../src/conversations/knowledge-staging.js"
    );

    await writeStagingFile(tmpDir, "conv-1", "Conv 1", [
      { subcategory: "user-info", text: "Fact 1" },
    ]);

    const extractedDir = join(tmpDir, "notebook", "knowledge", "extracted");
    const files = readdirSync(extractedDir);
    expect(files.length).toBe(1);

    await deleteStagingFile(join(extractedDir, files[0]));
    const remaining = readdirSync(extractedDir);
    expect(remaining.length).toBe(0);
  });
});
