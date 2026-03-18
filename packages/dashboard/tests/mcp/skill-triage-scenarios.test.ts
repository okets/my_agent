import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const AGENT_SKILLS_DIR = join(
  process.cwd(),
  "..",
  "..",
  ".my_agent",
  ".claude",
  "skills",
);
const FRAMEWORK_SKILLS_DIR = join(process.cwd(), "..", "core", "skills");

function getTriageContent(): string {
  const agentPath = join(AGENT_SKILLS_DIR, "task-triage", "SKILL.md");
  const frameworkPath = join(FRAMEWORK_SKILLS_DIR, "task-triage", "SKILL.md");
  for (const p of [agentPath, frameworkPath]) {
    if (existsSync(p)) return readFileSync(p, "utf-8");
  }
  throw new Error("task-triage SKILL.md not found");
}

describe("task-triage skill — skill operations content", () => {
  const content = getTriageContent();

  it("mentions skill CRUD tools", () => {
    expect(content).toContain("create_skill");
    expect(content).toContain("update_skill");
    expect(content).toContain("delete_skill");
  });

  it("distinguishes skills from tasks", () => {
    expect(content).toMatch(/skill.*capabilit/i);
    expect(content).toContain("create_task");
  });

  it("instructs to understand before acting", () => {
    expect(content).toMatch(/clarif|ask.*question|never guess/i);
  });
});
