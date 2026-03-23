import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the Agent SDK
vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  tool: vi.fn((name, desc, schema, handler) => ({ name, description: desc, schema, handler })),
  createSdkMcpServer: vi.fn((config) => config),
}));

import { createAutomationServer, type AutomationServerDeps } from "../../src/mcp/automation-server.js";
import type { Job } from "@my-agent/core";

function makeJob(overrides?: Partial<Job>): Job {
  return {
    id: "job-1",
    automationId: "auto-1",
    status: "needs_review",
    created: new Date().toISOString(),
    run_dir: "/tmp/test-run",
    summary: "Should we proceed?",
    sdk_session_id: "session-abc-123",
    ...overrides,
  };
}

function makeDeps(overrides?: Partial<AutomationServerDeps>): AutomationServerDeps {
  return {
    automationManager: {
      findById: vi.fn(() => ({
        id: "auto-1",
        manifest: { name: "Test Automation", status: "active", trigger: [{ type: "manual" }] },
        instructions: "Do something",
      })),
    } as any,
    processor: {
      resume: vi.fn().mockResolvedValue(undefined),
    } as any,
    jobService: {
      getJob: vi.fn(() => makeJob()),
    } as any,
    executor: {
      resume: vi.fn().mockResolvedValue({ success: true, status: "completed", summary: "Done" }),
    },
    ...overrides,
  };
}

describe("resume_job MCP tool", () => {
  let deps: AutomationServerDeps;
  let resumeHandler: (args: { jobId: string; userResponse: string }) => Promise<any>;

  beforeEach(() => {
    vi.clearAllMocks();
    deps = makeDeps();
    const server = createAutomationServer(deps);
    // Find the resume_job tool handler
    const tools = (server as any).tools;
    const resumeTool = tools.find((t: any) => t.name === "resume_job");
    resumeHandler = resumeTool.handler;
  });

  it("resumes a needs_review job with user input", async () => {
    const result = await resumeHandler({ jobId: "job-1", userResponse: "Yes, proceed" });

    expect(result.content[0].text).toContain("resumed");
    expect(result.content[0].text).toContain("prior context");
  });

  it("calls executor.resume with stored session ID", async () => {
    await resumeHandler({ jobId: "job-1", userResponse: "Approved" });

    expect(deps.executor!.resume).toHaveBeenCalledWith(
      expect.objectContaining({ id: "job-1" }),
      "Approved",
      "session-abc-123",
    );
  });

  it("rejects if job is not in needs_review status", async () => {
    (deps.jobService.getJob as ReturnType<typeof vi.fn>).mockReturnValue(
      makeJob({ status: "completed" }),
    );

    const result = await resumeHandler({ jobId: "job-1", userResponse: "Yes" });

    expect(result.content[0].text).toContain("not in needs_review");
    expect(result.isError).toBe(true);
  });

  it("rejects if job not found", async () => {
    (deps.jobService.getJob as ReturnType<typeof vi.fn>).mockReturnValue(null);

    const result = await resumeHandler({ jobId: "job-missing", userResponse: "Yes" });

    expect(result.content[0].text).toContain("not found");
    expect(result.isError).toBe(true);
  });

  it("passes null session ID when job has no stored session", async () => {
    (deps.jobService.getJob as ReturnType<typeof vi.fn>).mockReturnValue(
      makeJob({ sdk_session_id: undefined }),
    );

    await resumeHandler({ jobId: "job-1", userResponse: "Yes" });

    expect(deps.executor!.resume).toHaveBeenCalledWith(
      expect.any(Object),
      "Yes",
      null,
    );
  });

  it("falls back to processor.resume when executor not available", async () => {
    deps = makeDeps({ executor: undefined });
    const server = createAutomationServer(deps);
    const tools = (server as any).tools;
    const resumeTool = tools.find((t: any) => t.name === "resume_job");

    await resumeTool.handler({ jobId: "job-1", userResponse: "Go ahead" });

    expect(deps.processor.resume).toHaveBeenCalled();
  });
});
