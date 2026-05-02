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
          summary: "Mock execution completed successfully",
        });
        return {
          success: true,
          work: "Mock execution completed successfully",
          // M9.4-S4.3 Item E: heuristic now reads result.deliverable; mock provides
          // a substantive deliverable so unrelated tests don't trip the downgrade.
          deliverable: "Mock execution completed — substantive deliverable content for tests.",
        };
      }),
    } as any;

    onJobEvent = vi.fn();

    processor = new AutomationProcessor({
      automationManager: manager,
      executor: mockExecutor,
      jobService,
      agentDir: tempDir,
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
      agentDir: tempDir,
      onJobEvent,
      conversationInitiator: {
        alert: mockAlert,
        initiate: mockInitiate,
      },
    });

    await processorWithCi.fire(automation);

    expect(mockAlert).toHaveBeenCalledTimes(1);
    expect(mockAlert.mock.calls[0][0]).toContain("[job_completed]");
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
      agentDir: tempDir,
      onJobEvent,
      conversationInitiator: {
        alert: mockAlert,
        initiate: vi.fn(async () => {}),
      },
    });

    await processorWithCi.fire(automation);

    expect(mockAlert).toHaveBeenCalledTimes(1);
    expect(mockAlert.mock.calls[0][0]).toContain("[job_needs_review]");
  });

  describe("M9.4-S5 drainNow fast-path", () => {
    it("calls heartbeat.drainNow() after enqueueing a notification", async () => {
      const automation = createTestAutomation({ notify: "immediate" });
      const enqueue = vi.fn();
      const queue = {
        enqueue,
        listPending: () => [],
        markDelivered: vi.fn(),
        incrementAttempts: vi.fn(),
      } as any;
      const drainNow = vi.fn().mockResolvedValue(undefined);

      const processorWithHb = new AutomationProcessor({
        automationManager: manager,
        executor: mockExecutor,
        jobService,
        agentDir: tempDir,
        notificationQueue: queue,
      });
      processorWithHb.setHeartbeat({ drainNow });

      await processorWithHb.fire(automation);

      expect(enqueue).toHaveBeenCalledTimes(1);
      expect(drainNow).toHaveBeenCalledTimes(1);
    });

    it("works without a heartbeat reference (degraded mode)", async () => {
      const automation = createTestAutomation({ notify: "immediate" });
      const enqueue = vi.fn();
      const queue = {
        enqueue,
        listPending: () => [],
        markDelivered: vi.fn(),
        incrementAttempts: vi.fn(),
      } as any;

      const processorNoHb = new AutomationProcessor({
        automationManager: manager,
        executor: mockExecutor,
        jobService,
        agentDir: tempDir,
        notificationQueue: queue,
      });
      // No setHeartbeat call

      await expect(processorNoHb.fire(automation)).resolves.not.toThrow();
      expect(enqueue).toHaveBeenCalledTimes(1);
    });
  });

  describe("M9.4-S4.3 Item E — empty-deliverable heuristic reads on-disk truth", () => {
    it("does NOT downgrade success when result.work is empty but result.deliverable is substantive (post-fu1 anti-narration)", async () => {
      const automation = createTestAutomation({});
      const cleanDeliverable = "## Report\n\n**AQI: 145 (Unhealthy for Sensitive Groups)**\nPM2.5: 52 µg/m³. Advisory follows: keep windows closed during morning hours.";
      mockExecutor.run = vi.fn(async (_a, job) => {
        jobService.updateJob(job.id, {
          status: "completed",
          completed: new Date().toISOString(),
          summary: "ok",
        });
        return {
          success: true,
          work: "",  // anti-narration directive working — model emitted no text-block stream
          deliverable: cleanDeliverable,
          screenshotIds: [],
        };
      }) as any;

      await processor.fire(automation);

      const job = jobService.listJobs(automation.id)[0];
      expect(job.status).toBe("completed");
      expect(job.status).not.toBe("failed");
    });

    it("DOES downgrade when both result.work AND result.deliverable are empty (heuristic still catches real misses)", async () => {
      const automation = createTestAutomation({});
      mockExecutor.run = vi.fn(async (_a, job) => {
        jobService.updateJob(job.id, {
          status: "completed",
          completed: new Date().toISOString(),
          summary: "ok",
        });
        return {
          success: true,
          work: "",
          deliverable: "",
          screenshotIds: [],
        };
      }) as any;

      await processor.fire(automation);

      const job = jobService.listJobs(automation.id)[0];
      expect(job.status).toBe("failed");
      expect(job.summary).toMatch(/empty deliverable/i);
    });

    it("DOES downgrade when result.deliverable is whitespace-only (≤20 chars after trim)", async () => {
      const automation = createTestAutomation({});
      mockExecutor.run = vi.fn(async (_a, job) => {
        jobService.updateJob(job.id, {
          status: "completed",
          completed: new Date().toISOString(),
          summary: "ok",
        });
        return {
          success: true,
          work: "verbose model thinking that doesn't matter",
          deliverable: "    \n  \n",
          screenshotIds: [],
        };
      }) as any;

      await processor.fire(automation);

      const job = jobService.listJobs(automation.id)[0];
      expect(job.status).toBe("failed");
    });

    it("does NOT downgrade handler-based automation with success: true and deliverable: null (handler-skip)", async () => {
      // Handlers (manifest.handler set) are authoritative — they don't go through
      // the worker-deliverable contract; the heuristic must not second-guess them.
      // (Note: manager.create() omits the `handler` field today; production
      // handler-based automations are loaded via frontmatterToManifest from .md
      // files. We patch the manifest directly here to exercise the heuristic's
      // skip clause without depending on the manager's create-vs-read asymmetry.)
      const automation = createTestAutomation({});
      (automation.manifest as any).handler = "monthly-summary";

      mockExecutor.run = vi.fn(async (_a, job) => {
        jobService.updateJob(job.id, {
          status: "completed",
          completed: new Date().toISOString(),
          summary: "Quiet month.",
        });
        return {
          success: true,
          work: "Quiet month.",   // legitimately short
          deliverable: null,       // handler returns no on-disk deliverable
          screenshotIds: [],
        };
      }) as any;

      await processor.fire(automation);

      const job = jobService.listJobs(automation.id)[0];
      expect(job.status).toBe("completed");
    });
  });
});
