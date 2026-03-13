/**
 * Unit Tests — TaskProcessor CI Integration for Immediate Notifications
 *
 * Tests that TaskProcessor correctly routes task completion events
 * through ConversationInitiator based on notifyOnCompletion settings.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Task } from "@my-agent/core";
import type { ExecutionResult } from "../src/tasks/task-executor.js";
import type { TaskProcessorConfig } from "../src/tasks/task-processor.js";

// --- Minimal mock helpers ---

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "task-001",
    title: "Test task",
    instructions: "Do something useful",
    type: "immediate",
    status: "completed",
    source: { type: "web" },
    createdBy: "user",
    created: new Date(),
    updated: new Date(),
    logPath: "/tmp/test.log",
    scheduledFor: null,
    ...overrides,
  } as Task;
}

function makeResult(overrides: Partial<ExecutionResult> = {}): ExecutionResult {
  return {
    success: true,
    work: "Here is the completed work output.",
    deliverable: null,
    ...overrides,
  };
}

/**
 * Create a minimal TaskProcessor config that avoids real I/O.
 * The conversationInitiator is injected by the caller.
 */
function makeConfig(
  ciOverride: TaskProcessorConfig["conversationInitiator"],
): TaskProcessorConfig {
  const taskManager = {
    getConversationsForTask: vi.fn().mockReturnValue([]),
    findById: vi.fn().mockReturnValue(null),
    update: vi.fn(),
  } as unknown as TaskProcessorConfig["taskManager"];

  const executor = {
    run: vi.fn(),
  } as unknown as TaskProcessorConfig["executor"];

  const conversationManager = {
    get: vi.fn().mockResolvedValue(null),
    appendTurn: vi.fn(),
  } as unknown as TaskProcessorConfig["conversationManager"];

  const connectionRegistry = {
    broadcastToConversation: vi.fn(),
    broadcastToAll: vi.fn(),
  } as unknown as TaskProcessorConfig["connectionRegistry"];

  return {
    taskManager,
    executor,
    conversationManager,
    connectionRegistry,
    channelManager: null,
    notificationService: null,
    conversationInitiator: ciOverride,
  };
}

// --- Tests ---

describe("TaskProcessor CI integration", () => {
  let alertMock: ReturnType<typeof vi.fn>;
  let initiateMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    alertMock = vi.fn();
    initiateMock = vi.fn();
  });

  it("calls CI.alert() for notifyOnCompletion='immediate'", async () => {
    alertMock.mockResolvedValue(true); // active conversation found

    const { TaskProcessor } = await import(
      "../src/tasks/task-processor.js"
    );

    const config = makeConfig({ alert: alertMock, initiate: initiateMock });
    const processor = new TaskProcessor(config);

    const task = makeTask({ notifyOnCompletion: "immediate" });
    const result = makeResult();

    // Access private method via cast to any
    await (processor as any).deliverResult(task, result);

    expect(alertMock).toHaveBeenCalledOnce();
    expect(alertMock).toHaveBeenCalledWith(
      expect.stringContaining(task.title),
    );
    expect(initiateMock).not.toHaveBeenCalled();
  });

  it("calls CI.initiate() when alert() returns false (no active conversation)", async () => {
    alertMock.mockResolvedValue(false); // no active conversation
    initiateMock.mockResolvedValue({});

    const { TaskProcessor } = await import(
      "../src/tasks/task-processor.js"
    );

    const config = makeConfig({ alert: alertMock, initiate: initiateMock });
    const processor = new TaskProcessor(config);

    const task = makeTask({ notifyOnCompletion: "immediate" });
    const result = makeResult();

    await (processor as any).deliverResult(task, result);

    expect(alertMock).toHaveBeenCalledOnce();
    expect(initiateMock).toHaveBeenCalledOnce();
    expect(initiateMock).toHaveBeenCalledWith(
      expect.objectContaining({ firstTurnPrompt: expect.stringContaining("[SYSTEM:") }),
    );
  });

  it("does NOT call CI for notifyOnCompletion='debrief'", async () => {
    const { TaskProcessor } = await import(
      "../src/tasks/task-processor.js"
    );

    const config = makeConfig({ alert: alertMock, initiate: initiateMock });
    const processor = new TaskProcessor(config);

    const task = makeTask({ notifyOnCompletion: "debrief" });
    const result = makeResult();

    await (processor as any).deliverResult(task, result);

    expect(alertMock).not.toHaveBeenCalled();
    expect(initiateMock).not.toHaveBeenCalled();
  });

  it("uses type-based default: immediate task without notifyOnCompletion triggers CI", async () => {
    alertMock.mockResolvedValue(true);

    const { TaskProcessor } = await import(
      "../src/tasks/task-processor.js"
    );

    const config = makeConfig({ alert: alertMock, initiate: initiateMock });
    const processor = new TaskProcessor(config);

    // notifyOnCompletion is undefined — should default to 'immediate' for type='immediate'
    const task = makeTask({ type: "immediate", notifyOnCompletion: undefined });
    const result = makeResult();

    await (processor as any).deliverResult(task, result);

    expect(alertMock).toHaveBeenCalledOnce();
  });
});
