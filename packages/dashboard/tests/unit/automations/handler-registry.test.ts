/**
 * Task 1: Handler registry dispatch — unit tests
 *
 * Verifies the core S6 mechanism: built-in handlers execute
 * instead of spawning SDK sessions.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  registerHandler,
  getHandler,
  type BuiltInHandler,
} from "../../../src/scheduler/jobs/handler-registry.js";
import { AutomationExecutor } from "../../../src/automations/automation-executor.js";
import { AutomationJobService } from "../../../src/automations/automation-job-service.js";
import { AutomationManager } from "../../../src/automations/automation-manager.js";
import { ConversationDatabase } from "../../../src/conversations/db.js";
import { mkdtempSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import type { Automation } from "@my-agent/core";

// Mock external dependencies
vi.mock("@my-agent/core", async () => {
  const actual = await vi.importActual("@my-agent/core");
  return {
    ...actual,
    createBrainQuery: vi.fn(),
    loadConfig: vi.fn(() => ({
      model: "claude-sonnet-4-6",
      brainDir: "/tmp/brain",
    })),
    filterSkillsByTools: vi.fn(async () => []),
    cleanupSkillFilters: vi.fn(async () => {}),
  };
});

vi.mock("../../../src/automations/working-nina-prompt.js", () => ({
  buildWorkingNinaPrompt: vi.fn(async () => "You are a helpful assistant."),
}));

const { createBrainQuery } = await import("@my-agent/core");

function makeAsyncIterable(messages: any[]) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const msg of messages) {
        yield msg;
      }
    },
  };
}

describe("Handler Registry Dispatch", () => {
  let db: ConversationDatabase;
  let manager: AutomationManager;
  let jobService: AutomationJobService;
  let executor: AutomationExecutor;
  let tempDir: string;
  let automationsDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "handler-registry-"));
    automationsDir = join(tempDir, "automations");
    mkdirSync(automationsDir, { recursive: true });
    db = new ConversationDatabase(tempDir);
    manager = new AutomationManager(automationsDir, db);
    jobService = new AutomationJobService(automationsDir, db);
    executor = new AutomationExecutor({
      automationManager: manager,
      jobService,
      agentDir: tempDir,
      db,
    });
  });

  afterEach(() => {
    db.close();
    vi.clearAllMocks();
  });

  it("registerHandler + getHandler — register, retrieve, unknown returns undefined", () => {
    const mockHandler: BuiltInHandler = vi.fn(async () => ({
      success: true,
      work: "test output",
      deliverable: null,
    }));

    registerHandler("test-handler-1", mockHandler);
    expect(getHandler("test-handler-1")).toBe(mockHandler);
    expect(getHandler("nonexistent-handler")).toBeUndefined();
  });

  it("all 5 expected handlers are registered on import", () => {
    const expectedHandlers = [
      "debrief-prep",
      "daily-summary",
      "weekly-review",
      "weekly-summary",
      "monthly-summary",
    ];

    for (const key of expectedHandlers) {
      const handler = getHandler(key);
      expect(handler, `Handler "${key}" should be registered`).toBeDefined();
      expect(typeof handler).toBe("function");
    }
  });

  it("executor uses built-in handler instead of SDK session when handler field is set", async () => {
    const mockHandler: BuiltInHandler = vi.fn(async () => ({
      success: true,
      work: "handler did the work",
      deliverable: null,
    }));
    registerHandler("test-dispatch", mockHandler);

    // System automations with handlers come from markdown files, not manager.create()
    writeFileSync(
      join(automationsDir, "handler-auto.md"),
      `---
name: Handler Auto
status: active
system: true
trigger:
  - type: manual
handler: test-dispatch
created: "2026-03-26"
---

Use the handler.
`,
      "utf-8",
    );
    const automation = manager.read("handler-auto")!;
    expect(automation.manifest.handler).toBe("test-dispatch");

    const job = jobService.createJob(automation.id);
    const result = await executor.run(automation, job);

    expect(result.success).toBe(true);
    expect(result.work).toBe("handler did the work");
    expect(mockHandler).toHaveBeenCalledOnce();
    // createBrainQuery should NOT have been called
    expect(createBrainQuery).not.toHaveBeenCalled();
  });

  it("executor throws for unknown handler key", async () => {
    writeFileSync(
      join(automationsDir, "bad-handler.md"),
      `---
name: Bad Handler
status: active
system: true
trigger:
  - type: manual
handler: does-not-exist
created: "2026-03-26"
---

Unknown handler.
`,
      "utf-8",
    );
    const automation = manager.read("bad-handler")!;
    const job = jobService.createJob(automation.id);

    await expect(executor.run(automation, job)).rejects.toThrow(
      "Unknown built-in handler: does-not-exist",
    );
  });

  it("executor falls through to SDK session when no handler field", async () => {
    const automation = manager.create({
      name: "SDK Auto",
      instructions: "Use SDK.",
      manifest: {
        trigger: [{ type: "manual" }],
        autonomy: "full",
      },
    });
    const job = jobService.createJob(automation.id);

    (createBrainQuery as any).mockReturnValue(
      makeAsyncIterable([
        {
          type: "assistant",
          message: {
            content: [{ type: "text", text: "SDK did the work." }],
          },
        },
      ]),
    );

    const result = await executor.run(automation, job);

    // Generic fallback adds mandatory items — needs_review due to incomplete todos (M9.2-S1)
    expect(result.success).toBe(false);
    expect(createBrainQuery).toHaveBeenCalledOnce();
  });
});
