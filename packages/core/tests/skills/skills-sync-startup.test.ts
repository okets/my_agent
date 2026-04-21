/**
 * skills-sync-startup.test.ts — M9.6-S21 BUG-4.
 *
 * Boot-contract test: after `App.create()` (or the equivalent boot sync call)
 * runs against a hatched agent dir, the instance-side
 * `<agentDir>/.claude/skills/capability-brainstorming/SKILL.md` must match
 * `packages/core/skills/capability-brainstorming/SKILL.md` byte-for-byte.
 *
 * The full `App.create()` path requires live SDK auth and spins up many
 * subsystems. We use the same "simulate boot wiring" pattern as
 * `boot-deps-wired.test.ts`: invoke the very function the boot path calls
 * (`syncFrameworkSkillsSync`) and assert the on-disk result.
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
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { syncFrameworkSkillsSync } from "../../src/skills/sync.js";

describe("skills sync at startup (BUG-4)", () => {
  let agentDir: string;

  beforeEach(() => {
    agentDir = mkdtempSync(join(tmpdir(), "m9.6-s21-boot-skills-"));
  });

  afterEach(() => {
    rmSync(agentDir, { recursive: true, force: true });
  });

  it("capability-brainstorming/SKILL.md matches source byte-for-byte after boot sync", () => {
    const sourceSkillsDir = resolve(
      import.meta.dirname,
      "..",
      "..",
      "skills",
    );
    const sourceSkillMd = join(
      sourceSkillsDir,
      "capability-brainstorming",
      "SKILL.md",
    );
    // Sanity: the framework skill must exist — otherwise this test is a no-op.
    expect(existsSync(sourceSkillMd)).toBe(true);

    // Simulate the boot path — identical to what `App.create()` does after
    // auth is resolved and before capability registry / brain session start.
    const res = syncFrameworkSkillsSync({
      sourceDir: sourceSkillsDir,
      agentDir,
    });

    expect(res.synced).toBeGreaterThan(0);
    expect(res.syncedPaths).toContain(
      join("capability-brainstorming", "SKILL.md"),
    );

    const targetPath = join(
      agentDir,
      ".claude",
      "skills",
      "capability-brainstorming",
      "SKILL.md",
    );
    expect(existsSync(targetPath)).toBe(true);

    const sourceBytes = readFileSync(sourceSkillMd);
    const targetBytes = readFileSync(targetPath);
    expect(targetBytes.equals(sourceBytes)).toBe(true);
  });

  it("is idempotent on a re-boot — unchanged=N, synced=0", () => {
    const sourceSkillsDir = resolve(
      import.meta.dirname,
      "..",
      "..",
      "skills",
    );

    // First boot populates.
    const first = syncFrameworkSkillsSync({
      sourceDir: sourceSkillsDir,
      agentDir,
    });
    expect(first.synced).toBeGreaterThan(0);

    // Second boot with no changes must be a pure no-op on disk.
    const second = syncFrameworkSkillsSync({
      sourceDir: sourceSkillsDir,
      agentDir,
    });
    expect(second.synced).toBe(0);
    expect(second.unchanged).toBe(first.synced + first.unchanged);
  });

  it("drops propagate: edit source then re-run sync", () => {
    // Lay down a stale instance copy of a skill that the source also has.
    const sourceSkillsDir = resolve(
      import.meta.dirname,
      "..",
      "..",
      "skills",
    );
    const targetDir = join(
      agentDir,
      ".claude",
      "skills",
      "capability-brainstorming",
    );
    mkdirSync(targetDir, { recursive: true });
    writeFileSync(
      join(targetDir, "SKILL.md"),
      "STALE — pre-S21 verbose deliverable contract\n",
    );

    // Boot sync must rewrite the stale file back to match source.
    const res = syncFrameworkSkillsSync({
      sourceDir: sourceSkillsDir,
      agentDir,
    });
    expect(res.syncedPaths).toContain(
      join("capability-brainstorming", "SKILL.md"),
    );

    const targetBytes = readFileSync(join(targetDir, "SKILL.md"));
    const sourceBytes = readFileSync(
      join(sourceSkillsDir, "capability-brainstorming", "SKILL.md"),
    );
    expect(targetBytes.equals(sourceBytes)).toBe(true);
  });
});
