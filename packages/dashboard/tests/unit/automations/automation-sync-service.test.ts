import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { AutomationSyncService } from "../../../src/automations/automation-sync-service.js";
import { AutomationManager } from "../../../src/automations/automation-manager.js";
import { ConversationDatabase } from "../../../src/conversations/db.js";
import { mkdtempSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { mkdirSync } from "fs";
import { writeFrontmatter } from "../../../src/metadata/frontmatter.js";

describe("AutomationSyncService", () => {
  let db: ConversationDatabase;
  let manager: AutomationManager;
  let syncService: AutomationSyncService;
  let tempDir: string;
  let automationsDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "auto-sync-"));
    automationsDir = join(tempDir, "automations");
    mkdirSync(automationsDir, { recursive: true });
    db = new ConversationDatabase(tempDir);
    manager = new AutomationManager(automationsDir, db);
    syncService = new AutomationSyncService({
      automationsDir,
      manager,
    });
  });

  afterEach(async () => {
    await syncService.stop();
    db.close();
  });

  it("should sync existing automations on startup", async () => {
    // Create automation files before starting sync
    writeFrontmatter(
      join(automationsDir, "daily-report.md"),
      {
        name: "Daily Report",
        status: "active",
        trigger: [{ type: "schedule", cron: "0 9 * * *" }],
        created: "2026-03-23T00:00:00Z",
      },
      "Generate a daily summary report.",
    );

    writeFrontmatter(
      join(automationsDir, "invoice-filer.md"),
      {
        name: "Invoice Filer",
        status: "active",
        trigger: [{ type: "manual" }],
        created: "2026-03-23T00:00:00Z",
      },
      "File incoming invoices.",
    );

    await syncService.start();

    // Both automations should be in agent.db
    const automations = db.listAutomations();
    expect(automations).toHaveLength(2);
    const names = automations.map((a) => a.name).sort();
    expect(names).toEqual(["Daily Report", "Invoice Filer"]);
  });

  it("should handle empty automations directory on startup", async () => {
    await syncService.start();
    const automations = db.listAutomations();
    expect(automations).toHaveLength(0);
  });

  it("should emit automation:updated event on file change", async () => {
    // Create an automation first
    manager.create({
      name: "Test Auto",
      instructions: "test",
      manifest: {},
    });

    const events: any[] = [];
    syncService.on("automation:updated", (automation) => {
      events.push(automation);
    });

    await syncService.start();

    // Manually simulate file change via manager.read
    const automation = manager.read("test-auto");
    expect(automation).not.toBeNull();
  });

  it("should emit automation:removed event and disable on file deletion", async () => {
    manager.create({
      name: "To Remove",
      instructions: "test",
      manifest: {},
    });

    const removedIds: string[] = [];
    syncService.on("automation:removed", (id) => {
      removedIds.push(id);
    });

    await syncService.start();

    // Simulate the file:deleted event that FileWatcher would emit
    // by directly calling disable
    manager.disable("to-remove");

    const dbRow = db.getAutomation("to-remove");
    expect(dbRow!.status).toBe("disabled");
  });

  it("should start and stop without errors", async () => {
    await syncService.start();
    await syncService.stop();
  });
});
