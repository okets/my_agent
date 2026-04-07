import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

/**
 * M9.2-S7: task-triage now lives in repo-root skills/task-triage.md
 * (framework level:brain skill), not in .claude/skills/ or packages/core/skills/.
 */
const FRAMEWORK_SKILLS_DIR = join(process.cwd(), "..", "..", "skills");

function getTriageContent(): string {
  const frameworkPath = join(FRAMEWORK_SKILLS_DIR, "task-triage.md");
  if (existsSync(frameworkPath)) return readFileSync(frameworkPath, "utf-8");
  throw new Error("task-triage.md not found in skills/");
}

describe("task-triage skill — skill operations content", () => {
  const content = getTriageContent();

  it("mentions skill CRUD tools", () => {
    expect(content).toContain("create_skill");
    expect(content).toContain("update_skill");
    expect(content).toContain("delete_skill");
  });

  it("distinguishes skills from automations", () => {
    expect(content).toMatch(/skill.*capabilit/i);
    expect(content).toContain("create_automation");
  });

  it("instructs to understand before acting", () => {
    expect(content).toMatch(/clarif|ask.*question|never guess/i);
  });

  it("does not contain stale tool references", () => {
    expect(content).not.toContain("create_task");
    expect(content).not.toContain("revise_task");
    expect(content).not.toContain("search_tasks");
    expect(content).not.toContain("update_property");
  });

  it("includes the Automation Design Checklist", () => {
    expect(content).toContain("Automation Design Checklist");
    expect(content).toContain("Todos:");
  });
});
