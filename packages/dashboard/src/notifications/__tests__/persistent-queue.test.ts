import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { PersistentNotificationQueue } from "../persistent-queue.js";

describe("PersistentNotificationQueue", () => {
  let tmpDir: string;
  let queue: PersistentNotificationQueue;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "notif-"));
    queue = new PersistentNotificationQueue(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("enqueue creates a file in pending/", () => {
    queue.enqueue({
      job_id: "job-1",
      type: "job_completed",
      summary: "Done",
      automation_id: "a1",
      created: new Date().toISOString(),
      delivery_attempts: 0,
    });
    const pending = queue.listPending();
    expect(pending).toHaveLength(1);
    expect(pending[0].job_id).toBe("job-1");
  });

  it("markDelivered moves to delivered/", () => {
    queue.enqueue({
      job_id: "job-2",
      type: "job_completed",
      summary: "Done",
      automation_id: "a1",
      created: new Date().toISOString(),
      delivery_attempts: 0,
    });
    const pending = queue.listPending();
    queue.markDelivered(pending[0]._filename!);
    expect(queue.listPending()).toHaveLength(0);
    const delivered = fs.readdirSync(path.join(tmpDir, "delivered"));
    expect(delivered).toHaveLength(1);
  });

  it("incrementAttempts updates delivery_attempts", () => {
    queue.enqueue({
      job_id: "job-3",
      type: "job_failed",
      summary: "Error",
      automation_id: "a1",
      created: new Date().toISOString(),
      delivery_attempts: 0,
    });
    const pending = queue.listPending();
    queue.incrementAttempts(pending[0]._filename!);
    const updated = queue.listPending();
    expect(updated[0].delivery_attempts).toBe(1);
  });

  it("survives re-instantiation (disk persistence)", () => {
    queue.enqueue({
      job_id: "job-4",
      type: "job_interrupted",
      summary: "Restart",
      automation_id: "a1",
      created: new Date().toISOString(),
      delivery_attempts: 0,
    });
    const queue2 = new PersistentNotificationQueue(tmpDir);
    expect(queue2.listPending()).toHaveLength(1);
  });

  it("listPending returns items sorted by filename (timestamp)", () => {
    queue.enqueue({
      job_id: "job-a",
      type: "job_completed",
      summary: "First",
      automation_id: "a1",
      created: new Date().toISOString(),
      delivery_attempts: 0,
    });
    queue.enqueue({
      job_id: "job-b",
      type: "job_completed",
      summary: "Second",
      automation_id: "a1",
      created: new Date().toISOString(),
      delivery_attempts: 0,
    });
    const pending = queue.listPending();
    expect(pending).toHaveLength(2);
    expect(pending[0].job_id).toBe("job-a");
    expect(pending[1].job_id).toBe("job-b");
  });

  it("enqueue includes optional fields", () => {
    queue.enqueue({
      job_id: "job-5",
      type: "job_interrupted",
      summary: "Interrupted",
      automation_id: "a1",
      created: new Date().toISOString(),
      delivery_attempts: 0,
      todos_completed: 3,
      todos_total: 5,
      incomplete_items: ["Step 4", "Step 5"],
      resumable: true,
    });
    const pending = queue.listPending();
    expect(pending[0].todos_completed).toBe(3);
    expect(pending[0].todos_total).toBe(5);
    expect(pending[0].incomplete_items).toEqual(["Step 4", "Step 5"]);
    expect(pending[0].resumable).toBe(true);
  });
});
