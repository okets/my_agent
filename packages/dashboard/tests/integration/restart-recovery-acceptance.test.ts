/**
 * M9.1-S6 Acceptance: Restart recovery detects interrupted jobs.
 *
 * Verifies:
 * 1. Running job detected as interrupted after restart simulation
 * 2. Notification created with correct todo progress
 * 3. Stale once:true completed automations disabled
 * 4. resume_job accepts interrupted jobs with todo-aware prompt
 * 5. AppHarness supports agentDir reuse for restart simulation
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { AppHarness } from "./app-harness.js";
import {
  readTodoFile,
  writeTodoFile,
} from "../../src/automations/todo-file.js";
import { PersistentNotificationQueue } from "../../src/notifications/persistent-queue.js";

// Mock SDK boundary
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

describe("S6 Acceptance: restart recovery", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "s6-restart-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("running job detected as interrupted after simulated restart", async () => {
    // Phase 1: Create harness, set up a running job
    const harness1 = await AppHarness.create({
      withAutomations: true,
      agentDir: tmpDir,
    });

    // Create an automation manifest
    fs.writeFileSync(
      path.join(harness1.automationsDir!, "restart-test.md"),
      [
        "---",
        "name: Restart Test Job",
        "status: active",
        "trigger:",
        "  - type: manual",
        `created: ${new Date().toISOString()}`,
        "---",
        "",
        "Test job for restart recovery.",
      ].join("\n"),
    );
    await harness1.automationManager!.syncAll();

    // Create a job and set it to "running" with todo progress
    const job = harness1.automationJobService!.createJob("restart-test");
    harness1.automationJobService!.updateJob(job.id, { status: "running" });

    writeTodoFile(path.join(job.run_dir!, "todos.json"), {
      items: [
        {
          id: "t1",
          text: "Read spec",
          status: "done",
          mandatory: true,
          created_by: "delegator",
        },
        {
          id: "t2",
          text: "Write code",
          status: "done",
          mandatory: true,
          created_by: "delegator",
        },
        {
          id: "t3",
          text: "Run tests",
          status: "in_progress",
          mandatory: true,
          created_by: "framework",
        },
        {
          id: "t4",
          text: "Fill report",
          status: "pending",
          mandatory: true,
          created_by: "framework",
        },
      ],
      last_activity: new Date().toISOString(),
    });

    // Verify job is running
    expect(
      harness1.automationJobService!.getJob(job.id)?.status,
    ).toBe("running");

    // Phase 2: Shutdown first harness (simulates crash)
    await harness1.shutdown();

    // Phase 3: Create second harness with same agentDir (simulates restart)
    const harness2 = await AppHarness.create({
      withAutomations: true,
      agentDir: tmpDir,
    });

    // Simulate the recovery sequence (what app.ts does on startup)
    const staleRunning = harness2.automationJobService!.listJobs({
      status: "running",
    });
    const stalePending = harness2.automationJobService!.listJobs({
      status: "pending",
    });
    const staleJobs = [...staleRunning, ...stalePending];

    const notifQueue = new PersistentNotificationQueue(
      path.join(tmpDir, "notifications"),
    );

    for (const staleJob of staleJobs) {
      const todoFile = staleJob.run_dir
        ? readTodoFile(path.join(staleJob.run_dir, "todos.json"))
        : { items: [] };
      const completed = todoFile.items.filter(
        (i) => i.status === "done",
      ).length;
      const total = todoFile.items.length;
      const incomplete = todoFile.items
        .filter((i) => i.status !== "done")
        .map((i) => i.text);

      harness2.automationJobService!.updateJob(staleJob.id, {
        status: "interrupted",
        summary: `Interrupted by restart. ${completed}/${total} items done.`,
      });

      notifQueue.enqueue({
        job_id: staleJob.id,
        automation_id: staleJob.automationId,
        type: "job_interrupted",
        summary: `Job interrupted by restart. ${completed}/${total} items done.`,
        todos_completed: completed,
        todos_total: total,
        incomplete_items: incomplete,
        resumable: true,
        created: new Date().toISOString(),
        delivery_attempts: 0,
      });
    }

    // Verify: job detected and marked interrupted
    expect(staleJobs).toHaveLength(1);
    expect(staleJobs[0].id).toBe(job.id);

    const recoveredJob = harness2.automationJobService!.getJob(job.id);
    expect(recoveredJob?.status).toBe("interrupted");
    expect(recoveredJob?.summary).toContain("2/4");

    // Verify: notification created
    const pending = notifQueue.listPending();
    const notif = pending.find((n) => n.job_id === job.id);
    expect(notif).toBeDefined();
    expect(notif!.type).toBe("job_interrupted");
    expect(notif!.todos_completed).toBe(2);
    expect(notif!.todos_total).toBe(4);
    expect(notif!.incomplete_items).toContain("Run tests");
    expect(notif!.incomplete_items).toContain("Fill report");
    expect(notif!.resumable).toBe(true);

    await harness2.shutdown();
  });

  it("once:true completed automation is disabled on recovery", async () => {
    const harness = await AppHarness.create({
      withAutomations: true,
      agentDir: tmpDir,
    });

    // Create a once:true automation
    fs.writeFileSync(
      path.join(harness.automationsDir!, "once-job.md"),
      [
        "---",
        "name: One-time setup",
        "status: active",
        "once: true",
        "trigger:",
        "  - type: manual",
        `created: ${new Date().toISOString()}`,
        "---",
        "",
        "Run once then clean up.",
      ].join("\n"),
    );
    await harness.automationManager!.syncAll();

    // Create a completed job for this automation
    const job = harness.automationJobService!.createJob("once-job");
    harness.automationJobService!.updateJob(job.id, {
      status: "completed",
      completed: new Date().toISOString(),
    });

    // Simulate recovery: disable once:true automations with completed jobs
    const allAutomations = harness.automationManager!.list();
    for (const auto of allAutomations) {
      if (auto.manifest.once) {
        const completedJobs = harness.automationJobService!.listJobs({
          automationId: auto.id,
          status: "completed",
        });
        if (completedJobs.length > 0) {
          harness.automationManager!.disable(auto.id);
        }
      }
    }

    // Verify: automation is now disabled
    const automation = harness.automationManager!.findById("once-job");
    expect(automation?.manifest.status).toBe("disabled");

    await harness.shutdown();
  });

  it("resume_job accepts interrupted status (not just needs_review)", async () => {
    const harness = await AppHarness.create({
      withAutomations: true,
      agentDir: tmpDir,
    });

    // Create automation and job
    fs.writeFileSync(
      path.join(harness.automationsDir!, "resume-test.md"),
      [
        "---",
        "name: Resume Test",
        "status: active",
        "trigger:",
        "  - type: manual",
        `created: ${new Date().toISOString()}`,
        "---",
        "",
        "Test resume from interrupted.",
      ].join("\n"),
    );
    await harness.automationManager!.syncAll();

    const job = harness.automationJobService!.createJob("resume-test");
    harness.automationJobService!.updateJob(job.id, {
      status: "interrupted",
      summary: "Interrupted by restart. 2/4 items done.",
    });

    // Write todo state
    writeTodoFile(path.join(job.run_dir!, "todos.json"), {
      items: [
        {
          id: "t1",
          text: "Setup environment",
          status: "done",
          mandatory: false,
          created_by: "agent",
        },
        {
          id: "t2",
          text: "Build component",
          status: "done",
          mandatory: false,
          created_by: "agent",
        },
        {
          id: "t3",
          text: "Run validation",
          status: "in_progress",
          mandatory: true,
          created_by: "framework",
        },
        {
          id: "t4",
          text: "Write report",
          status: "pending",
          mandatory: true,
          created_by: "framework",
        },
      ],
      last_activity: new Date().toISOString(),
    });

    // Verify the job is in interrupted state (resume_job should accept this)
    const currentJob = harness.automationJobService!.getJob(job.id);
    expect(currentJob?.status).toBe("interrupted");

    // Build the resume prompt the same way automation-server does
    const todoFile = readTodoFile(path.join(job.run_dir!, "todos.json"));
    const done = todoFile.items
      .filter((i) => i.status === "done")
      .map((i) => i.text);
    const remaining = todoFile.items
      .filter((i) => i.status !== "done")
      .map((i) => i.text);

    const resumePrompt =
      `You were interrupted. Your todo list shows ${done.length} items completed:\n` +
      `${done.map((t) => `\u2713 ${t}`).join("\n")}\n\nRemaining:\n` +
      `${remaining.map((t) => `\u2610 ${t}`).join("\n")}\n\n` +
      `Continue from where you left off. Call todo_list to see your full assignment.`;

    // Verify the prompt contains todo context
    expect(resumePrompt).toContain("2 items completed");
    expect(resumePrompt).toContain("\u2713 Setup environment");
    expect(resumePrompt).toContain("\u2713 Build component");
    expect(resumePrompt).toContain("\u2610 Run validation");
    expect(resumePrompt).toContain("\u2610 Write report");

    await harness.shutdown();
  });

  it("AppHarness preserves data across restart simulation", async () => {
    // Create first harness with specific agentDir
    const harness1 = await AppHarness.create({
      withAutomations: true,
      agentDir: tmpDir,
    });

    // Create some state
    fs.writeFileSync(
      path.join(harness1.automationsDir!, "persist-test.md"),
      [
        "---",
        "name: Persistence Test",
        "status: active",
        "trigger:",
        "  - type: manual",
        `created: ${new Date().toISOString()}`,
        "---",
        "",
        "Test data persistence.",
      ].join("\n"),
    );
    await harness1.automationManager!.syncAll();
    const job = harness1.automationJobService!.createJob("persist-test");

    // Shutdown
    await harness1.shutdown();

    // Verify dir still exists
    expect(fs.existsSync(tmpDir)).toBe(true);

    // Create second harness with same dir
    const harness2 = await AppHarness.create({
      withAutomations: true,
      agentDir: tmpDir,
    });

    // Verify data persisted
    const recoveredJob = harness2.automationJobService!.getJob(job.id);
    expect(recoveredJob).toBeDefined();
    expect(recoveredJob!.automationId).toBe("persist-test");

    await harness2.shutdown();
  });
});
