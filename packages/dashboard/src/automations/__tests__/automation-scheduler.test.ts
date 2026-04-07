import { describe, it, expect, vi, beforeEach } from "vitest";
import { AutomationScheduler } from "../automation-scheduler.js";

function makeScheduler(overrides: {
  listJobs?: ReturnType<typeof vi.fn>;
  list?: ReturnType<typeof vi.fn>;
} = {}) {
  const mockJobService = {
    listJobs: overrides.listJobs ?? vi.fn(() => []),
    updateJob: vi.fn(),
    updateJobContext: vi.fn(),
    getJob: vi.fn(),
  };
  const mockAutomationManager = {
    list: overrides.list ?? vi.fn(() => []),
    findById: vi.fn(),
  };
  const mockProcessor = { fire: vi.fn(() => Promise.resolve()) };

  const scheduler = new AutomationScheduler({
    processor: mockProcessor as any,
    automationManager: mockAutomationManager as any,
    jobService: mockJobService as any,
    agentDir: "/tmp/test-agent",
    pollIntervalMs: 60_000,
  });

  return { scheduler, mockJobService, mockProcessor, mockAutomationManager };
}

describe("AutomationScheduler.isCronDue", () => {
  it("returns true at exact cron tick second (prev() boundary)", () => {
    const { scheduler } = makeScheduler({
      listJobs: vi.fn(() => [
        // Last job was yesterday's tick
        { automationId: "debrief", created: "2026-04-06T01:00:21Z" },
      ]),
    });

    // At exactly 01:00:00 UTC (= 08:00:00 Bangkok), cron "0 8 * * *" should be due
    const result = scheduler.isCronDue(
      "0 8 * * *",
      { id: "debrief", manifest: {} },
      new Date("2026-04-07T01:00:00Z"),
      "Asia/Bangkok",
    );

    expect(result).toBe(true);
  });

  it("returns true one minute after cron tick", () => {
    const { scheduler } = makeScheduler({
      listJobs: vi.fn(() => [
        { automationId: "debrief", created: "2026-04-06T01:00:21Z" },
      ]),
    });

    const result = scheduler.isCronDue(
      "0 8 * * *",
      { id: "debrief", manifest: {} },
      new Date("2026-04-07T01:01:00Z"),
      "Asia/Bangkok",
    );

    expect(result).toBe(true);
  });

  it("returns false when manual run is newer than cron tick", () => {
    const { scheduler } = makeScheduler({
      listJobs: vi.fn(() => [
        // Manual run after today's cron tick
        { automationId: "debrief", created: "2026-04-07T02:00:00Z" },
      ]),
    });

    const result = scheduler.isCronDue(
      "0 8 * * *",
      { id: "debrief", manifest: {} },
      new Date("2026-04-07T01:01:00Z"),
      "Asia/Bangkok",
    );

    expect(result).toBe(false);
  });

  it("returns true when never ran before", () => {
    const { scheduler } = makeScheduler({
      listJobs: vi.fn(() => []),
    });

    const result = scheduler.isCronDue(
      "0 8 * * *",
      { id: "debrief", manifest: {} },
      new Date("2026-04-07T01:00:00Z"),
      "Asia/Bangkok",
    );

    expect(result).toBe(true);
  });
});

describe("AutomationScheduler.checkDue error handling", () => {
  it("does not kill the interval when checkDue throws", async () => {
    const { scheduler, mockAutomationManager } = makeScheduler();

    // Make list() throw to simulate an error in checkDue
    mockAutomationManager.list.mockImplementation(() => {
      throw new Error("DB connection lost");
    });

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    // start() calls checkDue() immediately — should not throw
    await scheduler.start();

    // The scheduler should still be running (interval not killed)
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("checkDue failed"),
      expect.any(Error),
    );

    await scheduler.stop();
    consoleSpy.mockRestore();
  });
});
