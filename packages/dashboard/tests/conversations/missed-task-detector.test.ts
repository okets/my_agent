import { describe, it, expect, vi, beforeEach } from "vitest";
import { PostResponseHooks } from "../../src/conversations/post-response-hooks.js";
import { extractTaskFromMessage } from "../../src/tasks/task-extractor.js";

vi.mock("../../src/tasks/task-extractor.js", () => ({
  extractTaskFromMessage: vi.fn(),
}));

const mockedExtract = vi.mocked(extractTaskFromMessage);

function createMockDeps() {
  return {
    taskManager: {
      getTasksForConversation: vi.fn().mockReturnValue([]),
    },
    log: vi.fn(),
    logError: vi.fn(),
  };
}

describe("PostResponseHooks — missed task detection", () => {
  let deps: ReturnType<typeof createMockDeps>;

  beforeEach(() => {
    vi.clearAllMocks();
    deps = createMockDeps();
  });

  it("logs warning when Nina missed a task-worthy request", async () => {
    mockedExtract.mockResolvedValueOnce({
      shouldCreateTask: true,
      task: {
        type: "immediate",
        title: "Research Thai restaurants",
        instructions: "Find top Thai restaurants",
        work: [],
      },
    });

    const hooks = new PostResponseHooks(deps as any);
    await hooks.run("conv-01", "Find the best Thai restaurants", "Here are some suggestions...");

    expect(deps.log).toHaveBeenCalledWith(
      expect.stringContaining("[MissedTaskDetector]"),
    );
    expect(deps.log).toHaveBeenCalledWith(
      expect.stringContaining("Research Thai restaurants"),
    );
  });

  it("does NOT log when Nina already created a task recently", async () => {
    mockedExtract.mockResolvedValueOnce({
      shouldCreateTask: true,
      task: {
        type: "immediate",
        title: "Research flights",
        instructions: "Find flights",
        work: [],
      },
    });

    // Return a recent task link
    deps.taskManager.getTasksForConversation.mockReturnValue([
      { taskId: "task-01", linkedAt: new Date().toISOString() },
    ]);

    const hooks = new PostResponseHooks(deps as any);
    await hooks.run("conv-01", "Find flights to Bangkok", "I'll research that for you.");

    expect(deps.log).not.toHaveBeenCalled();
  });

  it("does NOT log when extraction says no task needed", async () => {
    mockedExtract.mockResolvedValueOnce({
      shouldCreateTask: false,
    });

    const hooks = new PostResponseHooks(deps as any);
    await hooks.run("conv-01", "Hello", "Hi there!");

    expect(deps.log).not.toHaveBeenCalled();
  });

  it("does NOT create tasks (detection only)", async () => {
    mockedExtract.mockResolvedValueOnce({
      shouldCreateTask: true,
      task: {
        type: "immediate",
        title: "Some task",
        instructions: "Do something",
        work: [],
      },
    });

    const hooks = new PostResponseHooks(deps as any);
    await hooks.run("conv-01", "Do research", "Sure");

    // No create method should exist or be called
    expect(deps.taskManager).not.toHaveProperty("create");
  });

  it("ignores old linked tasks (older than 5 minutes)", async () => {
    mockedExtract.mockResolvedValueOnce({
      shouldCreateTask: true,
      task: {
        type: "immediate",
        title: "Missed task",
        instructions: "Do it",
        work: [],
      },
    });

    // Return a stale task link (10 minutes old)
    const tenMinutesAgo = new Date(Date.now() - 600_000).toISOString();
    deps.taskManager.getTasksForConversation.mockReturnValue([
      { taskId: "task-old", linkedAt: tenMinutesAgo },
    ]);

    const hooks = new PostResponseHooks(deps as any);
    await hooks.run("conv-01", "Do research", "Sure");

    // Should still log because the linked task is old
    expect(deps.log).toHaveBeenCalledWith(
      expect.stringContaining("[MissedTaskDetector]"),
    );
  });

  it("handles extraction errors gracefully", async () => {
    mockedExtract.mockRejectedValueOnce(new Error("API down"));

    const hooks = new PostResponseHooks(deps as any);
    // Should not throw
    await hooks.run("conv-01", "Do research", "Sure");

    expect(deps.log).not.toHaveBeenCalled();
    expect(deps.logError).not.toHaveBeenCalled();
  });
});
