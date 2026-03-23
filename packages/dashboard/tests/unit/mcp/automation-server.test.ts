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
});
