import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { AutomationScheduler } from "../../../src/automations/automation-scheduler.js";
import { AutomationJobService } from "../../../src/automations/automation-job-service.js";
import { AutomationManager } from "../../../src/automations/automation-manager.js";
import { ConversationDatabase } from "../../../src/conversations/db.js";
import { mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { mkdirSync } from "fs";
import type { AutomationProcessor } from "../../../src/automations/automation-processor.js";

// Mock timezone resolution
vi.mock("../../../src/utils/timezone.js", () => ({
  resolveTimezone: vi.fn(async () => "UTC"),
}));

describe("AutomationScheduler", () => {
  let db: ConversationDatabase;
  let manager: AutomationManager;
  let jobService: AutomationJobService;
  let mockProcessor: AutomationProcessor;
  let scheduler: AutomationScheduler;
  let tempDir: string;
  let automationsDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "auto-scheduler-"));
    automationsDir = join(tempDir, "automations");
    mkdirSync(automationsDir, { recursive: true });
    db = new ConversationDatabase(tempDir);
    manager = new AutomationManager(automationsDir, db);
    jobService = new AutomationJobService(automationsDir, db);

    mockProcessor = {
      fire: vi.fn(async () => {}),
      isRunning: vi.fn(() => false),
    } as any;

    scheduler = new AutomationScheduler({
      processor: mockProcessor,
      automationManager: manager,
      jobService,
      agentDir: tempDir,
      pollIntervalMs: 100_000, // Don't actually poll in tests
    });
  });

  afterEach(async () => {
    await scheduler.stop();
    db.close();
  });

  // ── isCronDue ───────────────────────────────────────────────────

  it("should return true when cron is due and no prior job exists", () => {
    manager.create({
      name: "Every Minute",
      instructions: "test",
      manifest: {
        trigger: [{ type: "schedule", cron: "* * * * *" }],
      },
    });

    const now = new Date();
    const result = scheduler.isCronDue(
      "* * * * *",
      { id: "every-minute", manifest: {} },
      now,
      "UTC",
    );
    expect(result).toBe(true);
  });

  it("should return false when a recent job exists after the cron tick", () => {
    const automation = manager.create({
      name: "Hourly",
      instructions: "test",
      manifest: {
        trigger: [{ type: "schedule", cron: "0 * * * *" }],
      },
    });

    // Create a job (simulating one that ran recently)
    jobService.createJob(automation.id);

    const now = new Date();
    const result = scheduler.isCronDue(
      "0 * * * *",
      { id: automation.id, manifest: {} },
      now,
      "UTC",
    );
    // The job was created just now, so it should be after the prev cron tick
    expect(result).toBe(false);
  });

  it("should return true when cron is due and last job is old", () => {
    const automation = manager.create({
      name: "Daily",
      instructions: "test",
      manifest: {
        trigger: [{ type: "schedule", cron: "* * * * *" }],
      },
    });

    // Insert an old job directly (from yesterday)
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    db.upsertJob({
      id: "job-old",
      automationId: automation.id,
      status: "completed",
      created: yesterday.toISOString(),
    });

    const now = new Date();
    const result = scheduler.isCronDue(
      "* * * * *",
      { id: automation.id, manifest: {} },
      now,
      "UTC",
    );
    expect(result).toBe(true);
  });

  it("should return false for invalid cron expressions", () => {
    const result = scheduler.isCronDue(
      "invalid cron",
      { id: "test", manifest: {} },
      new Date(),
      "UTC",
    );
    expect(result).toBe(false);
  });

  // ── checkDue ────────────────────────────────────────────────────

  it("should fire due automations on checkDue", async () => {
    manager.create({
      name: "Every Minute",
      instructions: "test",
      manifest: {
        trigger: [{ type: "schedule", cron: "* * * * *" }],
      },
    });

    scheduler["isRunning"] = true;
    await scheduler.checkDue();

    expect(mockProcessor.fire).toHaveBeenCalledTimes(1);
    expect(mockProcessor.fire).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "every-minute",
      }),
      { trigger: "schedule" },
    );
  });

  it("should skip non-schedule triggers", async () => {
    manager.create({
      name: "Manual Only",
      instructions: "test",
      manifest: {
        trigger: [{ type: "manual" }],
      },
    });

    scheduler["isRunning"] = true;
    await scheduler.checkDue();

    expect(mockProcessor.fire).not.toHaveBeenCalled();
  });

  it("should skip disabled automations", async () => {
    const automation = manager.create({
      name: "Disabled Auto",
      instructions: "test",
      manifest: {
        trigger: [{ type: "schedule", cron: "* * * * *" }],
        status: "disabled",
      },
    });

    scheduler["isRunning"] = true;
    await scheduler.checkDue();

    expect(mockProcessor.fire).not.toHaveBeenCalled();
  });

  it("should not fire when not running", async () => {
    manager.create({
      name: "Every Minute",
      instructions: "test",
      manifest: {
        trigger: [{ type: "schedule", cron: "* * * * *" }],
      },
    });

    // isRunning is false by default
    await scheduler.checkDue();

    expect(mockProcessor.fire).not.toHaveBeenCalled();
  });

  // ── getNextRuns ─────────────────────────────────────────────────

  it("should project next runs for scheduled automations", async () => {
    manager.create({
      name: "Hourly Auto",
      instructions: "test",
      manifest: {
        trigger: [{ type: "schedule", cron: "0 * * * *" }],
      },
    });
    manager.create({
      name: "Daily Auto",
      instructions: "test",
      manifest: {
        trigger: [{ type: "schedule", cron: "0 9 * * *" }],
      },
    });

    const runs = await scheduler.getNextRuns(5);
    expect(runs.length).toBeGreaterThanOrEqual(2);
    expect(runs[0].nextRun).toBeInstanceOf(Date);

    // Should be sorted by nextRun
    for (let i = 1; i < runs.length; i++) {
      expect(runs[i].nextRun.getTime()).toBeGreaterThanOrEqual(
        runs[i - 1].nextRun.getTime(),
      );
    }
  });

  it("should skip non-schedule automations in getNextRuns", async () => {
    manager.create({
      name: "Manual Auto",
      instructions: "test",
      manifest: {
        trigger: [{ type: "manual" }],
      },
    });

    const runs = await scheduler.getNextRuns();
    expect(runs).toHaveLength(0);
  });

  it("should respect count limit in getNextRuns", async () => {
    for (let i = 0; i < 5; i++) {
      manager.create({
        name: `Auto ${i}`,
        instructions: "test",
        manifest: {
          trigger: [{ type: "schedule", cron: `${i * 10} * * * *` }],
        },
      });
    }

    const runs = await scheduler.getNextRuns(3);
    expect(runs.length).toBeLessThanOrEqual(3);
  });

  // ── start/stop lifecycle ────────────────────────────────────────

  it("should start and stop without errors", async () => {
    await scheduler.start();
    expect(scheduler["isRunning"]).toBe(true);

    await scheduler.stop();
    expect(scheduler["isRunning"]).toBe(false);
  });
});
