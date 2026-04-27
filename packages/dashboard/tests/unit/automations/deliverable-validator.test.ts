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

  it("fails when frontmatter is long but body is trivial", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "val-test-"));
    fs.writeFileSync(
      path.join(tmpDir, "deliverable.md"),
      "---\nchange_type: configure\ntest_result: pass\nsummary: Updated the configuration settings for the deployment\nstatus: complete\n---\nDone.",
    );
    const result = runValidation("deliverable_written", tmpDir);
    expect(result.pass).toBe(false);
    expect(result.message).toMatch(/too short/);
  });

  // ─── M9.4-S4.2 Task 5 — doubled-signal narration heuristic ────────────────

  it("doubled-signal — rejects strong opener 'Let me start by checking my todo list'", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "val-test-"));
    fs.writeFileSync(
      path.join(tmpDir, "deliverable.md"),
      "Let me start by checking my todo list. The AQI today is 145 (Unhealthy for Sensitive Groups).\n\n## Report\nPM2.5: 52 µg/m³",
    );
    const result = runValidation("deliverable_written", tmpDir);
    expect(result.pass).toBe(false);
    expect(result.message).toMatch(/narration|stream-of-consciousness|Write tool/i);
  });

  it("doubled-signal — rejects 'I'll help you condense' Haiku-style opener", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "val-test-"));
    fs.writeFileSync(
      path.join(tmpDir, "deliverable.md"),
      "I'll help you condense this content to fit within 10,000 characters.\n\n## AQI\n**AQI: 151**\nPM2.5: 60",
    );
    const result = runValidation("deliverable_written", tmpDir);
    expect(result.pass).toBe(false);
    expect(result.message).toMatch(/narration|condense/i);
  });

  it("doubled-signal — rejects two narration markers in head", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "val-test-"));
    fs.writeFileSync(
      path.join(tmpDir, "deliverable.md"),
      "I'll check the news. Now let me look at the AQI sensors.\n\n## Report\n**AQI: 151**\nPM2.5: 60 µg/m³",
    );
    const result = runValidation("deliverable_written", tmpDir);
    expect(result.pass).toBe(false);
    expect(result.message).toMatch(/narration|markers/i);
  });

  it("doubled-signal — accepts opening with single weak match if no second narration follows", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "val-test-"));
    fs.writeFileSync(
      path.join(tmpDir, "deliverable.md"),
      "I need to flag — AQI sensors at the North-East station were offline today and the report is partial.\n\n## Report\n**AQI: estimated 145 (Unhealthy for Sensitive Groups)**\nPM2.5: ~52 µg/m³",
    );
    const result = runValidation("deliverable_written", tmpDir);
    expect(result.pass).toBe(true);
  });

  it("doubled-signal — accepts a clean opening (no narration markers at all)", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "val-test-"));
    fs.writeFileSync(
      path.join(tmpDir, "deliverable.md"),
      "## AQI Report — Chiang Mai, 2026-04-27\n\n**AQI: 145 (Unhealthy for Sensitive Groups)**\nPM2.5: 52 µg/m³",
    );
    const result = runValidation("deliverable_written", tmpDir);
    expect(result.pass).toBe(true);
  });
});
