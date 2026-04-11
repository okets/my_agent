import { describe, it, expect, afterEach } from "vitest";
import { runValidation } from "../../../src/automations/todo-validators.js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

describe("deliverable_written validator", () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("fails when deliverable.md doesn't exist", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "val-test-"));
    const result = runValidation("deliverable_written", tmpDir);
    expect(result.pass).toBe(false);
    expect(result.message).toMatch(/not found/);
  });

  it("fails when deliverable.md is too short (<50 chars)", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "val-test-"));
    fs.writeFileSync(path.join(tmpDir, "deliverable.md"), "Too short");
    const result = runValidation("deliverable_written", tmpDir);
    expect(result.pass).toBe(false);
    expect(result.message).toMatch(/too short/);
  });

  it("passes when deliverable.md has sufficient content", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "val-test-"));
    fs.writeFileSync(
      path.join(tmpDir, "deliverable.md"),
      "This deliverable contains enough content to pass the fifty character minimum validation check.",
    );
    const result = runValidation("deliverable_written", tmpDir);
    expect(result.pass).toBe(true);
  });

  it("passes when deliverable.md has frontmatter + content (>50 chars total)", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "val-test-"));
    fs.writeFileSync(
      path.join(tmpDir, "deliverable.md"),
      "---\nstatus: complete\n---\nThe findings from this research task are documented below in detail.",
    );
    const result = runValidation("deliverable_written", tmpDir);
    expect(result.pass).toBe(true);
  });
});
