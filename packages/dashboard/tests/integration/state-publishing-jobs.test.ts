/**
 * M9.4-S3: Verify state:jobs broadcasts include todoProgress.items
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { AppHarness } from "./app-harness.js";
import { writeTodoFile } from "../../src/automations/todo-file.js";
import path from "node:path";
import fs from "node:fs";

let harness: AppHarness;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Write a minimal automation file and sync so the FK constraint is satisfied. */
async function createTestAutomation(harness: AppHarness, id: string): Promise<void> {
  fs.writeFileSync(
    path.join(harness.automationsDir!, `${id}.md`),
    [
      "---",
      `name: Test Automation ${id}`,
      "status: active",
      "trigger:",
      "  - type: manual",
      `created: ${new Date().toISOString()}`,
      "---",
      "",
      "Test automation for state publishing tests.",
    ].join("\n"),
  );
  await harness.automationManager!.syncAll();
}

beforeEach(async () => {
  harness = await AppHarness.create({ withAutomations: true });
  // Wire automation services into the state publisher (mirrors index.ts initialization)
  harness.statePublisher.setAutomationServices(
    harness.automationManager,
    harness.automationJobService,
  );
  harness.clearBroadcasts();
});

afterEach(async () => {
  await harness.shutdown();
});

describe("state:jobs todoProgress.items", () => {
  it("includes items array with id, text, and status", async () => {
    await createTestAutomation(harness, "test-auto");

    // Create a job and set it to running status
    const job = harness.automationJobService!.createJob("test-auto");
    harness.automationJobService!.updateJob(job.id, { status: "running" });

    // Write todos.json to the job's run_dir
    writeTodoFile(path.join(job.run_dir!, "todos.json"), {
      items: [
        { id: "t1", text: "Research topic", status: "done", mandatory: true, created_by: "framework" },
        { id: "t2", text: "Write report", status: "in_progress", mandatory: true, created_by: "framework" },
        { id: "t3", text: "Review output", status: "pending", mandatory: false, created_by: "agent" },
      ],
      last_activity: new Date().toISOString(),
    });

    harness.statePublisher.publishJobs();
    await delay(150);

    const broadcasts = harness.getBroadcasts("state:jobs");
    expect(broadcasts.length).toBeGreaterThanOrEqual(1);

    const last = broadcasts[broadcasts.length - 1] as any;
    const snapshot = last.jobs.find((j: any) => j.id === job.id);
    expect(snapshot).toBeDefined();
    expect(snapshot.todoProgress).toBeDefined();
    expect(snapshot.todoProgress.done).toBe(1);
    expect(snapshot.todoProgress.total).toBe(3);
    expect(snapshot.todoProgress.current).toBe("Write report");

    // Key assertion: items array exists with correct shape
    expect(snapshot.todoProgress.items).toHaveLength(3);
    expect(snapshot.todoProgress.items[0]).toEqual({ id: "t1", text: "Research topic", status: "done" });
    expect(snapshot.todoProgress.items[1]).toEqual({ id: "t2", text: "Write report", status: "in_progress" });
    expect(snapshot.todoProgress.items[2]).toEqual({ id: "t3", text: "Review output", status: "pending" });
  });

  it("omits todoProgress when job has no todos", async () => {
    await createTestAutomation(harness, "test-auto");

    const job = harness.automationJobService!.createJob("test-auto");
    harness.automationJobService!.updateJob(job.id, { status: "running" });

    // Empty todos.json
    writeTodoFile(path.join(job.run_dir!, "todos.json"), {
      items: [],
      last_activity: new Date().toISOString(),
    });

    harness.statePublisher.publishJobs();
    await delay(150);

    const broadcasts = harness.getBroadcasts("state:jobs");
    const last = broadcasts[broadcasts.length - 1] as any;
    const snapshot = last.jobs.find((j: any) => j.id === job.id);
    expect(snapshot.todoProgress).toBeUndefined();
  });
});
