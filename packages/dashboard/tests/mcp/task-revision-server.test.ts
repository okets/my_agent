import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTaskRevisionServer } from "../../src/mcp/task-revision-server.js";
import type { TaskManager } from "../../src/tasks/task-manager.js";
import type { TaskProcessor } from "../../src/tasks/task-processor.js";
import type { Task } from "@my-agent/core";

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  tool: vi.fn((name, description, schema, handler) => ({
    name,
    description,
    schema,
    handler,
    __isTool: true,
  })),
  createSdkMcpServer: vi.fn((config) => ({
    name: config.name,
    tools: config.tools,
    __isMcpServer: true,
  })),
}));

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "task-TEST01",
    type: "immediate",
    sourceType: "conversation",
    title: "Test task",
    instructions: "Do the thing",
    status: "completed",
    sessionId: "session-TEST01",
    created: new Date("2026-03-14T10:00:00Z"),
    createdBy: "user",
    logPath: "/tmp/task-TEST01.jsonl",
    ...overrides,
  };
}

function createMockTaskManager(task: Task | null = null) {
  return {
    findById: vi.fn().mockReturnValue(task),
    update: vi.fn(),
  } as unknown as TaskManager;
}

function createMockTaskProcessor() {
  return {
    onTaskCreated: vi.fn(),
  } as unknown as TaskProcessor;
}

describe("createTaskRevisionServer", () => {
  it("creates a server with the correct name", () => {
    const server = createTaskRevisionServer({
      taskManager: createMockTaskManager(),
      taskProcessor: createMockTaskProcessor(),
    });
    expect(server).toBeDefined();
    expect((server as any).name).toBe("task-revision");
  });
});

describe("revise_task tool", () => {
  let taskManager: TaskManager;
  let taskProcessor: TaskProcessor;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("revises a completed task — sets status to pending and appends instructions", async () => {
    const task = makeTask({ status: "completed" });
    taskManager = createMockTaskManager(task);
    taskProcessor = createMockTaskProcessor();

    // findById returns the updated task on second call (after update)
    const updatedTask = makeTask({ status: "pending" });
    (taskManager.findById as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(task)
      .mockReturnValueOnce(updatedTask);

    const server = createTaskRevisionServer({ taskManager, taskProcessor });
    const reviseToolHandler = (server as any).tools[0].handler;

    const result = await reviseToolHandler({
      taskId: "task-TEST01",
      instructions: "Fix the formatting",
    });

    // Should have called update with pending status and appended instructions
    expect(taskManager.update).toHaveBeenCalledWith("task-TEST01", {
      status: "pending",
      instructions: expect.stringContaining("Fix the formatting"),
      completedAt: undefined,
    });

    // Instructions should include original + revision marker
    const updateCall = (taskManager.update as ReturnType<typeof vi.fn>).mock.calls[0];
    const updatedInstructions = updateCall[1].instructions as string;
    expect(updatedInstructions).toContain("Do the thing");
    expect(updatedInstructions).toContain("## Revision Request");
    expect(updatedInstructions).toContain("Fix the formatting");
    expect(updatedInstructions).toContain("status-report.md");

    // Should have triggered re-execution
    expect(taskProcessor.onTaskCreated).toHaveBeenCalledWith(updatedTask);

    // Should return success message
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("queued for revision");
  });

  it("revises a needs_review task", async () => {
    const task = makeTask({ status: "needs_review" });
    taskManager = createMockTaskManager(task);
    taskProcessor = createMockTaskProcessor();

    const updatedTask = makeTask({ status: "pending" });
    (taskManager.findById as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(task)
      .mockReturnValueOnce(updatedTask);

    const server = createTaskRevisionServer({ taskManager, taskProcessor });
    const reviseToolHandler = (server as any).tools[0].handler;

    const result = await reviseToolHandler({
      taskId: "task-TEST01",
      instructions: "Add more detail",
    });

    expect(taskManager.update).toHaveBeenCalled();
    expect(result.isError).toBeUndefined();
  });

  it("returns error for non-existent task", async () => {
    taskManager = createMockTaskManager(null);
    taskProcessor = createMockTaskProcessor();

    const server = createTaskRevisionServer({ taskManager, taskProcessor });
    const reviseToolHandler = (server as any).tools[0].handler;

    const result = await reviseToolHandler({
      taskId: "task-MISSING",
      instructions: "Fix it",
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("not found");
    expect(taskManager.update).not.toHaveBeenCalled();
    expect(taskProcessor.onTaskCreated).not.toHaveBeenCalled();
  });

  it("returns error for a running task (not revisable)", async () => {
    const task = makeTask({ status: "running" });
    taskManager = createMockTaskManager(task);
    taskProcessor = createMockTaskProcessor();

    const server = createTaskRevisionServer({ taskManager, taskProcessor });
    const reviseToolHandler = (server as any).tools[0].handler;

    const result = await reviseToolHandler({
      taskId: "task-TEST01",
      instructions: "Fix it",
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("running");
    expect(result.content[0].text).toContain("not revisable");
    expect(taskManager.update).not.toHaveBeenCalled();
    expect(taskProcessor.onTaskCreated).not.toHaveBeenCalled();
  });

  it("returns error for a pending task (not revisable)", async () => {
    const task = makeTask({ status: "pending" });
    taskManager = createMockTaskManager(task);
    taskProcessor = createMockTaskProcessor();

    const server = createTaskRevisionServer({ taskManager, taskProcessor });
    const reviseToolHandler = (server as any).tools[0].handler;

    const result = await reviseToolHandler({
      taskId: "task-TEST01",
      instructions: "Fix it",
    });

    expect(result.isError).toBe(true);
    expect(taskManager.update).not.toHaveBeenCalled();
  });
});
