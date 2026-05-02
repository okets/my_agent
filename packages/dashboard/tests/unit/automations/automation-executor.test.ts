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

  // Helper: simulate the worker writing a clean deliverable.md to job.run_dir.
  // Post-M9.4-S4.2-fu3 the executor requires the worker to have written one;
  // these tests stub the SDK response so the worker never actually runs the
  // Write tool. We seed the file directly to satisfy the post-run gate.
  function seedWorkerDeliverable(job: Job, content?: string) {
    const fsLib = require("node:fs") as typeof import("node:fs");
    const pathLib = require("node:path") as typeof import("node:path");
    if (!job.run_dir) throw new Error("test setup: job has no run_dir");
    fsLib.mkdirSync(job.run_dir, { recursive: true });
    fsLib.writeFileSync(
      pathLib.join(job.run_dir, "deliverable.md"),
      content ??
        "## Result\n\nThe automation finished its work and produced this clean deliverable. The validator's minimum-length check is satisfied by this paragraph.",
    );
  }

  it("should run an automation and complete the job", async () => {
    const automation = createTestAutomation();
    const job = jobService.createJob(automation.id);
    seedWorkerDeliverable(job);

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
    expect(result.error).toBeUndefined();

    // Verify job was updated — needs_review due to incomplete mandatory items
    const updatedJob = jobService.getJob(job.id);
    expect(updatedJob!.status).toBe("needs_review");
    expect(updatedJob!.summary).toBeTruthy();
  });

  // Test "should extract deliverable from response" was deleted in M9.4-S4.2-fu3.
  // It exercised the legacy <deliverable>...</deliverable> XML-tag extraction
  // path which has been removed (deliverable-utils.ts deleted). The new
  // worker-deliverable contract is covered by the suite below.

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
    seedWorkerDeliverable(job);

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

// ─── M9.4-S4.2-fu3 — worker-deliverable contract invariants ──────────────────

import fs from "node:fs";
import os from "node:os";
import { readAndValidateWorkerDeliverable } from "../../../src/automations/automation-executor.js";

describe("AutomationExecutor — worker-deliverable contract (M9.4-S4.2-fu3)", () => {
  let runDir: string;

  beforeEach(() => {
    runDir = mkdtempSync(join(tmpdir(), "fu3-test-"));
  });

  afterEach(() => {
    fs.rmSync(runDir, { recursive: true, force: true });
  });

  it("preserves worker-written deliverable.md verbatim (no overwrite, no frontmatter sniff)", () => {
    const workerContent =
      "## Sensor Reading\n\n**Reading: 145 (above threshold)**\nMeasurement: ~52 units";
    fs.writeFileSync(join(runDir, "deliverable.md"), workerContent);

    const result = readAndValidateWorkerDeliverable(runDir);

    expect(result).toBe(workerContent);
    // File on disk unchanged
    expect(fs.readFileSync(join(runDir, "deliverable.md"), "utf-8")).toBe(workerContent);
  });

  it("preserves worker-written deliverable.md WITH frontmatter equally", () => {
    const workerContent =
      "---\nchange_type: configure\nsummary: Updated config for the deployment workflow\n---\n\n## Result\n\nThe configuration has been updated to use the new endpoint. Connection test passed; rollout is ready when you are.";
    fs.writeFileSync(join(runDir, "deliverable.md"), workerContent);

    const result = readAndValidateWorkerDeliverable(runDir);

    expect(result).toBe(workerContent);
  });

  it("fails loud when deliverable.md is missing (no fabrication from response stream)", () => {
    expect(() => readAndValidateWorkerDeliverable(runDir)).toThrow(
      /Worker did not write deliverable\.md/i,
    );
    // No file fabricated as a side effect
    expect(fs.existsSync(join(runDir, "deliverable.md"))).toBe(false);
  });

  it("runs deliverable_written validator one more time at job-end (defense in depth)", () => {
    // Contaminated content — would fail the validator regex.
    fs.writeFileSync(
      join(runDir, "deliverable.md"),
      "Let me start by checking my todo list. Now let me look at the data sensors.",
    );

    expect(() => readAndValidateWorkerDeliverable(runDir)).toThrow(
      /Final validator gate failed|narration|stream-of-consciousness|Write tool/i,
    );
  });

  it("does NOT extract or honor any <deliverable> tags in the response stream", () => {
    // The on-disk worker file is the only source of truth. Even if a response
    // somewhere contained `<deliverable>OLD CONTRACT</deliverable>`, the
    // worker's file content wins.
    const workerContent = "## Body\n\nClean content from worker via Write tool.";
    fs.writeFileSync(join(runDir, "deliverable.md"), workerContent);

    const result = readAndValidateWorkerDeliverable(runDir);

    expect(result).toBe(workerContent);
    expect(result).not.toContain("OLD CONTRACT");
  });

  it("validates the file actually written to disk (not some intermediate state)", () => {
    // Guards against any future change that would read from the wrong path.
    const workerContent =
      "## Real Body\n\nThis is what the user actually sees in the brief — substantive enough to clear the validator's minimum-length check.";
    fs.writeFileSync(join(runDir, "deliverable.md"), workerContent);

    const result = readAndValidateWorkerDeliverable(runDir);
    expect(result).toBe(fs.readFileSync(join(runDir, "deliverable.md"), "utf-8"));
  });
});

