import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { AutomationManager } from "../../../src/automations/automation-manager.js";
import { ConversationDatabase } from "../../../src/conversations/db.js";
import { readFrontmatter } from "../../../src/metadata/frontmatter.js";
import { mkdtempSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { mkdirSync } from "fs";

describe("AutomationManager", () => {
  let db: ConversationDatabase;
  let manager: AutomationManager;
  let tempDir: string;
  let automationsDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "auto-manager-"));
    automationsDir = join(tempDir, "automations");
    mkdirSync(automationsDir, { recursive: true });
    db = new ConversationDatabase(tempDir);
    manager = new AutomationManager(automationsDir, db);
  });

  afterEach(() => {
    db.close();
  });

  // ── create ──────────────────────────────────────────────────────

  it("should create an automation with correct frontmatter", () => {
    const automation = manager.create({
      name: "File Invoices",
      instructions: "File incoming invoices to the correct Q folder.",
      manifest: {
        trigger: [{ type: "schedule", cron: "0 9 * * 1-5" }],
        spaces: ["invoices"],
        model: "claude-sonnet-4-6",
      },
    });

    expect(automation.id).toBe("file-invoices");
    expect(automation.manifest.name).toBe("File Invoices");
    expect(automation.manifest.status).toBe("active");
    expect(automation.manifest.trigger[0].cron).toBe("0 9 * * 1-5");

    // Verify file exists on disk
    expect(existsSync(automation.filePath)).toBe(true);

    // Read back from disk
    const { data, body } = readFrontmatter(automation.filePath);
    expect((data as any).name).toBe("File Invoices");
    expect(body.trim()).toBe("File incoming invoices to the correct Q folder.");
  });

  it("should index automation into agent.db", () => {
    const automation = manager.create({
      name: "Test Auto",
      instructions: "Test instructions.",
      manifest: {
        trigger: [{ type: "manual" }],
      },
    });

    const dbRow = db.getAutomation(automation.id);
    expect(dbRow).not.toBeNull();
    expect(dbRow!.name).toBe("Test Auto");
    expect(dbRow!.status).toBe("active");
  });

  it("should generate kebab-case ID from name", () => {
    const auto1 = manager.create({
      name: "My Cool Automation",
      instructions: "test",
      manifest: {},
    });
    expect(auto1.id).toBe("my-cool-automation");

    const auto2 = manager.create({
      name: "  Spaces & Symbols! ",
      instructions: "test",
      manifest: {},
    });
    expect(auto2.id).toBe("spaces-symbols");
  });

  // ── read ────────────────────────────────────────────────────────

  it("should read an automation from disk", () => {
    manager.create({
      name: "Read Test",
      instructions: "These are the instructions.",
      manifest: {
        trigger: [{ type: "channel", hint: "invoice" }],
        notify: "immediate",
      },
    });

    const automation = manager.read("read-test");
    expect(automation).not.toBeNull();
    expect(automation!.manifest.name).toBe("Read Test");
    expect(automation!.manifest.notify).toBe("immediate");
    expect(automation!.instructions).toBe("These are the instructions.");
  });

  it("should return null for non-existent automation", () => {
    expect(manager.read("nonexistent")).toBeNull();
  });

  // ── update ──────────────────────────────────────────────────────

  it("should update automation manifest fields", () => {
    manager.create({
      name: "Update Test",
      instructions: "Original instructions.",
      manifest: {
        trigger: [{ type: "manual" }],
        notify: "debrief",
      },
    });

    const updated = manager.update("update-test", {
      notify: "immediate",
      model: "claude-opus-4-6",
    });

    expect(updated.manifest.notify).toBe("immediate");
    expect(updated.manifest.model).toBe("claude-opus-4-6");

    // Verify persisted on disk
    const readBack = manager.read("update-test");
    expect(readBack!.manifest.notify).toBe("immediate");
    expect(readBack!.manifest.model).toBe("claude-opus-4-6");
  });

  it("should preserve instructions on update", () => {
    manager.create({
      name: "Preserve Test",
      instructions: "Keep this body.",
      manifest: {},
    });

    manager.update("preserve-test", { status: "disabled" });

    const readBack = manager.read("preserve-test");
    expect(readBack!.instructions).toBe("Keep this body.");
    expect(readBack!.manifest.status).toBe("disabled");
  });

  it("should throw when updating non-existent automation", () => {
    expect(() => {
      manager.update("nonexistent", { status: "disabled" });
    }).toThrow("Automation not found: nonexistent");
  });

  // ── disable ─────────────────────────────────────────────────────

  it("should disable an automation", () => {
    manager.create({
      name: "Disable Test",
      instructions: "test",
      manifest: {},
    });

    manager.disable("disable-test");

    const readBack = manager.read("disable-test");
    expect(readBack!.manifest.status).toBe("disabled");

    const dbRow = db.getAutomation("disable-test");
    expect(dbRow!.status).toBe("disabled");
  });

  // ── list ────────────────────────────────────────────────────────

  it("should list automations with status filter", () => {
    manager.create({
      name: "Active Auto",
      instructions: "active",
      manifest: { status: "active" },
    });
    manager.create({
      name: "Disabled Auto",
      instructions: "disabled",
      manifest: { status: "disabled" },
    });

    const all = manager.list();
    expect(all).toHaveLength(2);

    const active = manager.list({ status: "active" });
    expect(active).toHaveLength(1);
    expect(active[0].manifest.name).toBe("Active Auto");
  });

  // ── findById ────────────────────────────────────────────────────

  it("should find automation by ID", () => {
    manager.create({
      name: "Find Test",
      instructions: "test",
      manifest: {},
    });

    const found = manager.findById("find-test");
    expect(found).not.toBeNull();
    expect(found!.manifest.name).toBe("Find Test");
  });

  it("should return null for non-existent ID", () => {
    expect(manager.findById("nope")).toBeNull();
  });

  // ── syncAll ─────────────────────────────────────────────────────

  it("should sync all automation files to agent.db", async () => {
    // Create some automations
    manager.create({
      name: "Sync One",
      instructions: "one",
      manifest: {},
    });
    manager.create({
      name: "Sync Two",
      instructions: "two",
      manifest: {},
    });

    // Wipe DB
    db.getDb().prepare("DELETE FROM automations").run();
    expect(db.listAutomations()).toHaveLength(0);

    // Sync from disk
    const count = await manager.syncAll();
    expect(count).toBe(2);
    expect(db.listAutomations()).toHaveLength(2);
  });

  it("should handle empty automations directory on syncAll", async () => {
    const count = await manager.syncAll();
    expect(count).toBe(0);
  });

  // ── Edge cases ─────────────────────────────────────────────────

  it("should handle automation with all manifest fields", () => {
    const auto = manager.create({
      name: "Full Fields",
      instructions: "test",
      manifest: {
        status: "active",
        trigger: [
          { type: "schedule", cron: "0 9 * * 1" },
          { type: "channel", hint: "invoice" },
        ],
        spaces: ["invoices", "reports"],
        model: "claude-sonnet-4-6",
        notify: "immediate",
        persist_session: true,
        autonomy: "cautious",
        once: true,
      },
    });

    const readBack = manager.read(auto.id);
    expect(readBack!.manifest.trigger).toHaveLength(2);
    expect(readBack!.manifest.spaces).toEqual(["invoices", "reports"]);
    expect(readBack!.manifest.persist_session).toBe(true);
    expect(readBack!.manifest.autonomy).toBe("cautious");
    expect(readBack!.manifest.once).toBe(true);
  });

  // ── M9.4-S4.2 Task 8: notify default depends on manifest.system flag ──

  describe("notify default depends on manifest.system flag", () => {
    it("system: true automation defaults notify to 'none'", () => {
      const auto = manager.create({
        name: "cfr-fix-test",
        instructions: "system orchestrated repair",
        manifest: {
          system: true,
          // notify intentionally omitted — default should be 'none'
        },
      });
      expect(auto.manifest.notify).toBe("none");
    });

    it("system: false defaults notify to 'debrief'", () => {
      const auto = manager.create({
        name: "thailand-news-worker",
        instructions: "fetch news",
        manifest: {
          system: false,
          // notify omitted
        },
      });
      expect(auto.manifest.notify).toBe("debrief");
    });

    it("system absent defaults notify to 'debrief'", () => {
      const auto = manager.create({
        name: "morning-brief-collator",
        instructions: "collate brief",
        manifest: {
          // system + notify both omitted
        },
      });
      expect(auto.manifest.notify).toBe("debrief");
    });

    it("explicit notify in manifest wins over system-flag default", () => {
      const auto = manager.create({
        name: "system-but-explicit",
        instructions: "x",
        manifest: {
          system: true,
          notify: "immediate",
        },
      });
      expect(auto.manifest.notify).toBe("immediate");
    });

    it("frontmatter parse path applies the same default rule (list/read)", async () => {
      // Hand-write a frontmatter file with system: true and no notify
      const fs = require("node:fs") as typeof import("node:fs");
      const path = require("node:path") as typeof import("node:path");
      const filePath = path.join(automationsDir, "raw-system.md");
      fs.writeFileSync(
        filePath,
        "---\nname: raw-system\nstatus: active\nsystem: true\n---\nbody",
      );
      // Force resync from disk
      await manager.syncAll();
      const read = manager.read("raw-system");
      expect(read).not.toBeNull();
      expect(read!.manifest.system).toBe(true);
      expect(read!.manifest.notify).toBe("none");
    });

    it("frontmatter parse path: system absent → debrief default", async () => {
      const fs = require("node:fs") as typeof import("node:fs");
      const path = require("node:path") as typeof import("node:path");
      const filePath = path.join(automationsDir, "raw-user.md");
      fs.writeFileSync(
        filePath,
        "---\nname: raw-user\nstatus: active\n---\nbody",
      );
      await manager.syncAll();
      const read = manager.read("raw-user");
      expect(read).not.toBeNull();
      expect(read!.manifest.notify).toBe("debrief");
    });
  });
});
