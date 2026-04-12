/**
 * M9.4-S5: Heartbeat drainNow + handoff_pending broadcast + reentrancy guard
 */

import { describe, it, expect, vi } from "vitest";
import { HeartbeatService } from "../../../src/automations/heartbeat-service.js";
import type { HeartbeatConfig } from "../../../src/automations/heartbeat-service.js";

function mockJobService(): any {
  return {
    listJobs: vi.fn().mockReturnValue([]),
    updateJob: vi.fn(),
  };
}

function mockQueue(pendingNotifications: any[]): any {
  return {
    listPending: vi
      .fn()
      .mockReturnValueOnce(pendingNotifications)
      .mockReturnValue([]),
    markDelivered: vi.fn(),
    incrementAttempts: vi.fn(),
    enqueue: vi.fn(),
  };
}

function baseConfig(overrides: Partial<HeartbeatConfig>): HeartbeatConfig {
  return {
    jobService: mockJobService(),
    notificationQueue: mockQueue([]),
    conversationInitiator: null,
    staleThresholdMs: 999999,
    tickIntervalMs: 999999,
    capabilityHealthIntervalMs: 999999,
    ...overrides,
  };
}

describe("HeartbeatService.drainNow (M9.4-S5)", () => {
  it("delivers pending notifications when called directly", async () => {
    const alert = vi.fn().mockResolvedValue(true);
    const queue = mockQueue([
      { job_id: "job-1", _filename: "1.json", delivery_attempts: 0, type: "job_completed", summary: "ok" },
    ]);
    const hb = new HeartbeatService(
      baseConfig({
        notificationQueue: queue,
        conversationInitiator: { alert, initiate: vi.fn() },
      }),
    );

    await hb.drainNow();
    expect(alert).toHaveBeenCalledTimes(1);
    expect(queue.markDelivered).toHaveBeenCalledWith("1.json");
  });

  it("passes triggerJobId to alert()", async () => {
    const alert = vi.fn().mockResolvedValue(true);
    const queue = mockQueue([
      { job_id: "job-xyz", _filename: "x.json", delivery_attempts: 0, type: "job_completed", summary: "ok" },
    ]);
    const hb = new HeartbeatService(
      baseConfig({
        notificationQueue: queue,
        conversationInitiator: { alert, initiate: vi.fn() },
      }),
    );

    await hb.drainNow();
    expect(alert).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ triggerJobId: "job-xyz" }),
    );
  });

  it("is reentrancy-guarded — concurrent drainNow calls don't double-deliver", async () => {
    let alertCount = 0;
    const slowAlert = vi.fn(async () => {
      alertCount++;
      await new Promise((r) => setTimeout(r, 50));
      return true;
    });
    const queue = mockQueue([
      { job_id: "job-1", _filename: "1.json", delivery_attempts: 0, type: "job_completed", summary: "ok" },
    ]);
    const hb = new HeartbeatService(
      baseConfig({
        notificationQueue: queue,
        conversationInitiator: { alert: slowAlert, initiate: vi.fn() },
      }),
    );

    await Promise.all([hb.drainNow(), hb.drainNow(), hb.drainNow()]);
    expect(alertCount).toBe(1);
  });

  it("broadcasts handoff_pending for every pending notification BEFORE first alert awaits (Stage 1)", async () => {
    const broadcasts: any[] = [];
    const registry = {
      broadcastToAll: vi.fn((msg: any) => broadcasts.push({ ...msg, at: broadcasts.length })),
    } as any;

    let firstAlertEntered = false;
    const alert = vi.fn(async () => {
      if (!firstAlertEntered) {
        firstAlertEntered = true;
        // At first alert entry, all three upfront handoff_pending broadcasts
        // + the Stage-2 for the first notification must already be in the log.
        const pendingBroadcasts = broadcasts
          .filter((b) => b.type === "handoff_pending")
          .map((b) => b.jobId);
        expect(pendingBroadcasts).toEqual(
          expect.arrayContaining(["job-1", "job-2", "job-3"]),
        );
      }
      return true;
    });

    const queue = mockQueue([
      { job_id: "job-1", _filename: "1.json", delivery_attempts: 0, type: "job_completed", summary: "ok" },
      { job_id: "job-2", _filename: "2.json", delivery_attempts: 0, type: "job_completed", summary: "ok" },
      { job_id: "job-3", _filename: "3.json", delivery_attempts: 0, type: "job_completed", summary: "ok" },
    ]);

    const hb = new HeartbeatService(
      baseConfig({
        notificationQueue: queue,
        conversationInitiator: { alert, initiate: vi.fn() },
        registry,
      }),
    );

    await hb.drainNow();
    expect(firstAlertEntered).toBe(true);
  });

  it("honors MAX_DELIVERY_ATTEMPTS guard — skips alert and moves to delivered", async () => {
    const alert = vi.fn().mockResolvedValue(true);
    const queue = mockQueue([
      { job_id: "job-exceeded", _filename: "x.json", delivery_attempts: 10, type: "job_completed", summary: "ok" },
    ]);
    const hb = new HeartbeatService(
      baseConfig({
        notificationQueue: queue,
        conversationInitiator: { alert, initiate: vi.fn() },
      }),
    );

    await hb.drainNow();
    expect(alert).not.toHaveBeenCalled();
    expect(queue.markDelivered).toHaveBeenCalledWith("x.json");
  });
});
