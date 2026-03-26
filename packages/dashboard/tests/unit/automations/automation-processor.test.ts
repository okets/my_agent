import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { AutomationProcessor } from "../../../src/automations/automation-processor.js";
import { AutomationJobService } from "../../../src/automations/automation-job-service.js";
import { AutomationManager } from "../../../src/automations/automation-manager.js";
import { ConversationDatabase } from "../../../src/conversations/db.js";
import { mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { mkdirSync } from "fs";
import type { Automation } from "@my-agent/core";
import type { AutomationExecutor, ExecutionResult } from "../../../src/automations/automation-executor.js";

describe("AutomationProcessor", () => {
  let db: ConversationDatabase;
  let manager: AutomationManager;
  let jobService: AutomationJobService;
  let mockExecutor: AutomationExecutor;
  let processor: AutomationProcessor;
  let tempDir: string;
  let automationsDir: string;
  let onJobEvent: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "auto-processor-"));
    automationsDir = join(tempDir, "automations");
    mkdirSync(automationsDir, { recursive: true });
    db = new ConversationDatabase(tempDir);
    manager = new AutomationManager(automationsDir, db);
    jobService = new AutomationJobService(automationsDir, db);

    mockExecutor = {
      run: vi.fn(async (_automation, job): Promise<ExecutionResult> => {
        jobService.updateJob(job.id, {
          status: "completed",
          completed: new Date().toISOString(),
          summary: "Mock execution completed",
        });
        return {
          success: true,
          work: "Did the work",
          deliverable: null,
        };
      }),
    } as any;

    onJobEvent = vi.fn();

    processor = new AutomationProcessor({
      automationManager: manager,
      executor: mockExecutor,
      jobService,
      onJobEvent,
    });
  });

  afterEach(() => {
    db.close();
  });

  function createTestAutomation(
    overrides?: Partial<Parameters<typeof manager.create>[0]["manifest"]>,
  ): Automation {
    return manager.create({
      name: "Test Auto",
      instructions: "Do the thing.",
      manifest: {
        trigger: [{ type: "manual" }],
        ...overrides,
      },
    });
  }

  it("should fire an automation and create a job", async () => {
    const automation = createTestAutomation();

    await processor.fire(automation, { trigger: "manual" });

    expect(mockExecutor.run).toHaveBeenCalledTimes(1);
    expect(onJobEvent).toHaveBeenCalled();

    const jobs = jobService.listJobs({ automationId: automation.id });
    expect(jobs).toHaveLength(1);
  });

  it("should prevent concurrent execution of same automation", async () => {
    const automation = createTestAutomation();

    // Make executor slow
    let resolveExecution: () => void;
    const executionPromise = new Promise<void>((r) => {
      resolveExecution = r;
    });

    (mockExecutor.run as any).mockImplementation(
      async (_auto: any, job: any): Promise<ExecutionResult> => {
        await executionPromise;
        jobService.updateJob(job.id, {
          status: "completed",
          completed: new Date().toISOString(),
        });
        return { success: true, work: "done", deliverable: null };
      },
    );

    // Fire twice
    const fire1 = processor.fire(automation);
    const fire2 = processor.fire(automation);

    // Second should skip
    await fire2;
    expect(mockExecutor.run).toHaveBeenCalledTimes(1);

    // Complete first
    resolveExecution!();
    await fire1;
  });

  it("should disable automation after success when once=true", async () => {
    const automation = createTestAutomation({ once: true });

    await processor.fire(automation);

    const dbRow = db.getAutomation(automation.id);
    expect(dbRow!.status).toBe("disabled");
  });

  it("should not disable automation when once=false", async () => {
    const automation = createTestAutomation({ once: false });

    await processor.fire(automation);

    const dbRow = db.getAutomation(automation.id);
    expect(dbRow!.status).toBe("active");
  });

  it("should not disable automation on failure even with once=true", async () => {
    const automation = createTestAutomation({ once: true });

    (mockExecutor.run as any).mockImplementation(
      async (_auto: any, job: any): Promise<ExecutionResult> => {
        jobService.updateJob(job.id, {
          status: "failed",
          completed: new Date().toISOString(),
        });
        return { success: false, work: "", deliverable: null, error: "boom" };
      },
    );

    await processor.fire(automation);

    const dbRow = db.getAutomation(automation.id);
    expect(dbRow!.status).toBe("active");
  });

  it("should call onJobMutated callback", async () => {
    const automation = createTestAutomation();

    await processor.fire(automation);

    expect(onJobEvent).toHaveBeenCalled();
  });

  it("should report isRunning status correctly", async () => {
    const automation = createTestAutomation();

    let resolveExecution: () => void;
    const executionPromise = new Promise<void>((r) => {
      resolveExecution = r;
    });

    (mockExecutor.run as any).mockImplementation(
      async (_auto: any, job: any): Promise<ExecutionResult> => {
        await executionPromise;
        jobService.updateJob(job.id, {
          status: "completed",
          completed: new Date().toISOString(),
        });
        return { success: true, work: "done", deliverable: null };
      },
    );

    expect(processor.isRunning(automation.id)).toBe(false);

    const firePromise = processor.fire(automation);
    expect(processor.isRunning(automation.id)).toBe(true);

    resolveExecution!();
    await firePromise;
    expect(processor.isRunning(automation.id)).toBe(false);
  });

  it("should notify immediately when notify=immediate and ci available", async () => {
    const automation = createTestAutomation({ notify: "immediate" });

    const mockAlert = vi.fn(async () => true);
    const mockInitiate = vi.fn(async () => {});

    const processorWithCi = new AutomationProcessor({
      automationManager: manager,
      executor: mockExecutor,
      jobService,
      onJobEvent,
      conversationInitiator: {
        alert: mockAlert,
        initiate: mockInitiate,
      },
    });

    await processorWithCi.fire(automation);

    expect(mockAlert).toHaveBeenCalledTimes(1);
    expect(mockAlert.mock.calls[0][0]).toContain("just finished");
  });

  it("should notify on needs_review regardless of notify setting", async () => {
    const automation = createTestAutomation({ notify: "none" });

    (mockExecutor.run as any).mockImplementation(
      async (_auto: any, job: any): Promise<ExecutionResult> => {
        jobService.updateJob(job.id, {
          status: "needs_review",
          summary: "Need approval",
        });
        return { success: false, work: "plan", deliverable: null };
      },
    );

    const mockAlert = vi.fn(async () => true);

    const processorWithCi = new AutomationProcessor({
      automationManager: manager,
      executor: mockExecutor,
      jobService,
      onJobEvent,
      conversationInitiator: {
        alert: mockAlert,
        initiate: vi.fn(async () => {}),
      },
    });

    await processorWithCi.fire(automation);

    expect(mockAlert).toHaveBeenCalledTimes(1);
    expect(mockAlert.mock.calls[0][0]).toContain("needs the user's input");
  });
});
