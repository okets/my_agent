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
  let mockCi: { alert: ReturnType<typeof vi.fn>; initiate: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "heartbeat-"));
    notifDir = path.join(tmpDir, "notifications");
    queue = new PersistentNotificationQueue(notifDir);

    mockJobService = {
      listJobs: vi.fn(() => []),
      updateJob: vi.fn(),
      getJob: vi.fn(),
    };
    mockCi = {
      alert: vi.fn(async () => ({ status: "delivered" as const })),
      initiate: vi.fn(async () => ({})),
    };
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
      agentDir: tmpDir,
      ...overrides,
    });
  }

  function writeAuditLog(agentDir: string, entries: Array<{ timestamp: string; session: string; tool?: string }>) {
    const logsDir = path.join(agentDir, "logs");
    fs.mkdirSync(logsDir, { recursive: true });
    const lines = entries.map((e) => JSON.stringify({ tool: e.tool ?? "Bash", ...e }));
    fs.writeFileSync(path.join(logsDir, "audit.jsonl"), lines.join("\n") + "\n");
  }

  it("detects stale job (old last_activity) and marks interrupted", async () => {
    // Alert returns false — heartbeat should fall back to initiate()
    mockCi.alert.mockResolvedValue({ status: "no_conversation" });

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

    // M9.1-S9: job_interrupted notifications are held by the minimum-age gate (60s)
    // on the same tick they are enqueued — they will be delivered on the next tick.
    expect(mockCi.initiate).not.toHaveBeenCalled();
    expect(queue.listPending()).toHaveLength(1);
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

  it("falls back to initiate() when ci.alert() returns false", async () => {
    mockCi.alert.mockResolvedValue({ status: "no_conversation" });

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

    expect(mockCi.initiate).toHaveBeenCalledTimes(1);
    // Should be delivered after initiate() fallback
    expect(queue.listPending()).toHaveLength(0);
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
    mockCi.alert.mockResolvedValue({ status: "no_conversation" });

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

  it("does NOT mark interrupted when audit log shows recent tool activity", async () => {
    const runDir = path.join(tmpDir, "run-busy");
    fs.mkdirSync(runDir, { recursive: true });

    // Stale todos — last touch 6 min ago
    writeTodoFile(path.join(runDir, "todos.json"), {
      items: [
        { id: "t1", text: "Research", status: "in_progress", mandatory: false, created_by: "agent" },
      ],
      last_activity: new Date(Date.now() - 6 * 60 * 1000).toISOString(),
    });

    // Audit log shows tool activity 90s ago — worker is alive
    writeAuditLog(tmpDir, [
      { timestamp: new Date(Date.now() - 90 * 1000).toISOString(), session: "sess-busy", tool: "WebFetch" },
    ]);

    mockJobService.listJobs.mockReturnValue([
      makeJob({ id: "job-busy", run_dir: runDir, sdk_session_id: "sess-busy" }),
    ]);

    const hb = createHeartbeat();
    await hb.tick();

    expect(mockJobService.updateJob).not.toHaveBeenCalledWith(
      "job-busy",
      expect.objectContaining({ status: "interrupted" }),
    );
    expect(queue.listPending()).toHaveLength(0);
  });

  it("delays delivering a fresh job_interrupted notification (minimum-age gate)", async () => {
    // Notification created 10s ago — under the 60s gate
    queue.enqueue({
      job_id: "job-fresh-interrupt",
      automation_id: "auto-1",
      type: "job_interrupted",
      summary: "Job interrupted. 0/3 items done.",
      todos_completed: 0,
      todos_total: 3,
      incomplete_items: ["a", "b", "c"],
      resumable: true,
      created: new Date(Date.now() - 10 * 1000).toISOString(),
      delivery_attempts: 0,
    });
    mockJobService.getJob.mockReturnValue(
      makeJob({ id: "job-fresh-interrupt", status: "interrupted" }),
    );

    const hb = createHeartbeat();
    await hb.tick();

    expect(mockCi.alert).not.toHaveBeenCalled();
    expect(queue.listPending()).toHaveLength(1);
  });

  it("delivers an aged job_interrupted notification when status is still interrupted", async () => {
    queue.enqueue({
      job_id: "job-truly-stuck",
      automation_id: "auto-1",
      type: "job_interrupted",
      summary: "Job interrupted. 0/3 items done.",
      todos_completed: 0,
      todos_total: 3,
      incomplete_items: ["a", "b", "c"],
      resumable: true,
      created: new Date(Date.now() - 90 * 1000).toISOString(),
      delivery_attempts: 0,
    });
    mockJobService.getJob.mockReturnValue(
      makeJob({ id: "job-truly-stuck", status: "interrupted" }),
    );

    const hb = createHeartbeat();
    await hb.tick();

    expect(mockCi.alert).toHaveBeenCalledTimes(1);
    expect(queue.listPending()).toHaveLength(0);
  });

  it("discards an aged job_interrupted notification if the job has since recovered", async () => {
    queue.enqueue({
      job_id: "job-recovered",
      automation_id: "auto-1",
      type: "job_interrupted",
      summary: "Job interrupted. 0/3 items done.",
      todos_completed: 0,
      todos_total: 3,
      incomplete_items: ["a", "b", "c"],
      resumable: true,
      created: new Date(Date.now() - 90 * 1000).toISOString(),
      delivery_attempts: 0,
    });
    mockJobService.getJob.mockReturnValue(
      makeJob({ id: "job-recovered", status: "completed" }),
    );

    const hb = createHeartbeat();
    await hb.tick();

    expect(mockCi.alert).not.toHaveBeenCalled();
    expect(queue.listPending()).toHaveLength(0);
    // verify it was moved to delivered
    const delivered = fs.readdirSync(path.join(notifDir, "delivered"));
    expect(delivered).toHaveLength(1);
  });

  it("respects per-automation stale_threshold_ms override", async () => {
    const runDir = path.join(tmpDir, "run-long");
    fs.mkdirSync(runDir, { recursive: true });

    // Last activity 9 min ago — exceeds the 5-min global default,
    // but UNDER the 15-min per-automation override.
    writeTodoFile(path.join(runDir, "todos.json"), {
      items: [{ id: "t1", text: "Long research", status: "in_progress", mandatory: false, created_by: "agent" }],
      last_activity: new Date(Date.now() - 9 * 60 * 1000).toISOString(),
    });

    mockJobService.listJobs.mockReturnValue([
      makeJob({
        id: "job-long",
        run_dir: runDir,
        automationId: "research-worker",
      }),
    ]);

    const resolveThreshold = vi.fn((automationId: string) =>
      automationId === "research-worker" ? 15 * 60 * 1000 : null,
    );

    const hb = createHeartbeat({ resolveStaleThresholdMs: resolveThreshold });
    await hb.tick();

    expect(resolveThreshold).toHaveBeenCalledWith("research-worker");
    expect(mockJobService.updateJob).not.toHaveBeenCalledWith(
      "job-long",
      expect.objectContaining({ status: "interrupted" }),
    );
  });

  it("still triggers neverStarted even when audit log shows activity (intentional)", async () => {
    const runDir = path.join(tmpDir, "run-no-todos");
    fs.mkdirSync(runDir, { recursive: true });
    writeTodoFile(path.join(runDir, "todos.json"), {
      items: [],
      last_activity: new Date(Date.now() - 3 * 60 * 1000).toISOString(),
    });
    writeAuditLog(tmpDir, [
      { timestamp: new Date(Date.now() - 30 * 1000).toISOString(), session: "sess-x", tool: "WebFetch" },
    ]);
    mockJobService.listJobs.mockReturnValue([
      makeJob({
        id: "job-no-todos",
        run_dir: runDir,
        sdk_session_id: "sess-x",
        created: new Date(Date.now() - 3 * 60 * 1000).toISOString(),
      }),
    ]);

    const hb = createHeartbeat();
    await hb.tick();

    expect(mockJobService.updateJob).toHaveBeenCalledWith(
      "job-no-todos",
      expect.objectContaining({ status: "interrupted" }),
    );
  });
});
