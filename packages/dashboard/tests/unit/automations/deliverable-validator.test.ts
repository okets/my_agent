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
      "Let me start by checking my todo list. The sensor reading today is 145 (above threshold).\n\n## Report\nMeasurement: 52 units",
    );
    const result = runValidation("deliverable_written", tmpDir);
    expect(result.pass).toBe(false);
    expect(result.message).toMatch(/narration|stream-of-consciousness|Write tool/i);
  });

  it("doubled-signal — rejects 'I'll help you condense' Haiku-style opener", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "val-test-"));
    fs.writeFileSync(
      path.join(tmpDir, "deliverable.md"),
      "I'll help you condense this content to fit within 10,000 characters.\n\n## Status\n**Reading: 151**\nMeasurement: 60",
    );
    const result = runValidation("deliverable_written", tmpDir);
    expect(result.pass).toBe(false);
    expect(result.message).toMatch(/narration|condense/i);
  });

  it("doubled-signal — rejects two narration markers in head", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "val-test-"));
    fs.writeFileSync(
      path.join(tmpDir, "deliverable.md"),
      "I'll check the source. Now let me look at the sensors.\n\n## Report\n**Reading: 151**\nMeasurement: 60 units",
    );
    const result = runValidation("deliverable_written", tmpDir);
    expect(result.pass).toBe(false);
    expect(result.message).toMatch(/narration|markers/i);
  });

  it("doubled-signal — accepts opening with single weak match if no second narration follows", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "val-test-"));
    fs.writeFileSync(
      path.join(tmpDir, "deliverable.md"),
      "I need to flag — sensors at the North-East station were offline today and the report is partial.\n\n## Report\n**Reading: estimated 145 (above threshold)**\nMeasurement: ~52 units",
    );
    const result = runValidation("deliverable_written", tmpDir);
    expect(result.pass).toBe(true);
  });

  it("doubled-signal — accepts a clean opening (no narration markers at all)", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "val-test-"));
    fs.writeFileSync(
      path.join(tmpDir, "deliverable.md"),
      "## Sensor Report — Region X, 2026-04-27\n\n**Reading: 145 (above threshold)**\nMeasurement: 52 units",
    );
    const result = runValidation("deliverable_written", tmpDir);
    expect(result.pass).toBe(true);
  });

  // ─── M9.4-S4.2-fu1 — Day-1 soak failure verbs ─────────────────────────────

  it("doubled-signal — rejects 'I'll start executing' (Day-1 soak failure verb)", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "val-test-"));
    fs.writeFileSync(
      path.join(tmpDir, "deliverable.md"),
      "I'll start executing the daily session automation by first checking my todo list. I need to load more tools.\n\n## Report\n**Reading: 145**",
    );
    const result = runValidation("deliverable_written", tmpDir);
    expect(result.pass).toBe(false);
    expect(result.message).toMatch(/narration|stream-of-consciousness|Write tool/i);
  });

  it("doubled-signal — rejects 'Let me get' / 'Let me find' / 'Let me search' / 'Let me create' / 'Let me locate'", () => {
    for (const opener of [
      "Let me get the necessary tools to research the current status.",
      "Let me find the relevant files for today's session.",
      "Let me search for the most recent automation run output.",
      "Let me create a deliverable for today's session.",
      "Let me locate the project knowledge space.",
    ]) {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "val-test-"));
      fs.writeFileSync(
        path.join(tmpDir, "deliverable.md"),
        `${opener} Now let me check the latest data.\n\n## Report\n**Body**`,
      );
      const result = runValidation("deliverable_written", tmpDir);
      expect(result.pass, opener).toBe(false);
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("doubled-signal — rejects 'Now I need to' (weak repeat marker)", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "val-test-"));
    fs.writeFileSync(
      path.join(tmpDir, "deliverable.md"),
      "Now I need to load more tools. Now I need to fetch the latest data.\n\n## Report\n**Reading: 145**",
    );
    const result = runValidation("deliverable_written", tmpDir);
    expect(result.pass).toBe(false);
  });

  it("doubled-signal — still accepts 'I need to flag' single weak match (FP guard)", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "val-test-"));
    fs.writeFileSync(
      path.join(tmpDir, "deliverable.md"),
      "I need to flag — sensors at North-East station were offline today.\n\n## Report\n**Reading: estimated 145**\nMeasurement: ~52 units",
    );
    const result = runValidation("deliverable_written", tmpDir);
    expect(result.pass).toBe(true);
  });
});
