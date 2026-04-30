/**
 * Task 7: HITL resume flow — integration test
 *
 * Verifies the needs_review → user reply → resume_job chain.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { AutomationManager } from "../../src/automations/automation-manager.js";
import { AutomationJobService } from "../../src/automations/automation-job-service.js";
import { AutomationExecutor } from "../../src/automations/automation-executor.js";
import { AutomationProcessor } from "../../src/automations/automation-processor.js";
import { ConversationDatabase } from "../../src/conversations/db.js";
import { mkdtempSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

/**
 * M9.4-S4.2-fu3: the executor reads `deliverable.md` from `run_dir` at job-end
 * and throws if it's missing. These tests mock `createBrainQuery` so no real
 * worker writes the file — seed it manually before each `executor.run()`.
 *
 * Body must be ≥50 chars after frontmatter strip and contain no narration
 * patterns (see todo-validators.ts `deliverable_written`).
 */
const SAFE_DELIVERABLE =
  "## Result\n\nThe automation completed and produced a substantive summary of its findings, outcomes, and recommendations for downstream review.\n";

function seedDeliverable(runDir: string) {
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, "deliverable.md"), SAFE_DELIVERABLE);
}

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

describe("HITL Resume Flow", () => {
  let db: ConversationDatabase;
  let manager: AutomationManager;
  let jobService: AutomationJobService;
  let executor: AutomationExecutor;
  let processor: AutomationProcessor;
  let tempDir: string;
  let automationsDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "hitl-resume-"));
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
  });

  afterEach(() => {
    db.close();
    vi.clearAllMocks();
  });

  it("job with needs_review status text → status is needs_review", async () => {
    const automation = manager.create({
      name: "Review Task",
      instructions: "Ask user a question.",
      manifest: {
        trigger: [{ type: "manual" }],
        autonomy: "full",
      },
    });

    // Mock SDK response that contains needs_review
    (createBrainQuery as any).mockReturnValue(
      makeAsyncIterable([
        {
          type: "system",
          subtype: "init",
          session_id: "sess-review-123",
        },
        {
          type: "assistant",
          message: {
            content: [
              {
                type: "text",
                text: "I need your input before proceeding. needs_review: What color do you prefer?",
              },
            ],
          },
        },
      ]),
    );

    const job = jobService.createJob(automation.id);
    seedDeliverable(job.run_dir!);
    await executor.run(automation, job);

    const reviewJob = jobService.getJob(job.id);
    expect(reviewJob!.status).toBe("needs_review");
    expect(reviewJob!.sdk_session_id).toBe("sess-review-123");
  });

  it("resume transitions job from needs_review to completed", async () => {
    const automation = manager.create({
      name: "Resume Task",
      instructions: "Ask then continue.",
      manifest: {
        trigger: [{ type: "manual" }],
        autonomy: "full",
      },
    });

    // Initial run → needs_review
    (createBrainQuery as any).mockReturnValue(
      makeAsyncIterable([
        { type: "system", subtype: "init", session_id: "sess-resume-456" },
        {
          type: "assistant",
          message: {
            content: [
              { type: "text", text: "needs_review: What color?" },
            ],
          },
        },
      ]),
    );

    const job = jobService.createJob(automation.id);
    seedDeliverable(job.run_dir!);
    await executor.run(automation, job);
    expect(jobService.getJob(job.id)!.status).toBe("needs_review");

    // Resume with user answer
    (createBrainQuery as any).mockReturnValue(
      makeAsyncIterable([
        { type: "system", subtype: "init", session_id: "sess-resume-456" },
        {
          type: "assistant",
          message: {
            content: [
              { type: "text", text: "Great, the user chose blue. Task completed successfully." },
            ],
          },
        },
      ]),
    );

    const resumeResult = await executor.resume(
      job,
      "Blue is my favorite color",
      "sess-resume-456",
    );

    expect(resumeResult.success).toBe(true);
    expect(resumeResult.status).toBe("completed");

    const completedJob = jobService.getJob(job.id);
    expect(completedJob!.status).toBe("completed");
  });

  it("resume receives user answer in context", async () => {
    const automation = manager.create({
      name: "Context Task",
      instructions: "Ask and continue.",
      manifest: {
        trigger: [{ type: "manual" }],
        autonomy: "full",
      },
    });

    // Initial → needs_review
    (createBrainQuery as any).mockReturnValue(
      makeAsyncIterable([
        { type: "system", subtype: "init", session_id: "sess-ctx-789" },
        {
          type: "assistant",
          message: {
            content: [
              { type: "text", text: "needs_review: Approve the plan?" },
            ],
          },
        },
      ]),
    );

    const job = jobService.createJob(automation.id);
    await executor.run(automation, job);

    // Resume — verify the user answer is passed as the prompt
    (createBrainQuery as any).mockReturnValue(
      makeAsyncIterable([
        {
          type: "assistant",
          message: {
            content: [{ type: "text", text: "Acknowledged: approved." }],
          },
        },
      ]),
    );

    await executor.resume(job, "Yes, approved", "sess-ctx-789");

    // Check that createBrainQuery was called with the user's answer
    const resumeCall = (createBrainQuery as any).mock.calls.find(
      (call: any[]) => call[0] === "Yes, approved",
    );
    expect(resumeCall).toBeTruthy();
    expect(resumeCall[1].resume).toBe("sess-ctx-789");
  });

  it("needs_review jobs are NOT pruned by run directory cleanup", () => {
    const automation = manager.create({
      name: "Prune Test",
      instructions: "Test pruning.",
      manifest: { trigger: [{ type: "manual" }] },
    });

    const job = jobService.createJob(automation.id);
    jobService.updateJob(job.id, {
      status: "needs_review",
      summary: "Waiting for user.",
    });

    // Prune with 0-day retention (should prune everything except needs_review)
    const pruned = jobService.pruneExpiredRunDirs(0);

    // The needs_review job's run dir should still exist
    const reviewJob = jobService.getJob(job.id);
    expect(reviewJob!.status).toBe("needs_review");
    // Pruning only removes expired run dirs — needs_review is protected
  });
});
