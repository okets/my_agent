import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { HeartbeatService } from "../../../src/automations/heartbeat-service.js";
import { PersistentNotificationQueue, type PersistentNotification } from "../../../src/notifications/persistent-queue.js";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

/**
 * Heartbeat source_channel routing tests
 *
 * Post-S1 simplified model:
 * - alert() returns true → delivered (regardless of source)
 * - alert() returns false → fallback to initiate() (regardless of source)
 * - source_channel passed through to alert() for channel routing decisions
 */

function makeNotification(
  overrides: Partial<PersistentNotification> = {},
): Omit<PersistentNotification, "_filename"> {
  return {
    job_id: "job-test-123",
    automation_id: "test-automation",
    type: "job_completed",
    summary: "Test completed",
    created: new Date().toISOString(),
    delivery_attempts: 0,
    ...overrides,
  };
}

describe("Heartbeat source_channel routing", () => {
  let tempDir: string;
  let queue: PersistentNotificationQueue;
  let alertFn: ReturnType<typeof vi.fn>;
  let initiateFn: ReturnType<typeof vi.fn>;
  let heartbeat: HeartbeatService;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "source-channel-test-"));
    queue = new PersistentNotificationQueue(tempDir);
    alertFn = vi.fn().mockResolvedValue(false); // default: no current conversation
    initiateFn = vi.fn().mockResolvedValue({});

    heartbeat = new HeartbeatService({
      jobService: { listJobs: vi.fn().mockReturnValue([]) } as any,
      notificationQueue: queue,
      conversationInitiator: {
        alert: alertFn,
        initiate: initiateFn,
      },
      intervalMs: 999999, // don't auto-tick
    });
  });

  afterEach(() => {
    heartbeat.stop();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("dashboard-sourced + alert fails → falls back to initiate()", async () => {
    queue.enqueue(makeNotification({ source_channel: "dashboard" }));

    await (heartbeat as any).deliverPendingNotifications();

    // alert was called with sourceChannel
    expect(alertFn).toHaveBeenCalledTimes(1);
    expect(alertFn).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ sourceChannel: "dashboard" }),
    );
    // S1 simplified model: alert fails → initiate as fallback
    expect(initiateFn).toHaveBeenCalledTimes(1);
    // Notification delivered via fallback
    expect(queue.listPending()).toHaveLength(0);
  });

  it("alert passes sourceChannel through to conversationInitiator", async () => {
    alertFn.mockResolvedValue(true);
    queue.enqueue(makeNotification({ source_channel: "dashboard" }));

    await (heartbeat as any).deliverPendingNotifications();

    expect(alertFn).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ sourceChannel: "dashboard" }),
    );
  });

  it("undefined source_channel + alert fails → initiate() immediately", async () => {
    queue.enqueue(makeNotification()); // no source_channel

    await (heartbeat as any).deliverPendingNotifications();

    expect(alertFn).toHaveBeenCalledTimes(1);
    expect(initiateFn).toHaveBeenCalledTimes(1);
    expect(queue.listPending()).toHaveLength(0);
  });

  it("backward compat: no source_channel field → treated as undefined", async () => {
    const notification = makeNotification();
    delete (notification as any).source_channel;
    queue.enqueue(notification);

    await (heartbeat as any).deliverPendingNotifications();

    // Should fall through to initiate() (same as undefined)
    expect(initiateFn).toHaveBeenCalledTimes(1);
    expect(queue.listPending()).toHaveLength(0);
  });

  it("any source_channel + alert succeeds → delivered normally", async () => {
    alertFn.mockResolvedValue(true); // current conversation exists
    queue.enqueue(makeNotification({ source_channel: "dashboard" }));

    await (heartbeat as any).deliverPendingNotifications();

    expect(alertFn).toHaveBeenCalledTimes(1);
    expect(initiateFn).not.toHaveBeenCalled();
    expect(queue.listPending()).toHaveLength(0); // delivered
  });
});
