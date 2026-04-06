import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { runValidation } from "../todo-validators.js";

describe("todo-validators", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "validator-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("capability_frontmatter passes with valid CAPABILITY.md", () => {
    fs.writeFileSync(
      path.join(tmpDir, "CAPABILITY.md"),
      [
        "---",
        "name: Test Capability",
        "provides: audio-to-text",
        "interface: script",
        "---",
        "Instructions here.",
      ].join("\n"),
    );
    const result = runValidation("capability_frontmatter", tmpDir);
    expect(result.pass).toBe(true);
  });

  it("capability_frontmatter fails when name is missing", () => {
    fs.writeFileSync(
      path.join(tmpDir, "CAPABILITY.md"),
      ["---", "provides: audio-to-text", "---"].join("\n"),
    );
    const result = runValidation("capability_frontmatter", tmpDir);
    expect(result.pass).toBe(false);
    expect(result.message).toContain("name");
  });

  it("capability_frontmatter fails when file is missing", () => {
    const result = runValidation("capability_frontmatter", tmpDir);
    expect(result.pass).toBe(false);
    expect(result.message).toContain("CAPABILITY.md");
  });

  it("completion_report passes with valid deliverable", () => {
    fs.writeFileSync(
      path.join(tmpDir, "deliverable.md"),
      [
        "---",
        "change_type: configure",
        "provider: Deepgram Nova-2",
        "test_result: PASSED",
        "---",
        "Report content.",
      ].join("\n"),
    );
    const result = runValidation("completion_report", tmpDir);
    expect(result.pass).toBe(true);
  });

  it("completion_report fails with change_type unknown", () => {
    fs.writeFileSync(
      path.join(tmpDir, "deliverable.md"),
      ["---", "change_type: unknown", "---"].join("\n"),
    );
    const result = runValidation("completion_report", tmpDir);
    expect(result.pass).toBe(false);
    expect(result.message).toContain("change_type");
  });

  it("test_executed passes with test_result in frontmatter", () => {
    fs.writeFileSync(
      path.join(tmpDir, "deliverable.md"),
      ["---", "test_result: PASSED", "---", "Test passed."].join("\n"),
    );
    const result = runValidation("test_executed", tmpDir);
    expect(result.pass).toBe(true);
  });

  it("test_executed fails without test_result", () => {
    fs.writeFileSync(
      path.join(tmpDir, "deliverable.md"),
      ["---", "change_type: fix", "---"].join("\n"),
    );
    const result = runValidation("test_executed", tmpDir);
    expect(result.pass).toBe(false);
  });

  it("change_type_set passes with valid change_type", () => {
    fs.writeFileSync(
      path.join(tmpDir, "deliverable.md"),
      ["---", "change_type: upgrade", "---"].join("\n"),
    );
    const result = runValidation("change_type_set", tmpDir);
    expect(result.pass).toBe(true);
  });

  it("change_type_set fails with unknown", () => {
    fs.writeFileSync(
      path.join(tmpDir, "deliverable.md"),
      ["---", "change_type: unknown", "---"].join("\n"),
    );
    const result = runValidation("change_type_set", tmpDir);
    expect(result.pass).toBe(false);
  });

  it("unknown validator returns pass (graceful)", () => {
    const result = runValidation("nonexistent_rule", tmpDir);
    expect(result.pass).toBe(true);
  });

  it("capability_frontmatter uses targetDir when provided", () => {
    // CAPABILITY.md is NOT in runDir (the job dir)
    // but IS in targetDir (the capability folder)
    const targetDir = path.join(tmpDir, "target-cap");
    fs.mkdirSync(targetDir, { recursive: true });
    fs.writeFileSync(
      path.join(targetDir, "CAPABILITY.md"),
      [
        "---",
        "name: Target Cap",
        "provides: audio-to-text",
        "interface: script",
        "---",
        "Instructions.",
      ].join("\n"),
    );

    // runDir has no CAPABILITY.md — but targetDir does
    const result = runValidation("capability_frontmatter", tmpDir, targetDir);
    expect(result.pass).toBe(true);
  });

  it("capability_frontmatter fails when targetDir has no CAPABILITY.md", () => {
    const targetDir = path.join(tmpDir, "empty-target");
    fs.mkdirSync(targetDir, { recursive: true });

    const result = runValidation("capability_frontmatter", tmpDir, targetDir);
    expect(result.pass).toBe(false);
  });

  it("completion_report uses runDir even when targetDir is provided", () => {
    // deliverable.md should be in runDir, not targetDir
    const targetDir = path.join(tmpDir, "target-cap");
    fs.mkdirSync(targetDir, { recursive: true });

    fs.writeFileSync(
      path.join(tmpDir, "deliverable.md"),
      ["---", "change_type: fix", "---", "Fixed."].join("\n"),
    );

    const result = runValidation("completion_report", tmpDir, targetDir);
    expect(result.pass).toBe(true);
  });
});
