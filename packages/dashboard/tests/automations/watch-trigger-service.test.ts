import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  WatchTriggerService,
  type WatchTriggerServiceDeps,
  type WatchTriggerConfig,
} from "../../src/automations/watch-trigger-service.js";

// Mock chokidar
const mockWatcher = {
  on: vi.fn().mockReturnThis(),
  close: vi.fn().mockResolvedValue(undefined),
};

vi.mock("chokidar", () => ({
  watch: vi.fn(() => mockWatcher),
}));

function makeDeps(overrides?: Partial<WatchTriggerServiceDeps>): WatchTriggerServiceDeps {
  return {
    getWatchTriggers: vi.fn<() => WatchTriggerConfig[]>(() => []),
    fireAutomation: vi.fn<(id: string, ctx: Record<string, unknown>) => Promise<void>>().mockResolvedValue(undefined),
    log: vi.fn(),
    logError: vi.fn(),
    ...overrides,
  };
}

describe("WatchTriggerService", () => {
  let service: WatchTriggerService;
  let deps: WatchTriggerServiceDeps;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockWatcher.on.mockReturnThis();
    mockWatcher.close.mockResolvedValue(undefined);
  });

  afterEach(async () => {
    vi.useRealTimers();
  });

  // --- Task 1: types + class skeleton ---

  it("creates an instance with default debounce", () => {
    deps = makeDeps();
    service = new WatchTriggerService(deps);
    expect(service).toBeInstanceOf(WatchTriggerService);
  });

  it("accepts custom debounce duration", () => {
    deps = makeDeps();
    service = new WatchTriggerService(deps, 2000);
    expect(service).toBeInstanceOf(WatchTriggerService);
  });

  // --- Task 2: start() and stop() ---

  it("registers watchers for all configured watch triggers on start()", async () => {
    const { watch } = await import("chokidar");
    deps = makeDeps({
      getWatchTriggers: vi.fn(() => [
        { automationId: "auto-1", path: "/mnt/nas/invoices" },
        { automationId: "auto-2", path: "/mnt/nas/reports" },
      ]),
    });
    service = new WatchTriggerService(deps);
    await service.start();

    expect(watch).toHaveBeenCalledTimes(2);
    expect(service.getWatchers().size).toBe(2);
    expect(service.getWatchers().has("/mnt/nas/invoices")).toBe(true);
    expect(service.getWatchers().has("/mnt/nas/reports")).toBe(true);
  });

  it("uses polling mode by default", async () => {
    const { watch } = await import("chokidar");
    deps = makeDeps({
      getWatchTriggers: vi.fn(() => [
        { automationId: "auto-1", path: "/mnt/nas/data" },
      ]),
    });
    service = new WatchTriggerService(deps);
    await service.start();

    expect(watch).toHaveBeenCalledWith("/mnt/nas/data", expect.objectContaining({
      usePolling: true,
      interval: 5000,
    }));
  });

  it("maps multiple automations to the same path", async () => {
    deps = makeDeps({
      getWatchTriggers: vi.fn(() => [
        { automationId: "auto-1", path: "/mnt/shared" },
        { automationId: "auto-2", path: "/mnt/shared" },
      ]),
    });
    service = new WatchTriggerService(deps);
    await service.start();

    // Only one watcher for the path
    expect(service.getWatchers().size).toBe(1);
    // Both automation IDs mapped
    expect(service.getPathToAutomations().get("/mnt/shared")).toEqual(["auto-1", "auto-2"]);
  });

  it("registers event handlers for configured events", async () => {
    deps = makeDeps({
      getWatchTriggers: vi.fn(() => [
        { automationId: "auto-1", path: "/mnt/data", events: ["add", "change", "unlink"] },
      ]),
    });
    service = new WatchTriggerService(deps);
    await service.start();

    // 3 event handlers + 1 error handler
    expect(mockWatcher.on).toHaveBeenCalledWith("add", expect.any(Function));
    expect(mockWatcher.on).toHaveBeenCalledWith("change", expect.any(Function));
    expect(mockWatcher.on).toHaveBeenCalledWith("unlink", expect.any(Function));
    expect(mockWatcher.on).toHaveBeenCalledWith("error", expect.any(Function));
  });

  it("defaults to add and change events when not specified", async () => {
    deps = makeDeps({
      getWatchTriggers: vi.fn(() => [
        { automationId: "auto-1", path: "/mnt/data" },
      ]),
    });
    service = new WatchTriggerService(deps);
    await service.start();

    expect(mockWatcher.on).toHaveBeenCalledWith("add", expect.any(Function));
    expect(mockWatcher.on).toHaveBeenCalledWith("change", expect.any(Function));
    // Should NOT register unlink
    const unlinkCalls = mockWatcher.on.mock.calls.filter((c: [string, unknown]) => c[0] === "unlink");
    expect(unlinkCalls.length).toBe(0);
  });

  it("stops all watchers and clears state on stop()", async () => {
    deps = makeDeps({
      getWatchTriggers: vi.fn(() => [
        { automationId: "auto-1", path: "/mnt/nas/invoices" },
        { automationId: "auto-2", path: "/mnt/nas/reports" },
      ]),
    });
    service = new WatchTriggerService(deps);
    await service.start();
    await service.stop();

    expect(mockWatcher.close).toHaveBeenCalledTimes(2);
    expect(service.getWatchers().size).toBe(0);
    expect(service.getPathToAutomations().size).toBe(0);
  });

  it("does nothing on start() with no watch triggers", async () => {
    const { watch } = await import("chokidar");
    deps = makeDeps({
      getWatchTriggers: vi.fn(() => []),
    });
    service = new WatchTriggerService(deps);
    await service.start();

    expect(watch).not.toHaveBeenCalled();
    expect(service.getWatchers().size).toBe(0);
  });

  // --- Task 3: dynamic sync() ---

  it("tears down stale watchers and registers new ones on sync()", async () => {
    const { watch } = await import("chokidar");
    const triggers: WatchTriggerConfig[] = [
      { automationId: "auto-1", path: "/mnt/nas/old" },
    ];
    deps = makeDeps({
      getWatchTriggers: vi.fn(() => triggers),
    });
    service = new WatchTriggerService(deps);
    await service.start();

    // Change triggers to a new path
    triggers.length = 0;
    triggers.push({ automationId: "auto-2", path: "/mnt/nas/new" });

    await service.sync();

    // Old watcher closed
    expect(mockWatcher.close).toHaveBeenCalled();
    // New watcher created
    expect(service.getWatchers().has("/mnt/nas/new")).toBe(true);
    expect(service.getWatchers().has("/mnt/nas/old")).toBe(false);
  });

  it("updates automation mappings on sync() without replacing existing watchers", async () => {
    const triggers: WatchTriggerConfig[] = [
      { automationId: "auto-1", path: "/mnt/shared" },
    ];
    deps = makeDeps({
      getWatchTriggers: vi.fn(() => triggers),
    });
    service = new WatchTriggerService(deps);
    await service.start();

    // Add a second automation to the same path
    triggers.push({ automationId: "auto-2", path: "/mnt/shared" });

    const closeCountBefore = mockWatcher.close.mock.calls.length;
    await service.sync();

    // No new watcher created or closed — same path
    expect(mockWatcher.close.mock.calls.length).toBe(closeCountBefore);
    // But mapping is updated
    expect(service.getPathToAutomations().get("/mnt/shared")).toEqual(["auto-1", "auto-2"]);
  });

  // --- Task 4: space-level debouncing ---

  it("debounces rapid file events within window into one job", async () => {
    deps = makeDeps({
      getWatchTriggers: vi.fn(() => [
        { automationId: "auto-1", path: "/mnt/data" },
      ]),
    });
    service = new WatchTriggerService(deps, 100); // 100ms debounce for test
    await service.start();

    // Simulate rapid file events
    service.handleFileEvent("/mnt/data", "/mnt/data/file1.pdf", "add");
    service.handleFileEvent("/mnt/data", "/mnt/data/file2.pdf", "add");
    service.handleFileEvent("/mnt/data", "/mnt/data/file3.pdf", "add");

    // Not yet fired
    expect(deps.fireAutomation).not.toHaveBeenCalled();

    // Advance past debounce window
    await vi.advanceTimersByTimeAsync(150);

    // Fired once with all files batched
    expect(deps.fireAutomation).toHaveBeenCalledTimes(1);
    expect(deps.fireAutomation).toHaveBeenCalledWith("auto-1", expect.objectContaining({
      trigger: "watch",
      files: ["/mnt/data/file1.pdf", "/mnt/data/file2.pdf", "/mnt/data/file3.pdf"],
      batchSize: 3,
    }));
  });

  it("fires automation with batched file list after debounce", async () => {
    deps = makeDeps({
      getWatchTriggers: vi.fn(() => [
        { automationId: "auto-1", path: "/mnt/invoices" },
      ]),
    });
    service = new WatchTriggerService(deps, 50);
    await service.start();

    service.handleFileEvent("/mnt/invoices", "/mnt/invoices/inv-001.pdf", "add");

    await vi.advanceTimersByTimeAsync(100);

    expect(deps.fireAutomation).toHaveBeenCalledWith("auto-1", expect.objectContaining({
      trigger: "watch",
      files: ["/mnt/invoices/inv-001.pdf"],
      event: "add",
      batchSize: 1,
    }));
  });

  it("fires all mapped automations for the same path", async () => {
    deps = makeDeps({
      getWatchTriggers: vi.fn(() => [
        { automationId: "auto-1", path: "/mnt/shared" },
        { automationId: "auto-2", path: "/mnt/shared" },
      ]),
    });
    service = new WatchTriggerService(deps, 50);
    await service.start();

    service.handleFileEvent("/mnt/shared", "/mnt/shared/doc.pdf", "add");

    await vi.advanceTimersByTimeAsync(100);

    expect(deps.fireAutomation).toHaveBeenCalledTimes(2);
    expect(deps.fireAutomation).toHaveBeenCalledWith("auto-1", expect.any(Object));
    expect(deps.fireAutomation).toHaveBeenCalledWith("auto-2", expect.any(Object));
  });

  it("deduplicates the same file in one debounce window", async () => {
    deps = makeDeps({
      getWatchTriggers: vi.fn(() => [
        { automationId: "auto-1", path: "/mnt/data" },
      ]),
    });
    service = new WatchTriggerService(deps, 100);
    await service.start();

    service.handleFileEvent("/mnt/data", "/mnt/data/file1.pdf", "add");
    service.handleFileEvent("/mnt/data", "/mnt/data/file1.pdf", "change");

    await vi.advanceTimersByTimeAsync(150);

    expect(deps.fireAutomation).toHaveBeenCalledWith("auto-1", expect.objectContaining({
      files: ["/mnt/data/file1.pdf"],
      batchSize: 1,
    }));
  });

  it("resets debounce timer on each new event", async () => {
    deps = makeDeps({
      getWatchTriggers: vi.fn(() => [
        { automationId: "auto-1", path: "/mnt/data" },
      ]),
    });
    service = new WatchTriggerService(deps, 100);
    await service.start();

    service.handleFileEvent("/mnt/data", "/mnt/data/file1.pdf", "add");
    await vi.advanceTimersByTimeAsync(80); // Not fired yet

    service.handleFileEvent("/mnt/data", "/mnt/data/file2.pdf", "add");
    await vi.advanceTimersByTimeAsync(80); // Still not fired (timer reset)

    expect(deps.fireAutomation).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(50); // Now fires (80ms > 100ms debounce)
    expect(deps.fireAutomation).toHaveBeenCalledTimes(1);
  });

  it("emits triggered event after firing automations", async () => {
    deps = makeDeps({
      getWatchTriggers: vi.fn(() => [
        { automationId: "auto-1", path: "/mnt/data" },
      ]),
    });
    service = new WatchTriggerService(deps, 50);
    await service.start();

    const triggered = vi.fn();
    service.on("triggered", triggered);

    service.handleFileEvent("/mnt/data", "/mnt/data/file.pdf", "add");
    await vi.advanceTimersByTimeAsync(100);

    expect(triggered).toHaveBeenCalledWith(expect.objectContaining({
      automationIds: ["auto-1"],
      files: ["/mnt/data/file.pdf"],
      trigger: "watch",
    }));
  });

  // --- Task 5: mount failure handling ---

  it("retries with backoff on mount failure", async () => {
    deps = makeDeps({
      getWatchTriggers: vi.fn(() => [
        { automationId: "auto-1", path: "/mnt/nas/data" },
      ]),
    });
    service = new WatchTriggerService(deps, 50);
    await service.start();

    service.handleWatcherError("/mnt/nas/data", new Error("ENOENT: mount lost"));

    // Should log error and schedule retry
    expect(deps.logError).toHaveBeenCalled();
    expect(service.getMountRetryAttempts().get("/mnt/nas/data")).toBe(1);
  });

  it("emits mount_failure on persistent failure after max attempts", async () => {
    deps = makeDeps({
      getWatchTriggers: vi.fn(() => [
        { automationId: "auto-1", path: "/mnt/nas/data" },
      ]),
    });
    service = new WatchTriggerService(deps, 50);
    await service.start();

    const mountFailure = vi.fn();
    service.on("mount_failure", mountFailure);

    // Exhaust retry attempts
    for (let i = 0; i < 51; i++) {
      service.handleWatcherError("/mnt/nas/data", new Error("mount lost"));
    }

    expect(mountFailure).toHaveBeenCalledWith(expect.objectContaining({
      path: "/mnt/nas/data",
    }));
  });

  it("clears pending timers on stop()", async () => {
    deps = makeDeps({
      getWatchTriggers: vi.fn(() => [
        { automationId: "auto-1", path: "/mnt/data" },
      ]),
    });
    service = new WatchTriggerService(deps, 5000);
    await service.start();

    service.handleFileEvent("/mnt/data", "/mnt/data/file.pdf", "add");
    expect(service.getPendingEvents().size).toBe(1);

    await service.stop();
    expect(service.getPendingEvents().size).toBe(0);
  });
});
