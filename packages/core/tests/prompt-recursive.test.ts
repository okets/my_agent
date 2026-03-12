import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

let tmpDir: string;
let brainDir: string;

describe("loadNotebookReference recursive", () => {
  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "prompt-recursive-"));
    brainDir = join(tmpDir, "brain");
    mkdirSync(brainDir, { recursive: true });
    writeFileSync(join(brainDir, "CLAUDE.md"), "You are a test agent.");

    const refDir = join(tmpDir, "notebook", "reference");
    mkdirSync(join(refDir, "preferences"), { recursive: true });

    writeFileSync(join(refDir, "user-info.md"), "Has two daughters.");
    writeFileSync(join(refDir, "preferences", "personal.md"), "Loves pad krapao.");
    writeFileSync(join(refDir, "preferences", "work.md"), "Uses TypeScript.");
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("includes files from subdirectories", async () => {
    const { assembleSystemPrompt } = await import("../src/prompt.js");
    const prompt = await assembleSystemPrompt(brainDir);

    expect(prompt).toContain("Has two daughters.");
    expect(prompt).toContain("Loves pad krapao.");
    expect(prompt).toContain("Uses TypeScript.");
  });

  it("orders files deterministically by relative path", async () => {
    const { assembleSystemPrompt } = await import("../src/prompt.js");
    const prompt = await assembleSystemPrompt(brainDir);

    const personalIdx = prompt.indexOf("Loves pad krapao.");
    const workIdx = prompt.indexOf("Uses TypeScript.");
    const userIdx = prompt.indexOf("Has two daughters.");

    expect(personalIdx).toBeLessThan(workIdx);
    expect(workIdx).toBeLessThan(userIdx);
  });
});
