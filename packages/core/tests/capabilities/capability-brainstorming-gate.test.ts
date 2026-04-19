import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const SKILL_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../skills/capability-brainstorming/SKILL.md",
);
const content = readFileSync(SKILL_PATH, "utf-8");

describe("capability-brainstorming SKILL.md — Step 0 gate", () => {
  it("has a Step 0: Mode check section", () => {
    expect(content).toContain("## Step 0: Mode check");
  });

  it("Step 0 gates on MODE: FIX prefix", () => {
    expect(content).toContain("MODE: FIX");
  });

  it("Step 0 disables the authoring flow steps in fix mode", () => {
    expect(content).toContain("Steps 1, 2, 3, 4, 5, and 6 of the authoring flow");
    expect(content).toContain("DISABLED in fix mode");
  });

  it("fix-mode documents the ESCALATE: redesign-needed marker", () => {
    expect(content).toContain("ESCALATE: redesign-needed");
  });

  it("fix-mode documents the ESCALATE: insufficient-context marker", () => {
    expect(content).toContain("ESCALATE: insufficient-context");
  });

  it("fix-mode instructs reading CAPABILITY.md, config.yaml, DECISIONS.md, scripts/", () => {
    expect(content).toContain("CAPABILITY.md");
    expect(content).toContain("config.yaml");
    expect(content).toContain("DECISIONS.md");
  });

  it("fix-mode instructs not to spawn a nested builder automation", () => {
    expect(content).toContain("Do NOT spawn a nested builder automation");
  });

  it("Step 5 has the neutral-identifier convention", () => {
    expect(content).toContain("capability `name:` must be a neutral identifier");
  });

  // [ARCHITECT R3] — regression assertions: the Step 0 insert must NOT clobber Steps 1-6.
  it("authoring-mode Steps 1 through 6 headings still exist after Step 0 insert", () => {
    expect(content).toContain("## Step 1");
    expect(content).toContain("## Step 2");
    expect(content).toContain("## Step 3");
    expect(content).toContain("## Step 4");
    expect(content).toContain("## Step 5");
    expect(content).toContain("## Step 6");
  });

  it("authoring-flow body still references core authoring concepts", () => {
    expect(content).toContain("create_automation");
    expect(content).toContain("Spawn the Builder");
  });
});
