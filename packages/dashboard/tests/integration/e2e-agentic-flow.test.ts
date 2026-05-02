/**
 * M9.1-S7 E2E Integration Test: Full Agentic Lifecycle
 *
 * Validates the entire framework chain:
 *   create automation (with todos) → fire → executor assembles todos →
 *   mock worker marks items done → validators run → job completes →
 *   notification created → heartbeat delivers
 *
 * Uses mocked SDK sessions (no real LLM calls) but exercises the full framework path.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { AppHarness } from "./app-harness.js";
import { readTodoFile, writeTodoFile } from "../../src/automations/todo-file.js";
import { assembleJobTodos } from "../../src/automations/todo-templates.js";
import { AutomationProcessor } from "../../src/automations/automation-processor.js";
import { PersistentNotificationQueue } from "../../src/notifications/persistent-queue.js";
import { HeartbeatService } from "../../src/automations/heartbeat-service.js";
import { createTodoTools } from "../../src/mcp/todo-server.js";
import { runValidation } from "../../src/automations/todo-validators.js";

// ---------------------------------------------------------------------------
// Mock SDK boundary — deterministic, no LLM calls
// ---------------------------------------------------------------------------

const mockCreateBrainQuery = vi.fn();

vi.mock("@my-agent/core", async () => {
  const actual = await vi.importActual("@my-agent/core");
  return {
    ...actual,
    createBrainQuery: (...args: unknown[]) => mockCreateBrainQuery(...args),
    loadConfig: vi.fn(() => ({
      model: "claude-sonnet-4-6",
      brainDir: "/tmp/brain",
    })),
    filterSkillsByTools: vi.fn(async () => []),
    cleanupSkillFilters: vi.fn(async () => {}),
  };
});

vi.mock("../../src/automations/working-nina-prompt.js", () => ({
  buildWorkingNinaPrompt: vi.fn(async () => "You are a test worker."),
}));

vi.mock("../../src/utils/timezone.js", () => ({
  resolveTimezone: vi.fn(async () => "UTC"),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a mock async iterable that simulates a brain query response. */
function makeBrainResponse(
  text: string,
  options?: { sessionId?: string; sideEffect?: () => void },
) {
  return async function* () {
    // Emit init message with session ID
    yield {
      type: "system",
      subtype: "init",
      session_id: options?.sessionId ?? "test-session-001",
    };

    // Run side effect (e.g., mark todos done) before emitting response
    if (options?.sideEffect) {
      options.sideEffect();
    }

    // Emit assistant message
    yield {
      type: "assistant",
      message: {
        content: [{ type: "text", text }],
      },
    };
  };
}

