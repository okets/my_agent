import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { AutomationExecutor } from "../../../src/automations/automation-executor.js";
import { AutomationJobService } from "../../../src/automations/automation-job-service.js";
import { AutomationManager } from "../../../src/automations/automation-manager.js";
import { ConversationDatabase } from "../../../src/conversations/db.js";
import { mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { mkdirSync } from "fs";
import type { Automation, Job } from "@my-agent/core";

// Mock external dependencies
vi.mock("@my-agent/core", async () => {
  const actual = await vi.importActual("@my-agent/core");
  return {
    ...actual,
    createBrainQuery: vi.fn(),
    loadConfig: vi.fn(() => ({ model: "claude-sonnet-4-6", brainDir: "/tmp/brain" })),
    filterSkillsByTools: vi.fn(async () => []),
    cleanupSkillFilters: vi.fn(async () => {}),
  };
});

vi.mock("../../../src/tasks/working-nina-prompt.js", () => ({
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

describe("AutomationExecutor", () => {
  let db: ConversationDatabase;
  let manager: AutomationManager;
  let jobService: AutomationJobService;
  let executor: AutomationExecutor;
  let tempDir: string;
  let automationsDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "auto-executor-"));
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

  function createTestAutomation(): Automation {
    return manager.create({
      name: "Test Automation",
      instructions: "Do the thing.",
      manifest: {
        trigger: [{ type: "manual" }],
        autonomy: "full",
      },
    });
  }

  it("should run an automation and complete the job", async () => {
    const automation = createTestAutomation();
    const job = jobService.createJob(automation.id);

    // Mock brain query response
    (createBrainQuery as any).mockReturnValue(
      makeAsyncIterable([
        {
          type: "assistant",
          message: {
            content: [{ type: "text", text: "I completed the automation task successfully." }],
          },
        },
      ]),
    );

    const result = await executor.run(automation, job);

    // Generic fallback adds mandatory items that mocked brain can't complete,
    // so todo gating correctly marks as needs_review (M9.2-S1 behavior change)
    expect(result.success).toBe(false);
    expect(result.work).toContain("completed the automation");
    expect(result.error).toBeUndefined();

    // Verify job was updated — needs_review due to incomplete mandatory items
    const updatedJob = jobService.getJob(job.id);
    expect(updatedJob!.status).toBe("needs_review");
    expect(updatedJob!.summary).toBeTruthy();
  });

  it("should extract deliverable from response", async () => {
    const automation = createTestAutomation();
    const job = jobService.createJob(automation.id);

    (createBrainQuery as any).mockReturnValue(
      makeAsyncIterable([
        {
          type: "assistant",
          message: {
            content: [
              {
                type: "text",
                text: "Working on it...\n<deliverable>Here is the result</deliverable>",
              },
            ],
          },
        },
      ]),
    );

    const result = await executor.run(automation, job);

    // Generic fallback adds mandatory items — needs_review due to incomplete todos
    expect(result.success).toBe(false);
    expect(result.deliverable).toBe("Here is the result");
    expect(result.work).toContain("Working on it");
  });

  it("should handle automation with review autonomy", async () => {
    const automation = manager.create({
      name: "Review Auto",
      instructions: "Plan a migration.",
      manifest: {
        trigger: [{ type: "manual" }],
        autonomy: "review",
      },
    });
    const job = jobService.createJob(automation.id);

    (createBrainQuery as any).mockReturnValue(
      makeAsyncIterable([
        {
          type: "assistant",
          message: {
            content: [{ type: "text", text: "Here is my plan." }],
          },
        },
      ]),
    );

    const result = await executor.run(automation, job);

    // Review autonomy should set needs_review
    expect(result.success).toBe(false);
    const updatedJob = jobService.getJob(job.id);
    expect(updatedJob!.status).toBe("needs_review");
  });

  it("should handle execution failure", async () => {
    const automation = createTestAutomation();
    const job = jobService.createJob(automation.id);

    (createBrainQuery as any).mockReturnValue(
      makeAsyncIterable([]),
    );

    // Make the async iteration throw
    (createBrainQuery as any).mockImplementation(() => ({
      async *[Symbol.asyncIterator]() {
        throw new Error("SDK connection failed");
      },
    }));

    const result = await executor.run(automation, job);

    expect(result.success).toBe(false);
    expect(result.error).toBe("SDK connection failed");

    const updatedJob = jobService.getJob(job.id);
    expect(updatedJob!.status).toBe("failed");
    expect(updatedJob!.summary).toContain("SDK connection failed");
  });

  it("should pass trigger context to automation context", async () => {
    const automation = createTestAutomation();
    const job = jobService.createJob(automation.id, { trigger: "schedule" });

    (createBrainQuery as any).mockReturnValue(
      makeAsyncIterable([
        {
          type: "assistant",
          message: {
            content: [{ type: "text", text: "Done." }],
          },
        },
      ]),
    );

    await executor.run(automation, job, { trigger: "schedule" });

    // Verify createBrainQuery was called with correct params
    expect(createBrainQuery).toHaveBeenCalledTimes(1);
    const callArgs = (createBrainQuery as any).mock.calls[0];
    expect(callArgs[1].systemPrompt).toContain("Trigger Context");
    expect(callArgs[1].systemPrompt).toContain("schedule");
  });

  it("should use automation model override", async () => {
    const automation = manager.create({
      name: "Opus Auto",
      instructions: "Do important work.",
      manifest: {
        trigger: [{ type: "manual" }],
        model: "claude-opus-4-6",
      },
    });
    const job = jobService.createJob(automation.id);

    (createBrainQuery as any).mockReturnValue(
      makeAsyncIterable([
        {
          type: "assistant",
          message: {
            content: [{ type: "text", text: "Done." }],
          },
        },
      ]),
    );

    await executor.run(automation, job);

    const callArgs = (createBrainQuery as any).mock.calls[0];
    expect(callArgs[1].model).toBe("claude-opus-4-6");
  });

  it("should capture SDK session ID", async () => {
    const automation = createTestAutomation();
    const job = jobService.createJob(automation.id);

    (createBrainQuery as any).mockReturnValue(
      makeAsyncIterable([
        {
          type: "system",
          subtype: "init",
          session_id: "sess-test-123",
        },
        {
          type: "assistant",
          message: {
            content: [{ type: "text", text: "Done." }],
          },
        },
      ]),
    );

    await executor.run(automation, job);

    const updatedJob = jobService.getJob(job.id);
    expect(updatedJob!.sdk_session_id).toBe("sess-test-123");
  });

  it("should include autonomy instructions in system prompt", async () => {
    const automation = manager.create({
      name: "Cautious Auto",
      instructions: "Handle money.",
      manifest: {
        trigger: [{ type: "manual" }],
        autonomy: "cautious",
      },
    });
    const job = jobService.createJob(automation.id);

    (createBrainQuery as any).mockReturnValue(
      makeAsyncIterable([
        {
          type: "assistant",
          message: {
            content: [{ type: "text", text: "Done." }],
          },
        },
      ]),
    );

    await executor.run(automation, job);

    const callArgs = (createBrainQuery as any).mock.calls[0];
    expect(callArgs[1].systemPrompt).toContain("Autonomy: Cautious");
  });
});
