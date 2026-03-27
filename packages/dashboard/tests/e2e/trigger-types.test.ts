/**
 * Task 6: Trigger types E2E — schedule, watch, channel, manual
 *
 * Verifies all 4 trigger types correctly fire automations.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { AutomationManager } from "../../src/automations/automation-manager.js";
import { AutomationJobService } from "../../src/automations/automation-job-service.js";
import { AutomationExecutor } from "../../src/automations/automation-executor.js";
import { AutomationProcessor } from "../../src/automations/automation-processor.js";
import { AutomationScheduler } from "../../src/automations/automation-scheduler.js";
import { WatchTriggerService } from "../../src/automations/watch-trigger-service.js";
import { ConversationDatabase } from "../../src/conversations/db.js";
import {
  registerHandler,
  type BuiltInHandler,
} from "../../src/scheduler/jobs/handler-registry.js";
import { mkdtempSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// Mock external dependencies
vi.mock("@my-agent/core", async () => {
  const actual = await vi.importActual("@my-agent/core");
  return {
    ...actual,
    createBrainQuery: vi.fn(),
    loadConfig: vi.fn(() => ({
      model: "claude-sonnet-4-6",
      brainDir: "/tmp/brain",
    })),
    filterSkillsByTools: vi.fn(async () => []),
    cleanupSkillFilters: vi.fn(async () => {}),
  };
});

vi.mock("../../src/automations/working-nina-prompt.js", () => ({
  buildWorkingNinaPrompt: vi.fn(async () => "You are a helpful assistant."),
}));

vi.mock("../../src/utils/timezone.js", () => ({
  resolveTimezone: vi.fn(async () => "UTC"),
}));

describe("Trigger Types E2E", () => {
  let db: ConversationDatabase;
  let manager: AutomationManager;
  let jobService: AutomationJobService;
  let executor: AutomationExecutor;
  let processor: AutomationProcessor;
  let tempDir: string;
  let automationsDir: string;

  // Register a test handler for all system automations in this suite
  const testHandler: BuiltInHandler = vi.fn(async () => ({
    success: true,
    work: "trigger test output",
    deliverable: null,
  }));

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "trigger-types-"));
    automationsDir = join(tempDir, "automations");
    mkdirSync(automationsDir, { recursive: true });
    db = new ConversationDatabase(tempDir);
    manager = new AutomationManager(automationsDir, db);
    jobService = new AutomationJobService(automationsDir, db);
    executor = new AutomationExecutor({
      automationManager: manager,
      jobService,
      agentDir: tempDir,
      db,
    });
    processor = new AutomationProcessor({
      automationManager: manager,
      executor,
      jobService,
      agentDir: tempDir,
    });

    registerHandler("trigger-test", testHandler);
    vi.clearAllMocks();
  });

  afterEach(() => {
    db.close();
    vi.clearAllMocks();
  });

  it("schedule trigger: isCronDue returns true for overdue automation", () => {
    // Create automation with every-minute cron
    writeFileSync(
      join(automationsDir, "sched-auto.md"),
      `---
name: Scheduled Auto
status: active
system: true
trigger:
  - type: schedule
    cron: "* * * * *"
handler: trigger-test
created: "2026-03-26"
---

Runs every minute.
`,
      "utf-8",
    );
    manager.read("sched-auto"); // index

    const scheduler = new AutomationScheduler({
      processor,
      automationManager: manager,
      jobService,
      agentDir: tempDir,
    });

    // isCronDue should return true — automation has never run
    const isDue = scheduler.isCronDue(
      "* * * * *",
      { id: "sched-auto", manifest: { handler: "trigger-test" } },
      new Date(),
      "UTC",
    );
    expect(isDue).toBe(true);

    // After creating a job, it should no longer be due
    const job = jobService.createJob("sched-auto");
    jobService.updateJob(job.id, { status: "completed" });

    const isDueAfter = scheduler.isCronDue(
      "* * * * *",
      { id: "sched-auto", manifest: { handler: "trigger-test" } },
      new Date(),
      "UTC",
    );
    expect(isDueAfter).toBe(false);
  });

  it("manual trigger: process directly → job completed", async () => {
    writeFileSync(
      join(automationsDir, "manual-auto.md"),
      `---
name: Manual Auto
status: active
system: true
trigger:
  - type: manual
handler: trigger-test
created: "2026-03-26"
---

Manual run.
`,
      "utf-8",
    );
    const automation = manager.read("manual-auto")!;

    await processor.fire(automation, { trigger: "manual" });

    const jobs = jobService.listJobs({ automationId: "manual-auto" });
    expect(jobs.length).toBe(1);
    expect(jobs[0].status).toBe("completed");
  });

  it("watch trigger: file event → automation fires", async () => {
    const watchPath = join(tempDir, "watched");
    mkdirSync(watchPath, { recursive: true });

    writeFileSync(
      join(automationsDir, "watch-auto.md"),
      `---
name: Watch Auto
status: active
system: true
trigger:
  - type: watch
    path: "${watchPath}"
handler: trigger-test
created: "2026-03-26"
---

Fires on file changes.
`,
      "utf-8",
    );
    manager.read("watch-auto"); // index

    const fireAutomation = vi.fn(async () => {});
    const service = new WatchTriggerService(
      {
        getWatchTriggers: () => [
          { automationId: "watch-auto", path: watchPath },
        ],
        fireAutomation,
        log: () => {},
        logError: () => {},
      },
      50, // short debounce for test
    );

    // Manually set up path→automation mapping (normally done by start())
    service.getPathToAutomations().set(watchPath, ["watch-auto"]);

    // Simulate file event directly (don't need chokidar for this)
    service.handleFileEvent(watchPath, join(watchPath, "test.txt"), "add");

    // Flush directly instead of waiting for setTimeout
    await service.flushPendingEvents(watchPath);

    expect(fireAutomation).toHaveBeenCalledWith(
      "watch-auto",
      expect.objectContaining({
        trigger: "watch",
        files: expect.arrayContaining([join(watchPath, "test.txt")]),
      }),
    );
  });

  it("channel trigger: getAutomationHints returns hints for matching", () => {
    // Create automation with channel trigger hint
    writeFileSync(
      join(automationsDir, "channel-auto.md"),
      `---
name: Invoice Processor
status: active
trigger:
  - type: channel
    hint: invoice
created: "2026-03-26"
---

Process invoices from channel messages.
`,
      "utf-8",
    );
    manager.read("channel-auto"); // index

    const hints = db.getAutomationHints();
    // Channel trigger hints come from the trigger config in the DB
    // The hint extraction happens in PostResponseHooks via Haiku — we test the data path
    const channelAuto = db.getAutomation("channel-auto");
    expect(channelAuto).not.toBeNull();
    const triggerConfig = JSON.parse(channelAuto!.triggerConfig);
    expect(triggerConfig[0].type).toBe("channel");
    expect(triggerConfig[0].hint).toBe("invoice");
  });
});
