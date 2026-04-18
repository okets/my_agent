/**
 * M9.1-S3 Acceptance: Heartbeat detects stale job + delivers notification.
 *
 * Verifies the full heartbeat loop:
 * 1. Stale running job → marked interrupted
 * 2. Notification created in persistent queue with todo progress
 * 3. Delivery attempted via ci.alert()
 * 4. Queue survives re-instantiation
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { AppHarness } from "./app-harness.js";
import { writeTodoFile } from "../../src/automations/todo-file.js";
import { HeartbeatService } from "../../src/automations/heartbeat-service.js";
import { PersistentNotificationQueue } from "../../src/notifications/persistent-queue.js";

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

describe("S3 Acceptance: heartbeat stale detection + notification", () => {
  let harness: AppHarness;
  let notifQueue: PersistentNotificationQueue;

  beforeEach(async () => {
    harness = await AppHarness.create({ withAutomations: true });
    notifQueue = new PersistentNotificationQueue(
      path.join(harness.agentDir, "notifications"),
    );
  });

  afterEach(async () => {
    await harness.shutdown();
    vi.clearAllMocks();
  });

  it("stale running job → interrupted + notification + delivery attempted", async () => {
    // Create automation and fire a job
    fs.writeFileSync(
      path.join(harness.automationsDir!, "stale-test.md"),
      [
        "---",
        "name: Stale Test",
        "status: active",
        "trigger:",
        "  - type: manual",
        `created: ${new Date().toISOString()}`,
        "---",
        "",
        "Test job.",
      ].join("\n"),
    );
    await harness.automationManager!.syncAll();

    // Mock createBrainQuery
    (createBrainQuery as ReturnType<typeof vi.fn>).mockReturnValue(
      makeAsyncIterable([
        {
          type: "assistant",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "Working..." }],
          },
        },
      ]),
    );

    const automation = harness.automationManager!.findById("stale-test")!;

    // Wait for the job to complete through the processor
    const jobDone = new Promise<import("@my-agent/core").Job>(
      (resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error("Timeout")),
          5000,
        );
        const handler = (job: import("@my-agent/core").Job) => {
          clearTimeout(timeout);
          resolve(job);
        };
        harness.emitter.on("job:completed" as any, handler);
        harness.emitter.on("job:failed" as any, handler);
        harness.emitter.on("job:needs_review" as any, handler);
      },
    );

    harness.automationProcessor!.fire(automation);
    const completedJob = await jobDone;

    // Now simulate a stale running state:
    // Set the job back to running and make last_activity old
    harness.automationJobService!.updateJob(completedJob.id, {
      status: "running",
    });
    writeTodoFile(path.join(completedJob.run_dir!, "todos.json"), {
      items: [
        {
          id: "t1",
          text: "Step 1",
          status: "done",
          mandatory: false,
          created_by: "agent",
        },
        {
          id: "t2",
          text: "Step 2",
          status: "in_progress",
          mandatory: true,
          created_by: "framework",
        },
      ],
      last_activity: new Date(Date.now() - 6 * 60 * 1000).toISOString(),
    });

    // Mock alert to return false so notification stays in pending
    const mockAlert = vi.fn(async () => false);

    // Create heartbeat and run one tick
    const heartbeat = new HeartbeatService({
      jobService: harness.automationJobService!,
      notificationQueue: notifQueue,
      conversationInitiator: { alert: mockAlert },
      staleThresholdMs: 5 * 60 * 1000,
      tickIntervalMs: 999999,
      capabilityHealthIntervalMs: 999999,
      // Single-tick test: bypass the 60s minimum-age gate (production guard only)
      interruptedMinAgeMs: 0,
    });

    await heartbeat.tick();
    heartbeat.stop();

    // Verify: job should be interrupted
    const updatedJob = harness.automationJobService!.getJob(completedJob.id);
    expect(updatedJob?.status).toBe("interrupted");

    // Verify: notification in pending
    const pending = notifQueue.listPending();
    expect(pending.length).toBeGreaterThanOrEqual(1);
    const notif = pending.find((n) => n.job_id === completedJob.id);
    expect(notif).toBeDefined();
    expect(notif!.type).toBe("job_interrupted");
    expect(notif!.todos_completed).toBe(1);
    expect(notif!.todos_total).toBe(2);
    expect(notif!.incomplete_items).toContain("Step 2");

    // Verify: delivery was attempted
    expect(mockAlert).toHaveBeenCalled();
  });

  it("notification queue survives re-instantiation", () => {
    // Enqueue a notification
    notifQueue.enqueue({
      job_id: "persist-test",
      automation_id: "a1",
      type: "job_completed",
      summary: "Test persistence",
      created: new Date().toISOString(),
      delivery_attempts: 0,
    });

    // Create a new queue instance from the same directory
    const queue2 = new PersistentNotificationQueue(
      path.join(harness.agentDir, "notifications"),
    );

    const pending = queue2.listPending();
    expect(pending).toHaveLength(1);
    expect(pending[0].job_id).toBe("persist-test");
  });

  it("delivered notification moves from pending to delivered", () => {
    notifQueue.enqueue({
      job_id: "deliver-test",
      automation_id: "a1",
      type: "job_completed",
      summary: "Done",
      created: new Date().toISOString(),
      delivery_attempts: 0,
    });

    const pending = notifQueue.listPending();
    expect(pending).toHaveLength(1);

    notifQueue.markDelivered(pending[0]._filename!);
    expect(notifQueue.listPending()).toHaveLength(0);

    const deliveredDir = path.join(
      harness.agentDir,
      "notifications",
      "delivered",
    );
    expect(fs.readdirSync(deliveredDir)).toHaveLength(1);
  });
});
