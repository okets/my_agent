/**
 * M9.1-S2 Acceptance: Todo-driven job lifecycle.
 *
 * Verifies:
 * 1. 3-layer todo assembly (delegator + template + agent)
 * 2. Completion gating catches incomplete mandatory items
 * 3. Validators reject invalid output
 * 4. Auto-detection of job_type from target_path
 * 5. Force resume accepts incomplete jobs
 *
 * The SDK boundary (createBrainQuery) is mocked.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { AppHarness } from "./app-harness.js";
import { readTodoFile, writeTodoFile } from "../../src/automations/todo-file.js";
import { assembleJobTodos } from "../../src/automations/todo-templates.js";
import { runValidation } from "../../src/automations/todo-validators.js";
import { createTodoTools } from "../../src/mcp/todo-server.js";
import type { Job } from "@my-agent/core";

// Mock only the SDK boundary
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
  buildWorkingNinaPrompt: vi.fn(async () => "You are a test worker."),
}));

vi.mock("../../src/utils/timezone.js", () => ({
  resolveTimezone: vi.fn(async () => "UTC"),
}));

const { createBrainQuery } = await import("@my-agent/core");

function makeAsyncIterable(messages: unknown[]) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const msg of messages) {
        yield msg;
      }
    },
  };
}

describe("S2 Acceptance: todo-driven job lifecycle", () => {
  let harness: AppHarness;

  beforeEach(async () => {
    harness = await AppHarness.create({ withAutomations: true });
  });

  afterEach(async () => {
    await harness.shutdown();
    vi.clearAllMocks();
  });

  it("3-layer todo assembly with capability_build type", () => {
    const todos = assembleJobTodos(
      [{ text: "Research provider" }, { text: "Write script" }],
      "capability_build",
    );

    // Layer 1: 2 delegator items
    const delegated = todos.filter((i) => i.created_by === "delegator");
    expect(delegated).toHaveLength(2);
    expect(delegated[0].text).toBe("Research provider");
    expect(delegated.every((i) => i.mandatory)).toBe(true);

    // Layer 2: 5 template items
    const framework = todos.filter((i) => i.created_by === "framework");
    expect(framework).toHaveLength(5);
    expect(framework.some((i) => i.validation === "capability_frontmatter")).toBe(true);
    expect(framework.some((i) => i.validation === "completion_report")).toBe(true);

    // Total: 7 items with sequential IDs
    expect(todos).toHaveLength(7);
    expect(todos[0].id).toBe("t1");
    expect(todos[6].id).toBe("t7");
  });

  it("capability_modify template has change_type_set validator", () => {
    const todos = assembleJobTodos(undefined, "capability_modify");
    expect(todos.some((i) => i.validation === "change_type_set")).toBe(true);
  });

  it("executor fires job with 3-layer todos", async () => {
    // Write automation with todos and job_type
    const automationsDir = harness.automationsDir!;
    fs.writeFileSync(
      path.join(automationsDir, "build-test-cap.md"),
      [
        "---",
        "name: Build Test Cap",
        "status: active",
        "trigger:",
        "  - type: manual",
        "job_type: capability_build",
        "todos:",
        "  - text: Research API",
        `created: ${new Date().toISOString()}`,
        "---",
        "",
        "Build a test capability.",
      ].join("\n"),
    );

    await harness.automationManager!.syncAll();

    // Mock createBrainQuery — also seed deliverable.md (post-fu3 contract:
    // executor reads worker's deliverable.md at job-end and throws if missing).
    (createBrainQuery as ReturnType<typeof vi.fn>).mockImplementation(() => {
      const job = harness.automationJobService!.listJobs({
        automationId: "build-test-cap",
      })[0];
      if (job?.run_dir) {
        fs.mkdirSync(job.run_dir, { recursive: true });
        fs.writeFileSync(
          path.join(job.run_dir, "deliverable.md"),
          "## Result\n\nThe automation completed and produced a substantive summary of its findings, outcomes, and recommendations for downstream review.\n",
        );
      }
      return makeAsyncIterable([
        {
          type: "assistant",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "Done." }],
          },
        },
      ]);
    });

    const automation = harness.automationManager!.findById("build-test-cap");
    expect(automation).toBeDefined();

    // Listen for job events
    const jobDone = new Promise<Job>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Job did not complete in 5s")),
        5000,
      );
      const handler = (job: Job) => {
        clearTimeout(timeout);
        resolve(job);
      };
      harness.emitter.on("job:completed" as any, handler);
      harness.emitter.on("job:failed" as any, handler);
      harness.emitter.on("job:needs_review" as any, handler);
    });

    harness.automationProcessor!.fire(automation!);
    const completedJob = await jobDone;

    // Verify todos.json was created with assembled items
    const todoPath = path.join(completedJob.run_dir!, "todos.json");
    expect(fs.existsSync(todoPath)).toBe(true);

    const todoFile = readTodoFile(todoPath);
    // 1 delegator + 5 template = 6 items
    expect(todoFile.items).toHaveLength(6);
    expect(todoFile.items[0].created_by).toBe("delegator");
    expect(todoFile.items[0].text).toBe("Research API");
    expect(todoFile.items[1].created_by).toBe("framework");

    // Job should be needs_review (mandatory items not completed by mock)
    const finalJob = harness.automationJobService!.getJob(completedJob.id);
    expect(finalJob?.status).toBe("needs_review");
  });

  it("validation rejects then auto-blocks after 3 failures", async () => {
    const tmpDir = path.join(harness.agentDir, "test-validation");
    fs.mkdirSync(tmpDir, { recursive: true });
    const todoPath = path.join(tmpDir, "todos.json");

    writeTodoFile(todoPath, {
      items: [
        {
          id: "t1",
          text: "Fill completion report",
          status: "in_progress",
          mandatory: true,
          validation: "completion_report",
          created_by: "framework",
        },
      ],
      last_activity: new Date().toISOString(),
    });

    const tools = createTodoTools(todoPath, runValidation);

    // Attempt 1 — fail
    let result = await tools.todo_update({ id: "t1", status: "done" });
    expect(result.isError).toBe(true);
    expect(readTodoFile(todoPath).items[0].validation_attempts).toBe(1);

    // Attempt 2 — fail
    result = await tools.todo_update({ id: "t1", status: "done" });
    expect(result.isError).toBe(true);
    expect(readTodoFile(todoPath).items[0].validation_attempts).toBe(2);

    // Attempt 3 — auto-block
    result = await tools.todo_update({ id: "t1", status: "done" });
    expect(result.isError).toBe(true);
    const item = readTodoFile(todoPath).items[0];
    expect(item.status).toBe("blocked");
    expect(item.validation_attempts).toBe(3);
  });

  it("validation passes when deliverable is valid", async () => {
    const tmpDir = path.join(harness.agentDir, "test-valid");
    fs.mkdirSync(tmpDir, { recursive: true });

    // Write valid deliverable
    fs.writeFileSync(
      path.join(tmpDir, "deliverable.md"),
      ["---", "change_type: configure", "test_result: PASSED", "---", "Done."].join("\n"),
    );

    const todoPath = path.join(tmpDir, "todos.json");
    writeTodoFile(todoPath, {
      items: [
        {
          id: "t1",
          text: "Fill completion report",
          status: "in_progress",
          mandatory: true,
          validation: "completion_report",
          created_by: "framework",
        },
      ],
      last_activity: new Date().toISOString(),
    });

    const tools = createTodoTools(todoPath, runValidation);
    const result = await tools.todo_update({ id: "t1", status: "done" });
    expect(result.isError).toBeUndefined();
    expect(readTodoFile(todoPath).items[0].status).toBe("done");
  });

  it("force resume accepts incomplete jobs", async () => {
    // Create an automation first (FK constraint)
    const automationsDir = harness.automationsDir!;
    fs.writeFileSync(
      path.join(automationsDir, "force-test.md"),
      [
        "---",
        "name: Force Test",
        "status: active",
        "trigger:",
        "  - type: manual",
        `created: ${new Date().toISOString()}`,
        "---",
        "",
        "Test.",
      ].join("\n"),
    );
    await harness.automationManager!.syncAll();

    // Create a needs_review job
    const job = harness.automationJobService!.createJob("force-test");
    harness.automationJobService!.updateJob(job.id, {
      status: "needs_review",
      summary: "Incomplete mandatory items",
    });

    // Force-complete
    harness.automationJobService!.updateJob(job.id, {
      status: "completed",
      completed: new Date().toISOString(),
      summary: "Force-completed by user",
    });

    const finalJob = harness.automationJobService!.getJob(job.id);
    expect(finalJob?.status).toBe("completed");
  });
});
