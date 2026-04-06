import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { HeartbeatService } from "../heartbeat-service.js";
import { PersistentNotificationQueue } from "../../notifications/persistent-queue.js";
import { writeTodoFile } from "../todo-file.js";
import type { Job } from "@my-agent/core";

function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    id: "job-1",
    automationId: "auto-1",
    status: "running",
    created: new Date().toISOString(),
    ...overrides,
  };
}

describe("HeartbeatService", () => {
  let tmpDir: string;
  let notifDir: string;
  let queue: PersistentNotificationQueue;
  let mockJobService: {
    listJobs: ReturnType<typeof vi.fn>;
    updateJob: ReturnType<typeof vi.fn>;
    getJob: ReturnType<typeof vi.fn>;
  };
  let mockCi: { alert: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "heartbeat-"));
    notifDir = path.join(tmpDir, "notifications");
    queue = new PersistentNotificationQueue(notifDir);

    mockJobService = {
      listJobs: vi.fn(() => []),
      updateJob: vi.fn(),
      getJob: vi.fn(),
    };
    mockCi = { alert: vi.fn(async () => true) };
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function createHeartbeat(overrides = {}) {
    return new HeartbeatService({
      jobService: mockJobService as any,
      notificationQueue: queue,
      conversationInitiator: mockCi as any,
      staleThresholdMs: 5 * 60 * 1000,
      tickIntervalMs: 999999,
      capabilityHealthIntervalMs: 999999,
      ...overrides,
    });
  }

  it("detects stale job (old last_activity) and marks interrupted", async () => {
    // Alert returns false so notification stays in pending/ for assertion
    mockCi.alert.mockResolvedValue(false);

    const runDir = path.join(tmpDir, "run-1");
    fs.mkdirSync(runDir, { recursive: true });
    writeTodoFile(path.join(runDir, "todos.json"), {
      items: [
        { id: "t1", text: "Step 1", status: "done", mandatory: false, created_by: "agent" },
        { id: "t2", text: "Step 2", status: "in_progress", mandatory: false, created_by: "agent" },
      ],
      last_activity: new Date(Date.now() - 6 * 60 * 1000).toISOString(),
    });

    mockJobService.listJobs.mockReturnValue([
      makeJob({ id: "job-stale", run_dir: runDir }),
    ]);

    const hb = createHeartbeat();
    await hb.tick();

    expect(mockJobService.updateJob).toHaveBeenCalledWith("job-stale", expect.objectContaining({
      status: "interrupted",
    }));

    const pending = queue.listPending();
    expect(pending).toHaveLength(1);
    expect(pending[0].type).toBe("job_interrupted");
    expect(pending[0].todos_completed).toBe(1);
    expect(pending[0].todos_total).toBe(2);
    expect(pending[0].incomplete_items).toContain("Step 2");
  });

  it("detects never-started job (empty todos, old created)", async () => {
    const runDir = path.join(tmpDir, "run-2");
    fs.mkdirSync(runDir, { recursive: true });
    // Empty todo file — agent never engaged
    writeTodoFile(path.join(runDir, "todos.json"), {
      items: [],
      last_activity: new Date(Date.now() - 3 * 60 * 1000).toISOString(),
    });

    mockJobService.listJobs.mockReturnValue([
      makeJob({
        id: "job-never",
        run_dir: runDir,
        created: new Date(Date.now() - 3 * 60 * 1000).toISOString(),
      }),
    ]);

    const hb = createHeartbeat();
    await hb.tick();

    expect(mockJobService.updateJob).toHaveBeenCalledWith("job-never", expect.objectContaining({
      status: "interrupted",
    }));
  });

  it("leaves recent job alone", async () => {
    const runDir = path.join(tmpDir, "run-3");
    fs.mkdirSync(runDir, { recursive: true });
    writeTodoFile(path.join(runDir, "todos.json"), {
      items: [{ id: "t1", text: "Working", status: "in_progress", mandatory: false, created_by: "agent" }],
      last_activity: new Date().toISOString(), // fresh
    });

    mockJobService.listJobs.mockReturnValue([
      makeJob({ id: "job-fresh", run_dir: runDir }),
    ]);

    const hb = createHeartbeat();
    await hb.tick();

    expect(mockJobService.updateJob).not.toHaveBeenCalled();
    expect(queue.listPending()).toHaveLength(0);
  });

  it("delivers pending notifications via ci.alert()", async () => {
    queue.enqueue({
      job_id: "job-done",
      automation_id: "a1",
      type: "job_completed",
      summary: "Done",
      created: new Date().toISOString(),
      delivery_attempts: 0,
    });

    const hb = createHeartbeat();
    await hb.tick();

    expect(mockCi.alert).toHaveBeenCalledTimes(1);
    expect(queue.listPending()).toHaveLength(0);
    // Should be in delivered/
    const delivered = fs.readdirSync(path.join(notifDir, "delivered"));
    expect(delivered).toHaveLength(1);
  });

  it("increments attempts when ci.alert() returns false", async () => {
    mockCi.alert.mockResolvedValue(false);

    queue.enqueue({
      job_id: "job-fail",
      automation_id: "a1",
      type: "job_failed",
      summary: "Failed",
      created: new Date().toISOString(),
      delivery_attempts: 0,
    });

    const hb = createHeartbeat();
    await hb.tick();

    const pending = queue.listPending();
    expect(pending).toHaveLength(1);
    expect(pending[0].delivery_attempts).toBe(1);
  });

  it("skips jobs without run_dir", async () => {
    mockJobService.listJobs.mockReturnValue([
      makeJob({ id: "job-nodir", run_dir: undefined }),
    ]);

    const hb = createHeartbeat();
    await hb.tick();

    expect(mockJobService.updateJob).not.toHaveBeenCalled();
  });

  it("stops retrying after max delivery attempts", async () => {
    mockCi.alert.mockResolvedValue(false);

    queue.enqueue({
      job_id: "job-maxed",
      automation_id: "a1",
      type: "job_completed",
      summary: "Done",
      created: new Date().toISOString(),
      delivery_attempts: 20, // Already at max
    });

    const hb = createHeartbeat();
    await hb.tick();

    // Should NOT call alert — just move to delivered
    expect(mockCi.alert).not.toHaveBeenCalled();
    expect(queue.listPending()).toHaveLength(0);
    const delivered = fs.readdirSync(path.join(notifDir, "delivered"));
    expect(delivered).toHaveLength(1);
  });

  it("capability health check fires on schedule", async () => {
    const healthCheck = vi.fn(async () => {});
    const hb = createHeartbeat({
      capabilityHealthIntervalMs: 0, // always due
      capabilityHealthCheck: healthCheck,
    });

    await hb.tick();
    expect(healthCheck).toHaveBeenCalledTimes(1);
  });
});
