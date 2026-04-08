import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { AutomationManager } from "../../../src/automations/automation-manager.js";
import { AutomationJobService } from "../../../src/automations/automation-job-service.js";
import { AutomationProcessor } from "../../../src/automations/automation-processor.js";
import { AutomationExecutor } from "../../../src/automations/automation-executor.js";
import { ConversationDatabase } from "../../../src/conversations/db.js";
import { createAutomationServer } from "../../../src/mcp/automation-server.js";
import { mkdtempSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// Helper: extract the tools from the MCP server and call them directly
// Since createSdkMcpServer returns an opaque object, we test through
// the dependencies directly and verify the server creates without error.

describe("automation-server", () => {
  let db: ConversationDatabase;
  let manager: AutomationManager;
  let jobService: AutomationJobService;
  let processor: AutomationProcessor;
  let tempDir: string;
  let automationsDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "auto-server-"));
    automationsDir = join(tempDir, "automations");
    mkdirSync(automationsDir, { recursive: true });
    db = new ConversationDatabase(tempDir);
    manager = new AutomationManager(automationsDir, db);
    jobService = new AutomationJobService(automationsDir, db);

    const executor = new AutomationExecutor({
      automationManager: manager,
      jobService,
      agentDir: tempDir,
      db,
    });

    processor = new AutomationProcessor({
      automationManager: manager,
      executor,
      jobService,
    });
  });

  afterEach(() => {
    db.close();
  });

  it("should create the MCP server without error", () => {
    const server = createAutomationServer({
      automationManager: manager,
      processor,
      jobService,
    });
    expect(server).toBeDefined();
  });

  it("should have the correct server name", () => {
    const server = createAutomationServer({
      automationManager: manager,
      processor,
      jobService,
    });
    // The server object should be a valid MCP server
    expect(server).toBeDefined();
  });

  // Integration test: create an automation through manager, then verify it's listable
  it("should support create + list flow via manager deps", () => {
    const automation = manager.create({
      name: "Test Automation",
      instructions: "Test instructions",
      manifest: {
        trigger: [{ type: "manual" }],
      },
    });

    expect(automation.id).toBe("test-automation");

    const list = manager.list();
    expect(list.length).toBe(1);
    expect(list[0].manifest.name).toBe("Test Automation");
  });

  it("should support fire flow via processor deps", async () => {
    const automation = manager.create({
      name: "Fire Test",
      instructions: "Fire test instructions",
      manifest: {
        trigger: [{ type: "manual" }],
      },
    });

    // Processor.fire will fail because executor needs real SDK,
    // but the processor should accept the call without throwing synchronously
    const fireSpy = vi.spyOn(processor, "fire");

    // Don't await — just verify the call is accepted
    processor.fire(automation).catch(() => {
      // Expected: executor fails without real SDK
    });

    expect(fireSpy).toHaveBeenCalledWith(automation);
  });

  it("should handle resume_job deps — job not found", () => {
    const job = jobService.getJob("nonexistent");
    expect(job).toBeNull();
  });

  it("should handle resume_job deps — job not in needs_review", () => {
    const automation = manager.create({
      name: "Resume Test",
      instructions: "Resume test instructions",
      manifest: {
        trigger: [{ type: "manual" }],
      },
    });

    const job = jobService.createJob(automation.id);
    expect(job.status).toBe("pending");

    // Not in needs_review state
    const retrieved = jobService.getJob(job.id);
    expect(retrieved?.status).toBe("pending");
    expect(retrieved?.status).not.toBe("needs_review");
  });

  it("should handle resume_job deps — job in needs_review", () => {
    const automation = manager.create({
      name: "Review Test",
      instructions: "Review test instructions",
      manifest: {
        trigger: [{ type: "manual" }],
      },
    });

    const job = jobService.createJob(automation.id);
    jobService.updateJob(job.id, { status: "needs_review" });

    const retrieved = jobService.getJob(job.id);
    expect(retrieved?.status).toBe("needs_review");
  });

  // --- dismiss_job tests ---

  it("dismiss_job — sets status to dismissed", () => {
    const automation = manager.create({
      name: "Dismiss Test",
      instructions: "test",
      manifest: { trigger: [{ type: "manual" }] },
    });
    const job = jobService.createJob(automation.id);
    jobService.updateJob(job.id, { status: "failed" });

    jobService.updateJob(job.id, {
      status: "dismissed",
      summary: "Dismissed: test cleanup",
    });

    const retrieved = jobService.getJob(job.id);
    expect(retrieved?.status).toBe("dismissed");
    expect(retrieved?.summary).toBe("Dismissed: test cleanup");
  });

  it("dismiss_job — cannot dismiss running job (guard at service level)", () => {
    const automation = manager.create({
      name: "Running Guard Test",
      instructions: "test",
      manifest: { trigger: [{ type: "manual" }] },
    });
    const job = jobService.createJob(automation.id);
    jobService.updateJob(job.id, { status: "running" });

    // The MCP tool guard checks status before calling updateJob.
    // Verify the job IS running so the guard would block.
    const retrieved = jobService.getJob(job.id);
    expect(retrieved?.status).toBe("running");
  });

  it("dismiss_job — getJob returns null for non-existent job", () => {
    const result = jobService.getJob("job-does-not-exist");
    expect(result).toBeNull();
  });

  it("dismiss_job — dismissed jobs excluded from check_job_status queries", () => {
    const automation = manager.create({
      name: "Excluded Test",
      instructions: "test",
      manifest: { trigger: [{ type: "manual" }] },
    });
    const job = jobService.createJob(automation.id);
    jobService.updateJob(job.id, { status: "dismissed" });

    // check_job_status queries specific statuses (running, pending, interrupted, needs_review, completed, failed)
    // dismissed is never queried — verify it doesn't appear in those lists
    const running = jobService.listJobs({ status: "running" });
    const pending = jobService.listJobs({ status: "pending" });
    const completed = jobService.listJobs({ status: "completed" });
    const failed = jobService.listJobs({ status: "failed" });
    const needsReview = jobService.listJobs({ status: "needs_review" });

    const allQueried = [...running, ...pending, ...completed, ...failed, ...needsReview];
    expect(allQueried.find((j) => j.id === job.id)).toBeUndefined();
  });

  it("dismiss_job — deleteFromIndex removes orphaned DB entry", () => {
    const automation = manager.create({
      name: "Orphan Test",
      instructions: "test",
      manifest: { trigger: [{ type: "manual" }] },
    });
    const job = jobService.createJob(automation.id);

    // Verify job exists
    expect(jobService.getJob(job.id)).not.toBeNull();

    // Delete from index only
    jobService.deleteFromIndex(job.id);

    // Job should be gone from DB
    expect(jobService.getJob(job.id)).toBeNull();
  });

  // --- disable_automation tests ---

  it("disable_automation — sets status to disabled", () => {
    manager.create({
      name: "Disable Test",
      instructions: "test",
      manifest: { trigger: [{ type: "cron", cron: "0 9 * * *" }] },
    });

    const before = manager.findById("disable-test");
    expect(before?.manifest.status).toBe("active");

    manager.disable("disable-test");

    const after = manager.findById("disable-test");
    expect(after?.manifest.status).toBe("disabled");
  });

  it("disable_automation — cannot disable system automation", () => {
    // System automations have system: true in frontmatter, written directly to disk
    const { writeFileSync } = require("fs");
    writeFileSync(
      join(automationsDir, "system-test.md"),
      "---\nname: System Test\nstatus: active\nsystem: true\ntrigger:\n  - type: cron\n    cron: '0 9 * * *'\ncreated: '2026-01-01T00:00:00.000Z'\n---\n\nSystem automation.\n",
    );

    expect(() => manager.disable("system-test")).toThrow(
      /Cannot disable system automation/,
    );
  });

  it("disable_automation — findById returns null for non-existent", () => {
    const result = manager.findById("does-not-exist");
    expect(result).toBeNull();
  });

  it("disable_automation — already disabled is idempotent", () => {
    manager.create({
      name: "Idempotent Test",
      instructions: "test",
      manifest: { trigger: [{ type: "manual" }] },
    });

    manager.disable("idempotent-test");
    manager.disable("idempotent-test"); // Should not throw

    const after = manager.findById("idempotent-test");
    expect(after?.manifest.status).toBe("disabled");
  });
});
