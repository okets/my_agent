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
    const alert = vi.fn().mockResolvedValue({ status: "delivered" });
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
    const alert = vi.fn().mockResolvedValue({ status: "delivered" });
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
    const alert = vi.fn().mockResolvedValue({ status: "delivered" });
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

describe("HeartbeatService.checkCapabilityHealth (M9.6-S24 Mode 4)", () => {
  it("fires the capabilityHealthCheck callback on tick when interval has elapsed", async () => {
    const capabilityHealthCheck = vi.fn().mockResolvedValue(undefined);
    const hb = new HeartbeatService(
      baseConfig({
        capabilityHealthIntervalMs: 0, // fire every tick
        capabilityHealthCheck,
      }),
    );

    await hb.tick();
    expect(capabilityHealthCheck).toHaveBeenCalledTimes(1);
  });

  it("emits system-origin CFR for degraded caps that have no in-flight recovery", async () => {
    const emitFailure = vi.fn();
    const isInFlight = vi.fn().mockReturnValue(false);
    const testAll = vi.fn().mockResolvedValue(undefined);
    const list = vi.fn().mockReturnValue([
      {
        name: "stt-deepgram",
        provides: "audio-to-text",
        health: "degraded",
        degradedReason: "401 Unauthorized",
      },
    ]);

    // Inline-built callback mirrors the wiring in app.ts
    const capabilityHealthCheck = async () => {
      await testAll();
      for (const cap of list() as Array<{
        name: string;
        provides?: string;
        health: string;
        degradedReason?: string;
      }>) {
        if (cap.health !== "degraded") continue;
        const capType = cap.provides ?? cap.name;
        if (isInFlight(capType)) continue;
        emitFailure({
          capabilityType: capType,
          capabilityName: cap.name,
          symptom: "execution-error",
          detail: cap.degradedReason ?? "daily probe: capability degraded",
          triggeringInput: {
            origin: {
              kind: "system",
              component: "capability-health-probe",
            },
          },
        });
      }
    };

    const hb = new HeartbeatService(
      baseConfig({
        capabilityHealthIntervalMs: 0,
        capabilityHealthCheck,
      }),
    );

    await hb.tick();

    expect(testAll).toHaveBeenCalledTimes(1);
    expect(isInFlight).toHaveBeenCalledWith("audio-to-text");
    expect(emitFailure).toHaveBeenCalledTimes(1);
    expect(emitFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        capabilityType: "audio-to-text",
        capabilityName: "stt-deepgram",
        symptom: "execution-error",
        detail: "401 Unauthorized",
        triggeringInput: {
          origin: {
            kind: "system",
            component: "capability-health-probe",
          },
        },
      }),
    );
  });

  it("skips degraded caps that already have an in-flight recovery", async () => {
    const emitFailure = vi.fn();
    const isInFlight = vi.fn().mockReturnValue(true);
    const testAll = vi.fn().mockResolvedValue(undefined);
    const list = vi.fn().mockReturnValue([
      {
        name: "tts-elevenlabs",
        provides: "text-to-audio",
        health: "degraded",
        degradedReason: "timeout",
      },
    ]);

    const capabilityHealthCheck = async () => {
      await testAll();
      for (const cap of list() as Array<{
        name: string;
        provides?: string;
        health: string;
        degradedReason?: string;
      }>) {
        if (cap.health !== "degraded") continue;
        const capType = cap.provides ?? cap.name;
        if (isInFlight(capType)) continue;
        emitFailure({
          capabilityType: capType,
          capabilityName: cap.name,
          symptom: "execution-error",
          detail: cap.degradedReason ?? "daily probe: capability degraded",
          triggeringInput: {
            origin: {
              kind: "system",
              component: "capability-health-probe",
            },
          },
        });
      }
    };

    const hb = new HeartbeatService(
      baseConfig({
        capabilityHealthIntervalMs: 0,
        capabilityHealthCheck,
      }),
    );

    await hb.tick();

    expect(testAll).toHaveBeenCalledTimes(1);
    expect(isInFlight).toHaveBeenCalledWith("text-to-audio");
    expect(emitFailure).not.toHaveBeenCalled();
  });

  it("ignores healthy and untested caps", async () => {
    const emitFailure = vi.fn();
    const isInFlight = vi.fn().mockReturnValue(false);
    const testAll = vi.fn().mockResolvedValue(undefined);
    const list = vi.fn().mockReturnValue([
      { name: "cap-a", provides: "a", health: "healthy" },
      { name: "cap-b", provides: "b", health: "untested" },
    ]);

    const capabilityHealthCheck = async () => {
      await testAll();
      for (const cap of list() as Array<{
        name: string;
        provides?: string;
        health: string;
        degradedReason?: string;
      }>) {
        if (cap.health !== "degraded") continue;
        const capType = cap.provides ?? cap.name;
        if (isInFlight(capType)) continue;
        emitFailure({
          capabilityType: capType,
          capabilityName: cap.name,
          symptom: "execution-error",
          detail: cap.degradedReason ?? "daily probe: capability degraded",
          triggeringInput: {
            origin: {
              kind: "system",
              component: "capability-health-probe",
            },
          },
        });
      }
    };

    const hb = new HeartbeatService(
      baseConfig({
        capabilityHealthIntervalMs: 0,
        capabilityHealthCheck,
      }),
    );

    await hb.tick();
    expect(emitFailure).not.toHaveBeenCalled();
    expect(isInFlight).not.toHaveBeenCalled();
  });
});