function writeAutomationManifest(
  dir: string,
  id: string,
  overrides: Record<string, unknown> = {},
) {
  const frontmatter: Record<string, unknown> = {
    name: overrides.name ?? "Test Automation",
    status: "active",
    trigger: [{ type: "manual" }],
    created: new Date().toISOString(),
    ...overrides,
  };
  const lines = ["---"];
  for (const [key, val] of Object.entries(frontmatter)) {
    if (val === undefined) continue;
    if (Array.isArray(val)) {
      lines.push(`${key}:`);
      for (const item of val) {
        if (typeof item === "object") {
          lines.push(`  - ${Object.entries(item).map(([k, v]) => `${k}: ${v}`).join(", ")}`);
        } else {
          lines.push(`  - ${item}`);
        }
      }
    } else if (typeof val === "object" && val !== null) {
      lines.push(`${key}:`);
      for (const [k, v] of Object.entries(val)) {
        lines.push(`  ${k}: ${v}`);
      }
    } else {
      lines.push(`${key}: ${val}`);
    }
  }
  lines.push("---", "", "Test automation instructions.");
  fs.writeFileSync(path.join(dir, `${id}.md`), lines.join("\n"));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("E2E agentic flow", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-agentic-"));
    mockCreateBrainQuery.mockReset();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // Test 1: Todo assembly produces correct 3-layer list
  // -------------------------------------------------------------------------

  it("assembles 3-layer todo list (delegator + template + baseline)", () => {
    const delegatorTodos = [
      { text: "Add Hebrew language support" },
      { text: "Update config.yaml with new language" },
    ];
    const items = assembleJobTodos(delegatorTodos, "capability_build");

    // Delegator items come first
    expect(items[0].text).toBe("Add Hebrew language support");
    expect(items[0].created_by).toBe("delegator");
    expect(items[0].mandatory).toBe(true);

    expect(items[1].text).toBe("Update config.yaml with new language");
    expect(items[1].created_by).toBe("delegator");

    // Template items follow (M9.4-S4.3: capability_build has 6 items —
    // the deliverable-emit step split into deliverable.md + result.json).
    const frameworkItems = items.filter((i) => i.created_by === "framework");
    expect(frameworkItems.length).toBe(6);
    expect(frameworkItems[0].text).toContain("Read spec");
    expect(frameworkItems[1].text).toContain("CAPABILITY.md");

    // Validated items have validation rules
    const validated = items.filter((i) => i.validation);
    expect(validated.length).toBeGreaterThanOrEqual(3);
    expect(validated.map((i) => i.validation)).toContain(
      "capability_frontmatter",
    );

    // All items have sequential IDs
    items.forEach((item, idx) => {
      expect(item.id).toBe(`t${idx + 1}`);
      expect(item.status).toBe("pending");
    });
  });

  // -------------------------------------------------------------------------
  // Test 2: Full lifecycle — executor + todo gating (happy path)
  // -------------------------------------------------------------------------

  it("completes job when all mandatory todos are done", async () => {
    const harness = await AppHarness.create({
      withAutomations: true,
      agentDir: tmpDir,
    });

    writeAutomationManifest(harness.automationsDir!, "full-lifecycle", {
      name: "Full Lifecycle Test",
      notify: "immediate",
      job_type: "capability_build",
      todos: [{ text: "Custom delegator task" }],
    });
    await harness.automationManager!.syncAll();

    const automation =
      harness.automationManager!.findById("full-lifecycle")!;
    const job = harness.automationJobService!.createJob("full-lifecycle");

    // Mock brain query: simulate worker that marks all todos done
    mockCreateBrainQuery.mockImplementation(() => {
      const todoPath = path.join(job.run_dir!, "todos.json");
      return makeBrainResponse(
        "I completed all the work.",
        {
          sideEffect: () => {
            // Simulate the worker marking all mandatory items as done
            const todos = readTodoFile(todoPath);
            for (const item of todos.items) {
              item.status = "done";
            }
            writeTodoFile(todoPath, todos);

            // M9.4-S4.3 worker contract: deliverable.md (markdown for the user)
            // + result.json (typed metadata for the framework).
            fs.writeFileSync(
              path.join(job.run_dir!, "deliverable.md"),
              "## Result\n\nAll tasks completed and the configuration is now in place. Connection test passed; rollout is ready when you are.\n",
            );
            fs.writeFileSync(
              path.join(job.run_dir!, "result.json"),
              JSON.stringify({
                change_type: "configure",
                test_result: "pass",
                summary: "Configuration applied; smoke green.",
              }),
            );
          },
        },
      )();
    });

    const result = await harness.automationExecutor!.run(automation, job);

    // Job should be completed (not needs_review)
    expect(result.success).toBe(true);
    const finalJob = harness.automationJobService!.getJob(job.id);
    expect(finalJob?.status).toBe("completed");

    // Todo file should have all items done
    const finalTodos = readTodoFile(path.join(job.run_dir!, "todos.json"));
    const mandatoryItems = finalTodos.items.filter((i) => i.mandatory);
    expect(mandatoryItems.every((i) => i.status === "done")).toBe(true);

    // Verify deliverable was written
    expect(fs.existsSync(path.join(job.run_dir!, "deliverable.md"))).toBe(
      true,
    );

    await harness.shutdown();
  });

  // -------------------------------------------------------------------------
  // Test 3: Todo completion gating catches incomplete mandatory items
  // -------------------------------------------------------------------------

  it("gates completion when mandatory todos are incomplete", async () => {
    const harness = await AppHarness.create({
      withAutomations: true,
      agentDir: tmpDir,
    });

    writeAutomationManifest(harness.automationsDir!, "gating-test", {
      name: "Gating Test",
      job_type: "capability_build",
      todos: [{ text: "Custom task" }],
    });
    await harness.automationManager!.syncAll();

    const automation = harness.automationManager!.findById("gating-test")!;
    const job = harness.automationJobService!.createJob("gating-test");

    // Mock brain query: worker produces output but does NOT mark todos done
    mockCreateBrainQuery.mockImplementation(() => {
      return makeBrainResponse(
        "I tried but could not finish everything.\n\n<deliverable>\nPartial work done.\n</deliverable>",
      )();
    });

    const result = await harness.automationExecutor!.run(automation, job);

    // fu3 (2026-04-30): worker did not write a clean deliverable.md, so the
    // executor's fail-loud gate marks the job as failed (not needs_review).
    expect(result.success).toBe(false);
    const finalJob = harness.automationJobService!.getJob(job.id);
    expect(finalJob?.status).toBe("failed");

    await harness.shutdown();
  });

  // -------------------------------------------------------------------------
  // Test 4: Processor creates notification, heartbeat delivers it
  // -------------------------------------------------------------------------

  it("processor enqueues notification and heartbeat delivers", async () => {
    const harness = await AppHarness.create({
      withAutomations: true,
      agentDir: tmpDir,
    });

    writeAutomationManifest(harness.automationsDir!, "notify-test", {
      name: "Notification Test",
      notify: "immediate",
    });
    await harness.automationManager!.syncAll();

    const automation = harness.automationManager!.findById("notify-test")!;

    // Set up notification queue
    const notifDir = path.join(tmpDir, "notifications");
    const queue = new PersistentNotificationQueue(notifDir);

    // Create processor with notification queue
    const processor = new AutomationProcessor({
      automationManager: harness.automationManager!,
      executor: harness.automationExecutor!,
      jobService: harness.automationJobService!,
      agentDir: tmpDir,
      notificationQueue: queue,
    });

    // Mock brain query: successful completion with good deliverable
    mockCreateBrainQuery.mockImplementation(() => {
      return makeBrainResponse(
        "Research complete. The findings are comprehensive and well-documented.\n\n<deliverable>\nDetailed analysis report with all required sections.\n</deliverable>",
      )();
    });

    await processor.executeAndDeliver(automation);

    // Verify notification was enqueued
    const pending = queue.listPending();
    expect(pending).toHaveLength(1);
    // fu3 (2026-04-30): worker mock doesn't write deliverable.md, so the
    // executor fails the job loudly → notification is job_failed.
    expect(pending[0].type).toBe("job_failed");
    expect(pending[0].summary).toContain("Notification Test");
    expect(pending[0].automation_id).toBe("notify-test");

    // Set up heartbeat to deliver the notification
    const mockAlert = vi.fn(async () => ({ status: "delivered" as const }));
    const heartbeat = new HeartbeatService({
      jobService: harness.automationJobService!,
      notificationQueue: queue,
      conversationInitiator: { alert: mockAlert },
      staleThresholdMs: 5 * 60 * 1000,
      tickIntervalMs: 999999,
      capabilityHealthIntervalMs: 999999,
    });

    // Run one heartbeat tick
    await heartbeat.tick();

    // Verify notification was delivered
    expect(mockAlert).toHaveBeenCalledTimes(1);
    expect(queue.listPending()).toHaveLength(0);
    const delivered = fs.readdirSync(path.join(notifDir, "delivered"));
    expect(delivered).toHaveLength(1);

    await harness.shutdown();
  });

  // -------------------------------------------------------------------------
  // Test 5: Stale job detected by heartbeat, notification created
  // -------------------------------------------------------------------------

  it("heartbeat detects stale running job and creates interrupt notification", async () => {
    const harness = await AppHarness.create({
      withAutomations: true,
      agentDir: tmpDir,
    });

    writeAutomationManifest(harness.automationsDir!, "stale-test", {
      name: "Stale Job Test",
    });
    await harness.automationManager!.syncAll();

    // Create a running job with old activity
    const job = harness.automationJobService!.createJob("stale-test");
    harness.automationJobService!.updateJob(job.id, { status: "running" });

    writeTodoFile(path.join(job.run_dir!, "todos.json"), {
      items: [
        {
          id: "t1",
          text: "First task",
          status: "done",
          mandatory: true,
          created_by: "delegator",
        },
        {
          id: "t2",
          text: "Second task",
          status: "in_progress",
          mandatory: true,
          created_by: "framework",
        },
        {
          id: "t3",
          text: "Third task",
          status: "pending",
          mandatory: true,
          created_by: "framework",
        },
      ],
      last_activity: new Date(Date.now() - 6 * 60 * 1000).toISOString(), // 6 min ago (stale)
    });

    // Set up heartbeat
    const notifDir = path.join(tmpDir, "notifications");
    const queue = new PersistentNotificationQueue(notifDir);
    const mockAlert = vi.fn(async () => true);

    const heartbeat = new HeartbeatService({
      jobService: harness.automationJobService!,
      notificationQueue: queue,
      conversationInitiator: { alert: mockAlert },
      staleThresholdMs: 5 * 60 * 1000,
      tickIntervalMs: 999999,
      capabilityHealthIntervalMs: 999999,
      // Single-tick test: bypass the 60s minimum-age gate (production guard only)
      interruptedMinAgeMs: 0,
    });

    await heartbeat.tick();

    // Job should be marked interrupted
    const updatedJob = harness.automationJobService!.getJob(job.id);
    expect(updatedJob?.status).toBe("interrupted");

    // Notification should be created and delivered
    expect(mockAlert).toHaveBeenCalledTimes(1);

    // Notification content should include todo progress
    const alertPrompt = mockAlert.mock.lastCall![0] as string;
    expect(alertPrompt).toContain("1/3");

    await harness.shutdown();
  });

  // -------------------------------------------------------------------------
  // Test 6: Validator rejects todo_update("done") and blocks after 3 failures
  // -------------------------------------------------------------------------

  it("validator rejects marking todo done when validation fails, blocks after 3 attempts", async () => {
    // Set up a todo file with a validated mandatory item
    const jobDir = path.join(tmpDir, "run-validator-test");
    fs.mkdirSync(jobDir, { recursive: true });
    const todoPath = path.join(jobDir, "todos.json");

    writeTodoFile(todoPath, {
      items: [
        {
          id: "t1",
          text: "Write CAPABILITY.md with required frontmatter",
          status: "in_progress",
          mandatory: true,
          created_by: "framework",
          validation: "capability_frontmatter",
        },
      ],
      last_activity: new Date().toISOString(),
    });

    // No CAPABILITY.md exists in targetDir — validator will fail
    const fakeTargetDir = path.join(tmpDir, "fake-capability");
    fs.mkdirSync(fakeTargetDir, { recursive: true });

    const tools = createTodoTools(todoPath, runValidation, fakeTargetDir);

    // Attempt 1: rejected
    const r1 = await tools.todo_update({ id: "t1", status: "done" });
    expect(r1.isError).toBe(true);
    expect(r1.content[0]).toHaveProperty("text");
    expect((r1.content[0] as { text: string }).text).toContain("attempt 1/3");

    // Item should still be in_progress
    let todos = readTodoFile(todoPath);
    expect(todos.items[0].status).toBe("in_progress");
    expect(todos.items[0].validation_attempts).toBe(1);

    // Attempt 2: rejected
    const r2 = await tools.todo_update({ id: "t1", status: "done" });
    expect(r2.isError).toBe(true);
    expect((r2.content[0] as { text: string }).text).toContain("attempt 2/3");

    // Attempt 3: blocked
    const r3 = await tools.todo_update({ id: "t1", status: "done" });
    expect(r3.isError).toBe(true);
    expect((r3.content[0] as { text: string }).text).toContain("blocked");

    // Item should now be blocked with validation failure reason
    todos = readTodoFile(todoPath);
    expect(todos.items[0].status).toBe("blocked");
    expect(todos.items[0].notes).toContain("Validation failed 3 times");
    expect(todos.items[0].notes).toContain("CAPABILITY.md");
  });
});
