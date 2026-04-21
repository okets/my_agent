/**
 * skills-sync.test.ts — M9.6-S21 BUG-4.
 *
 * Unit test for `syncFrameworkSkills`. Uses a tmp source dir (stand-in for
 * `packages/core/skills/`) and a tmp agent dir (stand-in for the instance's
 * `<agentDir>/.claude/skills/` tree). Exercises the three contract points:
 *
 *   1. Missing target file → created.
 *   2. Source hash matches target hash → no rewrite, `unchanged` bumped.
 *   3. Source changes → target rewritten, `synced` bumped.
 *
 * Also exercises the sync variant used by the boot path in `App.create()`.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  syncFrameworkSkills,
  syncFrameworkSkillsSync,
} from "../../src/skills/sync.js";

describe("syncFrameworkSkills (BUG-4)", () => {
  let root: string;
  let sourceDir: string;
  let agentDir: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "m9.6-s21-skills-sync-"));
    sourceDir = join(root, "src-skills");
    agentDir = join(root, "agent");
    mkdirSync(sourceDir, { recursive: true });
    mkdirSync(agentDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function writeSkill(rel: string, content: string): void {
    const full = join(sourceDir, rel);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, content);
  }

  function readInstance(rel: string): string {
    return readFileSync(join(agentDir, ".claude", "skills", rel), "utf8");
  }

  it("creates missing files and propagates byte-for-byte content", async () => {
    writeSkill(
      "capability-brainstorming/SKILL.md",
      "---\nname: capability-brainstorming\n---\n\nTerse deliverable contract.\n",
    );
    writeSkill(
      "capability-brainstorming/references/example.md",
      "# Example\n",
    );

    const res = await syncFrameworkSkills({ sourceDir, agentDir });
    expect(res.synced).toBe(2);
    expect(res.unchanged).toBe(0);
    expect(res.syncedPaths.sort()).toEqual(
      [
        "capability-brainstorming/SKILL.md",
        join("capability-brainstorming", "references", "example.md"),
      ].sort(),
    );

    expect(readInstance("capability-brainstorming/SKILL.md")).toContain(
      "Terse deliverable contract.",
    );
    expect(
      readInstance("capability-brainstorming/references/example.md"),
    ).toBe("# Example\n");
  });

  it("skips rewrite when source and target hashes match", async () => {
    writeSkill(
      "capability-brainstorming/SKILL.md",
      "identical content\n",
    );

    // Prime the target with identical bytes.
    const dst = join(
      agentDir,
      ".claude",
      "skills",
      "capability-brainstorming",
      "SKILL.md",
    );
    mkdirSync(join(dst, ".."), { recursive: true });
    writeFileSync(dst, "identical content\n");

    const res = await syncFrameworkSkills({ sourceDir, agentDir });
    expect(res.synced).toBe(0);
    expect(res.unchanged).toBe(1);
  });

  it("propagates source updates on subsequent syncs (the BUG-4 regression case)", async () => {
    // Phase 1: initial sync lays down the verbose copy.
    writeSkill(
      "capability-brainstorming/SKILL.md",
      "verbose 3K deliverable — old contract\n",
    );
    let res = await syncFrameworkSkills({ sourceDir, agentDir });
    expect(res.synced).toBe(1);
    expect(readInstance("capability-brainstorming/SKILL.md")).toContain(
      "verbose",
    );

    // Phase 2: edit the source (terse contract lands).
    writeSkill(
      "capability-brainstorming/SKILL.md",
      "≤5 line deliverable — terse contract\n",
    );
    res = await syncFrameworkSkills({ sourceDir, agentDir });
    expect(res.synced).toBe(1);
    expect(res.unchanged).toBe(0);
    expect(readInstance("capability-brainstorming/SKILL.md")).toContain(
      "terse contract",
    );

    // Phase 3: no source change → no rewrite.
    res = await syncFrameworkSkills({ sourceDir, agentDir });
    expect(res.synced).toBe(0);
    expect(res.unchanged).toBe(1);
  });

  it("leaves instance-only files alone (additive, never destructive)", async () => {
    // Source has one skill; instance has an extra skill that the framework
    // doesn't ship. The sync must not delete it.
    writeSkill("brainstorming/SKILL.md", "shipped\n");
    const extra = join(
      agentDir,
      ".claude",
      "skills",
      "child-development",
      "SKILL.md",
    );
    mkdirSync(join(extra, ".."), { recursive: true });
    writeFileSync(extra, "instance-only\n");

    const res = await syncFrameworkSkills({ sourceDir, agentDir });
    expect(res.synced).toBe(1);
    expect(existsSync(extra)).toBe(true);
    expect(readFileSync(extra, "utf8")).toBe("instance-only\n");
  });

  it("sync variant returns the same result shape", () => {
    writeSkill("s/SKILL.md", "x\n");
    const res = syncFrameworkSkillsSync({ sourceDir, agentDir });
    expect(res.synced).toBe(1);
    expect(res.unchanged).toBe(0);
    expect(readInstance("s/SKILL.md")).toBe("x\n");
  });

  it("returns zero counts when source dir does not exist", async () => {
    const res = await syncFrameworkSkills({
      sourceDir: join(root, "nope"),
      agentDir,
    });
    expect(res.synced).toBe(0);
    expect(res.unchanged).toBe(0);
    expect(res.syncedPaths).toEqual([]);
  });
});
