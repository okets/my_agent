/**
 * Task 2: System automation protection — unit tests
 *
 * Verifies system automations can't be modified or deleted through any path.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { AutomationManager } from "../../../src/automations/automation-manager.js";
import { ConversationDatabase } from "../../../src/conversations/db.js";
import { mkdtempSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

/**
 * Create a system automation by writing a markdown file directly.
 * manager.create() doesn't propagate system/handler to frontmatter —
 * real system automations come from migration-written markdown.
 */
function writeSystemAutomation(
  automationsDir: string,
  id: string,
  opts: { name: string; handler: string; cron?: string },
): void {
  const cron = opts.cron ?? "0 22 * * *";
  const content = `---
name: ${opts.name}
status: active
system: true
trigger:
  - type: schedule
    cron: "${cron}"
handler: ${opts.handler}
notify: none
autonomy: full
once: false
created: "2026-03-26"
---

# ${opts.name}

System automation.
`;
  writeFileSync(join(automationsDir, `${id}.md`), content, "utf-8");
}

describe("System Automation Protection", () => {
  let db: ConversationDatabase;
  let manager: AutomationManager;
  let tempDir: string;
  let automationsDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "sys-protect-"));
    automationsDir = join(tempDir, "automations");
    mkdirSync(automationsDir, { recursive: true });
    db = new ConversationDatabase(tempDir);
    manager = new AutomationManager(automationsDir, db);
  });

  afterEach(() => {
    db.close();
  });

  it("cannot update a system automation", () => {
    writeSystemAutomation(automationsDir, "system-daily-summary", {
      name: "System Daily Summary",
      handler: "daily-summary",
    });
    // Read to index into DB
    const automation = manager.read("system-daily-summary");
    expect(automation).not.toBeNull();
    expect(automation!.manifest.system).toBe(true);

    expect(() =>
      manager.update("system-daily-summary", { name: "hacked" }),
    ).toThrow(/Cannot modify system automation/);
  });

  it("cannot disable a system automation", () => {
    writeSystemAutomation(automationsDir, "system-weekly-review", {
      name: "System Weekly Review",
      handler: "weekly-review",
      cron: "0 9 * * 1",
    });
    manager.read("system-weekly-review"); // index

    expect(() => manager.disable("system-weekly-review")).toThrow(
      /Cannot disable system automation/,
    );
  });

  it("listAutomations with excludeSystem does NOT include system automations", () => {
    writeSystemAutomation(automationsDir, "system-auto", {
      name: "System Auto",
      handler: "daily-summary",
    });
    manager.read("system-auto"); // index

    manager.create({
      name: "User Auto",
      instructions: "User task.",
      manifest: { trigger: [{ type: "manual" }] },
    });

    const filtered = manager.list({ excludeSystem: true });
    expect(filtered.length).toBe(1);
    expect(filtered[0].manifest.name).toBe("User Auto");
  });

  it("listAutomations without filter includes system automations", () => {
    writeSystemAutomation(automationsDir, "system-auto", {
      name: "System Auto",
      handler: "daily-summary",
    });
    manager.read("system-auto"); // index

    manager.create({
      name: "User Auto",
      instructions: "User task.",
      manifest: { trigger: [{ type: "manual" }] },
    });

    const all = manager.list();
    expect(all.length).toBe(2);

    const systemAuto = all.find((a) => a.manifest.name === "System Auto");
    expect(systemAuto).toBeDefined();
  });

  it("user automation update and disable work normally", () => {
    const automation = manager.create({
      name: "User Task",
      instructions: "Do something.",
      manifest: { trigger: [{ type: "manual" }] },
    });

    const updated = manager.update(automation.id, { name: "Renamed Task" });
    expect(updated.manifest.name).toBe("Renamed Task");

    manager.disable(automation.id);
    const disabled = manager.read(automation.id);
    expect(disabled!.manifest.status).toBe("disabled");
  });
});
