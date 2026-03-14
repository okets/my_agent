import { describe, it, expect, vi, beforeEach } from "vitest";

// Capture options passed to createBrainQuery
let capturedOptions: any = null;

vi.mock("@my-agent/core", async () => {
  const actual = await vi.importActual("@my-agent/core");
  return {
    ...(actual as object),
    createBrainQuery: vi.fn((prompt: string, options: any) => {
      capturedOptions = options;
      // Return a minimal async generator
      return (async function* () {
        yield { type: "result" };
      })();
    }),
    loadConfig: vi.fn(() => ({
      model: "claude-sonnet-4-6",
      brainDir: "/tmp/brain",
    })),
    assembleCalendarContext: vi.fn().mockResolvedValue(undefined),
    loadCalendarConfig: vi.fn().mockReturnValue(null),
    loadCalendarCredentials: vi.fn().mockReturnValue(null),
  };
});

vi.mock("../../src/tasks/working-nina-prompt.js", () => ({
  buildWorkingNinaPrompt: vi.fn().mockResolvedValue("Working Nina system prompt"),
}));

import { TaskExecutor } from "../../src/tasks/task-executor.js";
import type { Task } from "@my-agent/core";

// Minimal mock for TaskManager
function makeTaskManager() {
  return {
    update: vi.fn(),
  } as any;
}

// Minimal mock for TaskLogStorage
function makeLogStorage(agentDir: string = "/tmp/agent") {
  return {
    exists: vi.fn().mockReturnValue(true),
    createLog: vi.fn(),
    getTaskDir: vi.fn((taskId: string) => `${agentDir}/tasks/${taskId}`),
    getTurnCount: vi.fn().mockReturnValue(0),
    appendTurn: vi.fn(),
    appendEvent: vi.fn(),
    getRecentTurns: vi.fn().mockReturnValue([]),
  } as any;
}

// Minimal mock for ConversationDatabase
function makeDb() {
  return {
    getTaskSdkSessionId: vi.fn().mockReturnValue(null),
    updateTaskSdkSessionId: vi.fn(),
  } as any;
}

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "task-001",
    sessionId: "session-001",
    title: "Test Task",
    status: "pending",
    instructions: "Do something useful",
    work: [],
    delivery: [],
    createdAt: new Date(),
    ...overrides,
  } as Task;
}

describe("TaskExecutor — agentic session config", () => {
  const agentDir = "/tmp/agent";

  beforeEach(() => {
    capturedOptions = null;
    vi.clearAllMocks();
  });

  it("passes cwd = logStorage.getTaskDir(taskId)", async () => {
    const logStorage = makeLogStorage(agentDir);
    const executor = new TaskExecutor({
      taskManager: makeTaskManager(),
      logStorage,
      agentDir,
      db: makeDb(),
    });

    const task = makeTask();
    await executor.run(task);

    expect(logStorage.getTaskDir).toHaveBeenCalledWith(task.id);
    expect(capturedOptions?.cwd).toBe(`${agentDir}/tasks/${task.id}`);
  });

  it("passes tools = [Bash, Read, Write, Edit, Glob, Grep]", async () => {
    const executor = new TaskExecutor({
      taskManager: makeTaskManager(),
      logStorage: makeLogStorage(agentDir),
      agentDir,
      db: makeDb(),
    });

    await executor.run(makeTask());

    expect(capturedOptions?.tools).toEqual([
      "Bash",
      "Read",
      "Write",
      "Edit",
      "Glob",
      "Grep",
    ]);
  });

  it("passes hooks when provided", async () => {
    const mockHooks = {
      PreToolUse: [{ matcher: "Bash", hooks: [] }],
      PostToolUse: [{ matcher: ".*", hooks: [] }],
    };

    const executor = new TaskExecutor({
      taskManager: makeTaskManager(),
      logStorage: makeLogStorage(agentDir),
      agentDir,
      db: makeDb(),
      hooks: mockHooks as any,
    });

    await executor.run(makeTask());

    expect(capturedOptions?.hooks).toBe(mockHooks);
  });

  it("passes mcpServers when provided", async () => {
    const mockMcpServers = { memory: {} as any };

    const executor = new TaskExecutor({
      taskManager: makeTaskManager(),
      logStorage: makeLogStorage(agentDir),
      agentDir,
      db: makeDb(),
      mcpServers: mockMcpServers,
    });

    await executor.run(makeTask());

    expect(capturedOptions?.mcpServers).toBe(mockMcpServers);
  });

  it("persistSession = false for non-recurring task (no recurrenceId)", async () => {
    const executor = new TaskExecutor({
      taskManager: makeTaskManager(),
      logStorage: makeLogStorage(agentDir),
      agentDir,
      db: makeDb(),
    });

    await executor.run(makeTask({ recurrenceId: undefined }));

    expect(capturedOptions?.persistSession).toBe(false);
  });

  it("persistSession = true for recurring task (has recurrenceId)", async () => {
    const executor = new TaskExecutor({
      taskManager: makeTaskManager(),
      logStorage: makeLogStorage(agentDir),
      agentDir,
      db: makeDb(),
    });

    await executor.run(makeTask({ recurrenceId: "recurrence-xyz" }));

    expect(capturedOptions?.persistSession).toBe(true);
  });

  it("systemPrompt comes from buildWorkingNinaPrompt", async () => {
    const { buildWorkingNinaPrompt } = await import(
      "../../src/tasks/working-nina-prompt.js"
    );

    const executor = new TaskExecutor({
      taskManager: makeTaskManager(),
      logStorage: makeLogStorage(agentDir),
      agentDir,
      db: makeDb(),
    });

    await executor.run(makeTask());

    expect(buildWorkingNinaPrompt).toHaveBeenCalledWith(agentDir, {
      taskTitle: "Test Task",
      taskId: "task-001",
      calendarContext: undefined,
    });
    expect(capturedOptions?.systemPrompt).toBe("Working Nina system prompt");
  });

  it("supports lazy getter for mcpServers", async () => {
    let mcpServersValue: any = null;

    const executor = new TaskExecutor({
      taskManager: makeTaskManager(),
      logStorage: makeLogStorage(agentDir),
      agentDir,
      db: makeDb(),
      get mcpServers() {
        return mcpServersValue;
      },
    });

    // Before servers are ready, undefined is passed
    await executor.run(makeTask());
    expect(capturedOptions?.mcpServers).toBeNull();

    // After servers are initialized, they are picked up
    mcpServersValue = { memory: {} as any };
    capturedOptions = null;
    await executor.run(makeTask());
    expect(capturedOptions?.mcpServers).toBe(mcpServersValue);
  });
});