describe("AutomationExecutor — audit metadata in result.json (M9.4-S4.3 Item F)", () => {
  let runDir: string;

  beforeEach(() => {
    runDir = mkdtempSync(join(tmpdir(), "audit-meta-test-"));
  });

  afterEach(() => {
    fs.rmSync(runDir, { recursive: true, force: true });
  });

  it("buildTranscriptPath encodes the run dir per SDK convention (non-alphanumeric → dash)", async () => {
    const { buildTranscriptPath } = await import(
      "../../../src/automations/automation-executor.js"
    );
    const fakeRunDir =
      "/home/test/my_agent/.my_agent/automations/.runs/foo/job-abc";
    const sessionId = "deadbeef-cafe-1234-5678-abcdefabcdef";
    const transcriptPath = buildTranscriptPath(fakeRunDir, sessionId);
    expect(transcriptPath).toContain(
      "-home-test-my-agent--my-agent-automations--runs-foo-job-abc",
    );
    expect(transcriptPath.endsWith(`${sessionId}.jsonl`)).toBe(true);
    expect(transcriptPath).toContain(".claude/projects/");
  });

  it("creates result.json with audit fields when worker didn't write one (generic/research worker)", async () => {
    const { writeAuditMetadata } = await import(
      "../../../src/automations/automation-executor.js"
    );
    // Worker only wrote deliverable.md; no result.json yet
    fs.writeFileSync(
      join(runDir, "deliverable.md"),
      "## Report\n\nClean content.",
    );
    expect(fs.existsSync(join(runDir, "result.json"))).toBe(false);

    writeAuditMetadata(runDir, "test-session-id-123");

    expect(fs.existsSync(join(runDir, "result.json"))).toBe(true);
    const parsed = JSON.parse(
      fs.readFileSync(join(runDir, "result.json"), "utf-8"),
    );
    expect(parsed.audit).toBeDefined();
    expect(parsed.audit.session_id).toBe("test-session-id-123");
    expect(parsed.audit.transcript_path).toMatch(
      /\.claude\/projects\/.*\.jsonl$/,
    );
  });

  it("MERGES audit fields when worker already wrote result.json (capability worker)", async () => {
    const { writeAuditMetadata } = await import(
      "../../../src/automations/automation-executor.js"
    );
    // Capability worker wrote result.json with structured metadata
    const workerJson = {
      change_type: "configure",
      test_result: "pass",
      summary: "Done",
    };
    fs.writeFileSync(
      join(runDir, "result.json"),
      JSON.stringify(workerJson),
    );

    writeAuditMetadata(runDir, "test-session-id-456");

    const parsed = JSON.parse(
      fs.readFileSync(join(runDir, "result.json"), "utf-8"),
    );
    // Worker's data preserved
    expect(parsed.change_type).toBe("configure");
    expect(parsed.test_result).toBe("pass");
    expect(parsed.summary).toBe("Done");
    // Framework's audit added
    expect(parsed.audit.session_id).toBe("test-session-id-456");
    expect(parsed.audit.transcript_path).toBeDefined();
  });

  it("framework's audit field overwrites any worker-written audit (no merge of audit subkeys)", async () => {
    const { writeAuditMetadata } = await import(
      "../../../src/automations/automation-executor.js"
    );
    // Worker bogusly wrote its own audit field
    fs.writeFileSync(
      join(runDir, "result.json"),
      JSON.stringify({
        change_type: "configure",
        audit: {
          foo: "worker-bogus",
          session_id: "worker-fabricated-id",
        },
      }),
    );

    writeAuditMetadata(runDir, "real-sdk-session-id");

    const parsed = JSON.parse(
      fs.readFileSync(join(runDir, "result.json"), "utf-8"),
    );
    // Worker's other data preserved
    expect(parsed.change_type).toBe("configure");
    // Framework's audit wins entirely (not a deep merge)
    expect(parsed.audit.session_id).toBe("real-sdk-session-id");
    expect(parsed.audit.foo).toBeUndefined();
  });

  it("recovers gracefully when result.json is malformed (overwrites with just audit)", async () => {
    const { writeAuditMetadata } = await import(
      "../../../src/automations/automation-executor.js"
    );
    // Pre-existing malformed JSON
    fs.writeFileSync(join(runDir, "result.json"), "{ this is not valid json");

    writeAuditMetadata(runDir, "test-session-id-789");

    // Should have overwritten with valid JSON containing just audit
    const parsed = JSON.parse(
      fs.readFileSync(join(runDir, "result.json"), "utf-8"),
    );
    expect(parsed.audit.session_id).toBe("test-session-id-789");
  });
});
