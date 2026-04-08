import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { HeartbeatService } from "../../../src/automations/heartbeat-service.js";
import { PersistentNotificationQueue, type PersistentNotification } from "../../../src/notifications/persistent-queue.js";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

/**
 * M9.3-S3.5: Source channel routing tests
 *
 * Verifies the heartbeat delivery logic respects source_channel:
 * - Dashboard-sourced notifications wait for web session (no WhatsApp bleed)
 * - Escalation after 60 attempts (~30 min)
 * - Undefined source_channel falls through to initiate() immediately
 * - Backward compat: missing source_channel treated as undefined
 * - Any source_channel + successful alert() → delivered normally
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
    alertFn = vi.fn().mockResolvedValue(false); // default: no active web conversation
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

  it("dashboard-sourced + alert fails → stays in queue, no initiate()", async () => {
    queue.enqueue(makeNotification({ source_channel: "dashboard" }));

    // Trigger delivery manually
    await (heartbeat as any).deliverPendingNotifications();

    // alert was called
    expect(alertFn).toHaveBeenCalledTimes(1);
    // initiate was NOT called (no WhatsApp bleed)
    expect(initiateFn).not.toHaveBeenCalled();
    // Notification still pending (not delivered)
    expect(queue.listPending()).toHaveLength(1);
    // Delivery attempts incremented
    expect(queue.listPending()[0].delivery_attempts).toBe(1);
  });

  it("dashboard-sourced after 60 attempts → escalates to initiate()", async () => {
    queue.enqueue(
      makeNotification({ source_channel: "dashboard", delivery_attempts: 60 }),
    );

    await (heartbeat as any).deliverPendingNotifications();

    // Should escalate — initiate() called
    expect(initiateFn).toHaveBeenCalledTimes(1);
    // Notification delivered (moved from pending)
    expect(queue.listPending()).toHaveLength(0);
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
    alertFn.mockResolvedValue(true); // active web conversation
    queue.enqueue(makeNotification({ source_channel: "dashboard" }));

    await (heartbeat as any).deliverPendingNotifications();

    expect(alertFn).toHaveBeenCalledTimes(1);
    expect(initiateFn).not.toHaveBeenCalled();
    expect(queue.listPending()).toHaveLength(0); // delivered
  });
});
