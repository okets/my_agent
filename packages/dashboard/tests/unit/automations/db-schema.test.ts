import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ConversationDatabase } from "../../../src/conversations/db.js";
import { mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("Automations + Jobs tables in agent.db", () => {
  let db: ConversationDatabase;

  beforeEach(() => {
    const tempDir = mkdtempSync(join(tmpdir(), "automations-db-"));
    db = new ConversationDatabase(tempDir);
  });

  afterEach(() => {
    db.close();
  });

  // ── Table creation ──────────────────────────────────────────────

  it("should create automations table on initialization", () => {
    const tables = db
      .getDb()
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='automations'",
      )
      .all() as any[];
    expect(tables).toHaveLength(1);
  });

  it("should create jobs table on initialization", () => {
    const tables = db
      .getDb()
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='jobs'",
      )
      .all() as any[];
    expect(tables).toHaveLength(1);
  });

  it("should create indexes on automations and jobs", () => {
    const indexes = db
      .getDb()
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%'",
      )
      .all() as any[];
    const indexNames = indexes.map((i: any) => i.name);
    expect(indexNames).toContain("idx_automations_status");
    expect(indexNames).toContain("idx_jobs_automation");
    expect(indexNames).toContain("idx_jobs_created");
    expect(indexNames).toContain("idx_jobs_status");
  });

  // ── Automation CRUD ─────────────────────────────────────────────

  it("should upsert and retrieve an automation", () => {
    db.upsertAutomation({
      id: "file-invoices",
      name: "File Invoices",
      status: "active",
      triggerConfig: JSON.stringify([{ type: "schedule", cron: "0 9 * * 1" }]),
      spaces: JSON.stringify(["invoices"]),
      model: "claude-sonnet-4-6",
      notify: "debrief",
      persistSession: false,
      autonomy: "full",
      once: false,
      delivery: JSON.stringify([{ channel: "dashboard" }]),
      created: "2026-03-23T00:00:00Z",
      indexedAt: "2026-03-23T10:00:00Z",
    });

    const automation = db.getAutomation("file-invoices");
    expect(automation).not.toBeNull();
    expect(automation!.id).toBe("file-invoices");
    expect(automation!.name).toBe("File Invoices");
    expect(automation!.status).toBe("active");
    expect(JSON.parse(automation!.triggerConfig)).toEqual([
      { type: "schedule", cron: "0 9 * * 1" },
    ]);
    expect(JSON.parse(automation!.spaces!)).toEqual(["invoices"]);
    expect(automation!.model).toBe("claude-sonnet-4-6");
    expect(automation!.notify).toBe("debrief");
    expect(automation!.persistSession).toBe(false);
    expect(automation!.autonomy).toBe("full");
    expect(automation!.once).toBe(false);
    expect(JSON.parse(automation!.delivery!)).toEqual([
      { channel: "dashboard" },
    ]);
    expect(automation!.created).toBe("2026-03-23T00:00:00Z");
    expect(automation!.indexedAt).toBe("2026-03-23T10:00:00Z");
  });

  it("should update existing automation on upsert", () => {
    db.upsertAutomation({
      id: "test-auto",
      name: "Test",
      status: "active",
      triggerConfig: JSON.stringify([{ type: "manual" }]),
      created: "2026-03-23T00:00:00Z",
      indexedAt: "2026-03-23T10:00:00Z",
    });

    db.upsertAutomation({
      id: "test-auto",
      name: "Test Updated",
      status: "disabled",
      triggerConfig: JSON.stringify([{ type: "manual" }]),
      created: "2026-03-23T00:00:00Z",
      indexedAt: "2026-03-23T11:00:00Z",
    });

    const automation = db.getAutomation("test-auto");
    expect(automation!.name).toBe("Test Updated");
    expect(automation!.status).toBe("disabled");
    expect(automation!.indexedAt).toBe("2026-03-23T11:00:00Z");
  });

  it("should list automations with status filter", () => {
    db.upsertAutomation({
      id: "active-1",
      name: "Active One",
      status: "active",
      triggerConfig: JSON.stringify([{ type: "manual" }]),
      created: "2026-03-23T00:00:00Z",
      indexedAt: "2026-03-23T10:00:00Z",
    });
    db.upsertAutomation({
      id: "disabled-1",
      name: "Disabled One",
      status: "disabled",
      triggerConfig: JSON.stringify([{ type: "manual" }]),
      created: "2026-03-23T00:00:00Z",
      indexedAt: "2026-03-23T10:00:00Z",
    });

    const all = db.listAutomations();
    expect(all).toHaveLength(2);

    const active = db.listAutomations({ status: "active" });
    expect(active).toHaveLength(1);
    expect(active[0].id).toBe("active-1");

    const disabled = db.listAutomations({ status: "disabled" });
    expect(disabled).toHaveLength(1);
    expect(disabled[0].id).toBe("disabled-1");
  });

  it("should delete an automation", () => {
    db.upsertAutomation({
      id: "to-delete",
      name: "Delete Me",
      status: "active",
      triggerConfig: JSON.stringify([{ type: "manual" }]),
      created: "2026-03-23T00:00:00Z",
      indexedAt: "2026-03-23T10:00:00Z",
    });

    db.deleteAutomation("to-delete");
    expect(db.getAutomation("to-delete")).toBeNull();
  });

  it("should return null for non-existent automation", () => {
    expect(db.getAutomation("does-not-exist")).toBeNull();
  });

  // ── Job CRUD ────────────────────────────────────────────────────

  it("should upsert and retrieve a job", () => {
    // Must create automation first (FK constraint)
    db.upsertAutomation({
      id: "file-invoices",
      name: "File Invoices",
      status: "active",
      triggerConfig: JSON.stringify([{ type: "manual" }]),
      created: "2026-03-23T00:00:00Z",
      indexedAt: "2026-03-23T10:00:00Z",
    });

    db.upsertJob({
      id: "job-001",
      automationId: "file-invoices",
      status: "running",
      created: "2026-03-23T14:00:00Z",
      context: JSON.stringify({ trigger: "schedule" }),
      runDir: "/tmp/runs/file-invoices/job-001",
    });

    const job = db.getJob("job-001");
    expect(job).not.toBeNull();
    expect(job!.id).toBe("job-001");
    expect(job!.automationId).toBe("file-invoices");
    expect(job!.status).toBe("running");
    expect(job!.created).toBe("2026-03-23T14:00:00Z");
    expect(JSON.parse(job!.context!)).toEqual({ trigger: "schedule" });
    expect(job!.runDir).toBe("/tmp/runs/file-invoices/job-001");
    expect(job!.completed).toBeNull();
    expect(job!.summary).toBeNull();
  });

  it("should update job on upsert", () => {
    db.upsertAutomation({
      id: "test-auto",
      name: "Test",
      status: "active",
      triggerConfig: JSON.stringify([{ type: "manual" }]),
      created: "2026-03-23T00:00:00Z",
      indexedAt: "2026-03-23T10:00:00Z",
    });

    db.upsertJob({
      id: "job-002",
      automationId: "test-auto",
      status: "running",
      created: "2026-03-23T14:00:00Z",
    });

    db.upsertJob({
      id: "job-002",
      automationId: "test-auto",
      status: "completed",
      created: "2026-03-23T14:00:00Z",
      completed: "2026-03-23T14:05:00Z",
      summary: "Done",
    });

    const job = db.getJob("job-002");
    expect(job!.status).toBe("completed");
    expect(job!.completed).toBe("2026-03-23T14:05:00Z");
    expect(job!.summary).toBe("Done");
  });

  it("should list jobs with automation filter", () => {
    db.upsertAutomation({
      id: "auto-a",
      name: "A",
      status: "active",
      triggerConfig: JSON.stringify([{ type: "manual" }]),
      created: "2026-03-23T00:00:00Z",
      indexedAt: "2026-03-23T10:00:00Z",
    });
    db.upsertAutomation({
      id: "auto-b",
      name: "B",
      status: "active",
      triggerConfig: JSON.stringify([{ type: "manual" }]),
      created: "2026-03-23T00:00:00Z",
      indexedAt: "2026-03-23T10:00:00Z",
    });

    db.upsertJob({
      id: "job-a1",
      automationId: "auto-a",
      status: "completed",
      created: "2026-03-23T14:00:00Z",
    });
    db.upsertJob({
      id: "job-b1",
      automationId: "auto-b",
      status: "completed",
      created: "2026-03-23T14:01:00Z",
    });

    const jobsA = db.listJobs({ automationId: "auto-a" });
    expect(jobsA).toHaveLength(1);
    expect(jobsA[0].id).toBe("job-a1");

    const jobsB = db.listJobs({ automationId: "auto-b" });
    expect(jobsB).toHaveLength(1);
    expect(jobsB[0].id).toBe("job-b1");
  });

  it("should list jobs with status filter", () => {
    db.upsertAutomation({
      id: "auto-x",
      name: "X",
      status: "active",
      triggerConfig: JSON.stringify([{ type: "manual" }]),
      created: "2026-03-23T00:00:00Z",
      indexedAt: "2026-03-23T10:00:00Z",
    });

    db.upsertJob({
      id: "job-x1",
      automationId: "auto-x",
      status: "running",
      created: "2026-03-23T14:00:00Z",
    });
    db.upsertJob({
      id: "job-x2",
      automationId: "auto-x",
      status: "completed",
      created: "2026-03-23T14:01:00Z",
    });

    const running = db.listJobs({ status: "running" });
    expect(running).toHaveLength(1);
    expect(running[0].id).toBe("job-x1");
  });

  it("should list jobs with since filter", () => {
    db.upsertAutomation({
      id: "auto-y",
      name: "Y",
      status: "active",
      triggerConfig: JSON.stringify([{ type: "manual" }]),
      created: "2026-03-23T00:00:00Z",
      indexedAt: "2026-03-23T10:00:00Z",
    });

    db.upsertJob({
      id: "job-old",
      automationId: "auto-y",
      status: "completed",
      created: "2026-03-20T14:00:00Z",
    });
    db.upsertJob({
      id: "job-new",
      automationId: "auto-y",
      status: "completed",
      created: "2026-03-23T14:00:00Z",
    });

    const recent = db.listJobs({ since: "2026-03-22T00:00:00Z" });
    expect(recent).toHaveLength(1);
    expect(recent[0].id).toBe("job-new");
  });

  it("should list jobs with limit", () => {
    db.upsertAutomation({
      id: "auto-z",
      name: "Z",
      status: "active",
      triggerConfig: JSON.stringify([{ type: "manual" }]),
      created: "2026-03-23T00:00:00Z",
      indexedAt: "2026-03-23T10:00:00Z",
    });

    for (let i = 0; i < 5; i++) {
      db.upsertJob({
        id: `job-z${i}`,
        automationId: "auto-z",
        status: "completed",
        created: `2026-03-23T14:0${i}:00Z`,
      });
    }

    const limited = db.listJobs({ limit: 2 });
    expect(limited).toHaveLength(2);
  });

  it("should return null for non-existent job", () => {
    expect(db.getJob("does-not-exist")).toBeNull();
  });

  it("should enforce FK from jobs to automations", () => {
    expect(() => {
      db.upsertJob({
        id: "orphan-job",
        automationId: "nonexistent",
        status: "pending",
        created: "2026-03-23T14:00:00Z",
      });
    }).toThrow();
  });

  it("should list jobs ordered by created DESC", () => {
    db.upsertAutomation({
      id: "auto-order",
      name: "Order Test",
      status: "active",
      triggerConfig: JSON.stringify([{ type: "manual" }]),
      created: "2026-03-23T00:00:00Z",
      indexedAt: "2026-03-23T10:00:00Z",
    });

    db.upsertJob({
      id: "job-first",
      automationId: "auto-order",
      status: "completed",
      created: "2026-03-23T10:00:00Z",
    });
    db.upsertJob({
      id: "job-second",
      automationId: "auto-order",
      status: "completed",
      created: "2026-03-23T11:00:00Z",
    });
    db.upsertJob({
      id: "job-third",
      automationId: "auto-order",
      status: "completed",
      created: "2026-03-23T12:00:00Z",
    });

    const jobs = db.listJobs();
    expect(jobs[0].id).toBe("job-third");
    expect(jobs[1].id).toBe("job-second");
    expect(jobs[2].id).toBe("job-first");
  });
});
