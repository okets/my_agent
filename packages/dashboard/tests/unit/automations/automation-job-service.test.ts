import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { AutomationJobService } from "../../../src/automations/automation-job-service.js";
import { ConversationDatabase } from "../../../src/conversations/db.js";
import { mkdtempSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { mkdirSync } from "fs";

describe("AutomationJobService", () => {
  let db: ConversationDatabase;
  let service: AutomationJobService;
  let tempDir: string;
  let automationsDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "job-service-"));
    automationsDir = join(tempDir, "automations");
    mkdirSync(automationsDir, { recursive: true });
    db = new ConversationDatabase(tempDir);

    // Seed an automation so FK constraint is satisfied
    db.upsertAutomation({
      id: "test-auto",
      name: "Test Automation",
      status: "active",
      triggerConfig: JSON.stringify([{ type: "manual" }]),
      created: "2026-03-23T00:00:00Z",
      indexedAt: "2026-03-23T10:00:00Z",
    });

    service = new AutomationJobService(automationsDir, db);
  });

  afterEach(() => {
    db.close();
  });

  // ── createJob ───────────────────────────────────────────────────

  it("should create a job and append to JSONL", () => {
    const job = service.createJob("test-auto", { trigger: "manual" });

    expect(job.id).toMatch(/^job-/);
    expect(job.automationId).toBe("test-auto");
    expect(job.status).toBe("pending");
    expect(job.context).toEqual({ trigger: "manual" });
    expect(job.run_dir).toBeTruthy();

    // Verify JSONL file exists and contains the job
    const jsonlPath = service.getJsonlPath("test-auto");
    expect(existsSync(jsonlPath)).toBe(true);
    const content = readFileSync(jsonlPath, "utf-8").trim();
    const parsed = JSON.parse(content);
    expect(parsed.id).toBe(job.id);
  });

  it("should insert job into agent.db", () => {
    const job = service.createJob("test-auto");

    const dbJob = db.getJob(job.id);
    expect(dbJob).not.toBeNull();
    expect(dbJob!.automationId).toBe("test-auto");
    expect(dbJob!.status).toBe("pending");
  });

  it("should create run directory with CLAUDE.md", () => {
    const job = service.createJob("test-auto");

    expect(existsSync(job.run_dir!)).toBe(true);
    const claudeMd = readFileSync(join(job.run_dir!, "CLAUDE.md"), "utf-8");
    expect(claudeMd).toContain("Automation Run:");
    expect(claudeMd).toContain(job.id);
    expect(claudeMd).toContain("test-auto");
  });

  it("should append multiple jobs to same JSONL", () => {
    service.createJob("test-auto");
    service.createJob("test-auto");
    service.createJob("test-auto");

    const jsonlPath = service.getJsonlPath("test-auto");
    const lines = readFileSync(jsonlPath, "utf-8").trim().split("\n");
    expect(lines).toHaveLength(3);
  });

  // ── updateJob ───────────────────────────────────────────────────

  it("should update job in both JSONL and DB", () => {
    const job = service.createJob("test-auto");

    const updated = service.updateJob(job.id, {
      status: "completed",
      completed: "2026-03-23T15:00:00Z",
      summary: "All done",
    });

    expect(updated.status).toBe("completed");
    expect(updated.completed).toBe("2026-03-23T15:00:00Z");
    expect(updated.summary).toBe("All done");

    // Verify JSONL updated
    const jsonlPath = service.getJsonlPath("test-auto");
    const content = readFileSync(jsonlPath, "utf-8").trim();
    const parsed = JSON.parse(content);
    expect(parsed.status).toBe("completed");

    // Verify DB updated
    const dbJob = db.getJob(job.id);
    expect(dbJob!.status).toBe("completed");
    expect(dbJob!.summary).toBe("All done");
  });

  it("should update sdk_session_id", () => {
    const job = service.createJob("test-auto");
    const updated = service.updateJob(job.id, {
      sdk_session_id: "sess-abc",
    });
    expect(updated.sdk_session_id).toBe("sess-abc");

    const dbJob = db.getJob(job.id);
    expect(dbJob!.sdkSessionId).toBe("sess-abc");
  });

  it("should throw when updating non-existent job", () => {
    expect(() => {
      service.updateJob("nonexistent", { status: "failed" });
    }).toThrow("Job not found: nonexistent");
  });

  // ── listJobs / getJob ───────────────────────────────────────────

  it("should list jobs with filters", () => {
    const job1 = service.createJob("test-auto");
    service.updateJob(job1.id, { status: "completed" });
    service.createJob("test-auto");

    const all = service.listJobs({ automationId: "test-auto" });
    expect(all).toHaveLength(2);

    const completed = service.listJobs({
      automationId: "test-auto",
      status: "completed",
    });
    expect(completed).toHaveLength(1);
  });

  it("should get a single job by ID", () => {
    const created = service.createJob("test-auto", { key: "value" });
    const found = service.getJob(created.id);
    expect(found).not.toBeNull();
    expect(found!.id).toBe(created.id);
    expect(found!.context).toEqual({ key: "value" });
  });

  it("should return null for non-existent job", () => {
    expect(service.getJob("nonexistent")).toBeNull();
  });

  // ── reindexAll ──────────────────────────────────────────────────

  it("should reindex all JSONL files into agent.db", async () => {
    // Create some jobs
    service.createJob("test-auto");
    service.createJob("test-auto");

    // Wipe the DB jobs
    db.getDb().prepare("DELETE FROM jobs").run();
    expect(db.listJobs()).toHaveLength(0);

    // Reindex
    const count = await service.reindexAll();
    expect(count).toBe(2);

    // Verify DB has jobs again
    expect(db.listJobs()).toHaveLength(2);
  });

  it("should handle empty automations dir on reindex", async () => {
    const count = await service.reindexAll();
    expect(count).toBe(0);
  });

  it("should handle JSONL from multiple automations on reindex", async () => {
    // Create second automation
    db.upsertAutomation({
      id: "auto-two",
      name: "Two",
      status: "active",
      triggerConfig: JSON.stringify([{ type: "manual" }]),
      created: "2026-03-23T00:00:00Z",
      indexedAt: "2026-03-23T10:00:00Z",
    });

    service.createJob("test-auto");
    service.createJob("auto-two");

    // Wipe DB
    db.getDb().prepare("DELETE FROM jobs").run();

    const count = await service.reindexAll();
    expect(count).toBe(2);

    const jobsAuto1 = db.listJobs({ automationId: "test-auto" });
    expect(jobsAuto1).toHaveLength(1);
    const jobsAuto2 = db.listJobs({ automationId: "auto-two" });
    expect(jobsAuto2).toHaveLength(1);
  });

  // ── getJsonlPath ───────────────────────────────────────────────

  it("should return correct JSONL path", () => {
    const p = service.getJsonlPath("my-automation");
    expect(p).toBe(join(automationsDir, "my-automation.jsonl"));
  });

  // ── Edge cases ─────────────────────────────────────────────────

  it("should create job without context", () => {
    const job = service.createJob("test-auto");
    expect(job.context).toBeUndefined();

    const found = service.getJob(job.id);
    expect(found!.context).toBeUndefined();
  });
});
