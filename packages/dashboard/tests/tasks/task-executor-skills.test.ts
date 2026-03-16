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

describe("TaskExecutor — SDK skill discovery", () => {
  const agentDir = "/tmp/agent";

  beforeEach(() => {
    capturedOptions = null;
    vi.clearAllMocks();
  });

  it("passes additionalDirectories containing agentDir (fresh query)", async () => {
    const executor = new TaskExecutor({
      taskManager: makeTaskManager(),
      logStorage: makeLogStorage(agentDir),
      agentDir,
      db: makeDb(),
    });

    await executor.run(makeTask());

    expect(capturedOptions?.additionalDirectories).toContain(agentDir);
  });

  it("passes settingSources = ['project'] (fresh query)", async () => {
    const executor = new TaskExecutor({
      taskManager: makeTaskManager(),
      logStorage: makeLogStorage(agentDir),
      agentDir,
      db: makeDb(),
    });

    await executor.run(makeTask());

    expect(capturedOptions?.settingSources).toEqual(["project"]);
  });

  it("passes allowedTools containing 'Skill' (fresh query)", async () => {
    const executor = new TaskExecutor({
      taskManager: makeTaskManager(),
      logStorage: makeLogStorage(agentDir),
      agentDir,
      db: makeDb(),
    });

    await executor.run(makeTask());

    expect(capturedOptions?.tools).toContain("Skill");
  });

  it("passes all three skill discovery options together (fresh query)", async () => {
    const customAgentDir = "/home/user/.my_agent";
    const executor = new TaskExecutor({
      taskManager: makeTaskManager(),
      logStorage: makeLogStorage(customAgentDir),
      agentDir: customAgentDir,
      db: makeDb(),
    });

    await executor.run(makeTask());

    expect(capturedOptions?.additionalDirectories).toContain(customAgentDir);
    expect(capturedOptions?.settingSources).toEqual(["project"]);
    expect(capturedOptions?.tools).toContain("Skill");
  });

  it("passes additionalDirectories containing agentDir (resume query)", async () => {
    const storedSessionId = "existing-session-abc";
    const db = makeDb();
    db.getTaskSdkSessionId = vi.fn().mockReturnValue(storedSessionId);

    const executor = new TaskExecutor({
      taskManager: makeTaskManager(),
      logStorage: makeLogStorage(agentDir),
      agentDir,
      db,
    });

    await executor.run(makeTask());

    expect(capturedOptions?.additionalDirectories).toContain(agentDir);
  });

  it("passes settingSources = ['project'] (resume query)", async () => {
    const storedSessionId = "existing-session-abc";
    const db = makeDb();
    db.getTaskSdkSessionId = vi.fn().mockReturnValue(storedSessionId);

    const executor = new TaskExecutor({
      taskManager: makeTaskManager(),
      logStorage: makeLogStorage(agentDir),
      agentDir,
      db,
    });

    await executor.run(makeTask());

    expect(capturedOptions?.settingSources).toEqual(["project"]);
  });

  it("passes allowedTools containing 'Skill' (resume query)", async () => {
    const storedSessionId = "existing-session-abc";
    const db = makeDb();
    db.getTaskSdkSessionId = vi.fn().mockReturnValue(storedSessionId);

    const executor = new TaskExecutor({
      taskManager: makeTaskManager(),
      logStorage: makeLogStorage(agentDir),
      agentDir,
      db,
    });

    await executor.run(makeTask());

    expect(capturedOptions?.tools).toContain("Skill");
  });
});
