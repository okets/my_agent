/**
 * Task 4: Work-patterns migration — integration test
 *
 * Verifies that existing hatched agents with work-patterns.md get their
 * automations created on upgrade.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { migrateWorkPatternsToAutomations } from "../../src/migrations/work-patterns-to-automations.js";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readdirSync } from "fs";
import { readFrontmatter } from "../../src/metadata/frontmatter.js";
import { join } from "path";
import { tmpdir } from "os";

describe("Work-Patterns Migration", () => {
  let agentDir: string;

  beforeEach(() => {
    agentDir = mkdtempSync(join(tmpdir(), "migration-"));
  });

  it("creates automation manifests from work-patterns.md", () => {
    // Set up work-patterns.md in the old format
    const configDir = join(agentDir, "notebook", "config");
    mkdirSync(configDir, { recursive: true });

    writeFileSync(
      join(configDir, "work-patterns.md"),
      `---
jobs:
  debrief-prep:
    cadence: "daily:8:30"
    model: haiku
  daily-summary:
    cadence: "daily:22:0"
    model: haiku
---

# Work Patterns

Legacy format.
`,
      "utf-8",
    );

    const count = migrateWorkPatternsToAutomations(agentDir);
    expect(count).toBeGreaterThan(0);

    const automationsDir = join(agentDir, "automations");
    expect(existsSync(automationsDir)).toBe(true);

    const files = readdirSync(automationsDir).filter((f) => f.endsWith(".md"));
    expect(files.length).toBeGreaterThanOrEqual(2);

    // Check debrief manifest (user automation)
    expect(files).toContain("debrief.md");
    const { data: debriefData } = readFrontmatter(
      join(automationsDir, "debrief.md"),
    );
    expect((debriefData as any).handler).toBe("debrief-prep");
    expect((debriefData as any).status).toBe("active");
    // daily:8:30 → "30 8 * * *"
    const debriefTrigger = (debriefData as any).trigger[0];
    expect(debriefTrigger.cron).toBe("30 8 * * *");

    // Check daily-summary manifest (system automation)
    expect(files).toContain("system-daily-summary.md");
    const { data: dailyData } = readFrontmatter(
      join(automationsDir, "system-daily-summary.md"),
    );
    expect((dailyData as any).system).toBe(true);
    expect((dailyData as any).handler).toBe("daily-summary");
  });

  it("each manifest has valid frontmatter fields", () => {
    const configDir = join(agentDir, "notebook", "config");
    mkdirSync(configDir, { recursive: true });

    writeFileSync(
      join(configDir, "work-patterns.md"),
      `---
jobs:
  debrief-prep:
    cadence: "daily:7:0"
  daily-summary:
    cadence: "daily:23:0"
  weekly-review:
    cadence: "weekly:monday:9:0"
---

Legacy.
`,
      "utf-8",
    );

    migrateWorkPatternsToAutomations(agentDir);
    const automationsDir = join(agentDir, "automations");
    const files = readdirSync(automationsDir).filter((f) => f.endsWith(".md"));

    for (const file of files) {
      const { data } = readFrontmatter<Record<string, unknown>>(
        join(automationsDir, file),
      );
      expect(data.name, `${file} should have name`).toBeTruthy();
      expect(data.status, `${file} should have status`).toBeTruthy();
      expect(data.handler, `${file} should have handler`).toBeTruthy();
      expect(data.trigger, `${file} should have trigger`).toBeTruthy();
      expect(data.created, `${file} should have created`).toBeTruthy();
    }
  });

  it("migration is idempotent — doesn't duplicate files", () => {
    const configDir = join(agentDir, "notebook", "config");
    mkdirSync(configDir, { recursive: true });

    writeFileSync(
      join(configDir, "work-patterns.md"),
      `---
jobs:
  debrief-prep:
    cadence: "daily:8:0"
---

Legacy.
`,
      "utf-8",
    );

    const count1 = migrateWorkPatternsToAutomations(agentDir);
    expect(count1).toBeGreaterThan(0);

    const count2 = migrateWorkPatternsToAutomations(agentDir);
    expect(count2).toBe(0); // No new files created

    const automationsDir = join(agentDir, "automations");
    const files = readdirSync(automationsDir).filter((f) => f.endsWith(".md"));
    // Should not have doubled
    const debriefCount = files.filter((f) => f.includes("debrief")).length;
    expect(debriefCount).toBe(1);
  });

  it("no work-patterns.md — migration is a no-op", () => {
    const count = migrateWorkPatternsToAutomations(agentDir);
    expect(count).toBe(0);

    const automationsDir = join(agentDir, "automations");
    expect(existsSync(automationsDir)).toBe(false);
  });
});
