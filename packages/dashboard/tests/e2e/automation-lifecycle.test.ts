/**
 * Task 5: Full automation lifecycle — integration test
 *
 * End-to-end: manifest file → sync → DB indexing → executor → handler → job recorded.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { AutomationManager } from "../../src/automations/automation-manager.js";
import { AutomationJobService } from "../../src/automations/automation-job-service.js";
import { AutomationExecutor } from "../../src/automations/automation-executor.js";
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

const { createBrainQuery } = await import("@my-agent/core");

function makeAsyncIterable(messages: any[]) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const msg of messages) {
        yield msg;
      }
    },
  };
}

describe("Full Automation Lifecycle", () => {
  let db: ConversationDatabase;
  let manager: AutomationManager;
  let jobService: AutomationJobService;
  let executor: AutomationExecutor;
  let tempDir: string;
  let automationsDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "lifecycle-"));
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
  });

  afterEach(() => {
    db.close();
    vi.clearAllMocks();
  });

  it("system automation: manifest → sync → DB → executor → handler → job completed", async () => {
    // Write system automation manifest
    writeFileSync(
      join(automationsDir, "test-handler.md"),
      `---
name: Test Handler
status: active
system: true
trigger:
  - type: schedule
    cron: "0 8 * * *"
handler: test-handler
notify: none
autonomy: full
once: false
created: "2026-03-26"
---

# Test Handler

System automation for testing.
`,
      "utf-8",
    );

    // Register mock handler
    const mockHandler: BuiltInHandler = vi.fn(async () => ({
      success: true,
      work: "test output from handler",
      deliverable: null,
    }));
    registerHandler("test-handler", mockHandler);

    // Sync → verify in DB
    await manager.syncAll();
    const dbRow = db.getAutomation("test-handler");
    expect(dbRow).not.toBeNull();
    expect(dbRow!.system).toBe(true);
    expect(dbRow!.handler).toBe("test-handler");

    // Read automation and fire
    const automation = manager.read("test-handler")!;
    const job = jobService.createJob(automation.id);
    const result = await executor.run(automation, job);

    // Verify handler was called, not SDK session
    expect(result.success).toBe(true);
    expect(result.work).toBe("test output from handler");
    expect(mockHandler).toHaveBeenCalledOnce();
    expect(createBrainQuery).not.toHaveBeenCalled();

    // Verify job recorded in DB
    const completedJob = jobService.getJob(job.id);
    expect(completedJob!.status).toBe("completed");
    expect(completedJob!.summary).toContain("test output from handler");
  });

  it("user automation: manifest → sync → DB → executor → SDK session path", async () => {
    // Create user automation (no system, no handler)
    const automation = manager.create({
      name: "User Research",
      instructions: "Research a topic.",
      manifest: {
        trigger: [{ type: "manual" }],
        autonomy: "full",
      },
    });

    // Mock SDK session
    (createBrainQuery as any).mockReturnValue(
      makeAsyncIterable([
        {
          type: "assistant",
          message: {
            content: [
              { type: "text", text: "Research complete. Here are the results." },
            ],
          },
        },
      ]),
    );

    const job = jobService.createJob(automation.id);
    const result = await executor.run(automation, job);

    // Generic fallback adds mandatory items that mock brain can't complete → needs_review (M9.2-S1)
    expect(result.success).toBe(false);
    expect(createBrainQuery).toHaveBeenCalledOnce();

    const completedJob = jobService.getJob(job.id);
    expect(completedJob!.status).toBe("needs_review");
  });

  it("listAutomations with excludeSystem returns only user automations", async () => {
    // Create both types
    writeFileSync(
      join(automationsDir, "system-test.md"),
      `---
name: System Test
status: active
system: true
trigger:
  - type: manual
handler: test-handler
created: "2026-03-26"
---

System.
`,
      "utf-8",
    );
    manager.read("system-test"); // index

    manager.create({
      name: "User Only",
      instructions: "User task.",
      manifest: { trigger: [{ type: "manual" }] },
    });

    const userOnly = manager.list({ excludeSystem: true });
    expect(userOnly.length).toBe(1);
    expect(userOnly[0].manifest.name).toBe("User Only");
  });
});
