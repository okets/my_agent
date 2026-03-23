import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock core module
const mockCreateBrainQuery = vi.fn();
vi.mock("@my-agent/core", async () => {
  const actual = await vi.importActual("@my-agent/core");
  return {
    ...actual,
    createBrainQuery: (...args: unknown[]) => mockCreateBrainQuery(...args),
    loadConfig: () => ({ model: "claude-sonnet-4-6" }),
    filterSkillsByTools: vi.fn().mockResolvedValue([]),
    cleanupSkillFilters: vi.fn().mockResolvedValue(undefined),
  };
});

import { AutomationExecutor, type AutomationExecutorConfig } from "../../src/automations/automation-executor.js";
import type { Job } from "@my-agent/core";

function makeJob(overrides?: Partial<Job>): Job {
  return {
    id: "job-1",
    automationId: "auto-1",
    status: "needs_review",
    created: new Date().toISOString(),
    run_dir: "/tmp/test-run",
    summary: "Should we proceed?",
    sdk_session_id: "session-abc",
    ...overrides,
  };
}

function makeConfig(overrides?: Partial<AutomationExecutorConfig>): AutomationExecutorConfig {
  return {
    automationManager: {
      findById: vi.fn(() => ({
        id: "auto-1",
        manifest: { name: "Test", status: "active", trigger: [{ type: "manual" }] },
        instructions: "Do the thing",
      })),
    } as any,
    jobService: {
      updateJob: vi.fn(),
      getJob: vi.fn(() => makeJob()),
      getSessionId: vi.fn(() => null),
      storeSessionId: vi.fn(),
    } as any,
    agentDir: "/tmp/agent",
    db: {} as any,
    ...overrides,
  };
}

/** Helper: mock a successful brain query with response text */
function mockBrainQueryResponse(text: string, sessionId?: string): void {
  mockCreateBrainQuery.mockReturnValue(
    (async function* () {
      if (sessionId) {
        yield { type: "system", subtype: "init", session_id: sessionId };
      }
      yield {
        type: "assistant",
        message: { content: [{ type: "text", text }] },
      };
      yield { type: "result" };
    })(),
  );
}

describe("AutomationExecutor.resume()", () => {
  let config: AutomationExecutorConfig;
  let executor: AutomationExecutor;

  beforeEach(() => {
    vi.clearAllMocks();
    config = makeConfig();
    executor = new AutomationExecutor(config);
  });

  it("calls createBrainQuery with resume: sessionId and user input as prompt", async () => {
    mockBrainQueryResponse("Task completed successfully.", "new-session-456");

    await executor.resume(makeJob(), "Yes, proceed with deployment", "session-abc");

    expect(mockCreateBrainQuery).toHaveBeenCalledWith(
      "Yes, proceed with deployment",
      expect.objectContaining({
        resume: "session-abc",
        tools: expect.arrayContaining(["Bash", "Read"]),
      }),
    );
  });

  it("updates job status to running then completed on success", async () => {
    mockBrainQueryResponse("Done. <deliverable>Deployment complete.</deliverable>");

    await executor.resume(makeJob(), "Go ahead", "session-abc");

    const updateCalls = (config.jobService.updateJob as ReturnType<typeof vi.fn>).mock.calls;

    // First call: status -> running
    expect(updateCalls[0]).toEqual(["job-1", { status: "running" }]);

    // Second call: status -> completed
    expect(updateCalls[1][0]).toBe("job-1");
    expect(updateCalls[1][1].status).toBe("completed");
    expect(updateCalls[1][1].completed).toBeDefined();
    expect(updateCalls[1][1].summary).toContain("Deployment complete");
  });

  it("marks job as failed when no session ID available", async () => {
    const result = await executor.resume(makeJob(), "Yes", null);

    expect(result.success).toBe(false);
    expect(result.status).toBe("failed");
    expect(result.error).toContain("No session to resume");
  });

  it("stores new session ID from resumed session", async () => {
    mockBrainQueryResponse("Done.", "new-session-789");

    await executor.resume(makeJob(), "Approved", "session-abc");

    const updateCalls = (config.jobService.updateJob as ReturnType<typeof vi.fn>).mock.calls;
    const completionUpdate = updateCalls[1][1];
    expect(completionUpdate.sdk_session_id).toBe("new-session-789");
  });

  it("preserves original session ID when no new session returned", async () => {
    mockBrainQueryResponse("Done.");

    await executor.resume(makeJob(), "Approved", "session-abc");

    const updateCalls = (config.jobService.updateJob as ReturnType<typeof vi.fn>).mock.calls;
    const completionUpdate = updateCalls[1][1];
    expect(completionUpdate.sdk_session_id).toBe("session-abc");
  });

  it("marks job as failed when resume throws", async () => {
    mockCreateBrainQuery.mockReturnValue(
      (async function* () {
        throw new Error("Session expired");
      })(),
    );

    const result = await executor.resume(makeJob(), "Yes", "stale-session");

    expect(result.success).toBe(false);
    expect(result.status).toBe("failed");

    const updateCalls = (config.jobService.updateJob as ReturnType<typeof vi.fn>).mock.calls;
    // Should have set to running, then to failed
    expect(updateCalls[0][1].status).toBe("running");
    expect(updateCalls[1][1].status).toBe("failed");
  });

  it("returns summary from deliverable when present", async () => {
    mockBrainQueryResponse(
      "Analysis complete.\n<deliverable>Revenue increased 15% QoQ.</deliverable>",
    );

    const result = await executor.resume(makeJob(), "Show me the report", "session-abc");

    expect(result.success).toBe(true);
    expect(result.summary).toContain("Revenue increased 15%");
  });
});
