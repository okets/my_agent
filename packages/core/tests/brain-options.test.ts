import { describe, it, expect, vi } from "vitest";

let capturedOptions: any = null;
vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: vi.fn((params: any) => {
    capturedOptions = params.options;
    return (async function* () {})();
  }),
}));

import { createBrainQuery } from "../src/brain.js";

describe("createBrainQuery — extended options", () => {
  // Set required env var for auth check
  process.env.ANTHROPIC_API_KEY = "test-key";

  it("passes cwd to SDK options", () => {
    createBrainQuery("test", {
      model: "claude-sonnet-4-6",
      cwd: "/tmp/task-workspace",
    });
    expect(capturedOptions.cwd).toBe("/tmp/task-workspace");
  });

  it("passes custom tools when provided", () => {
    createBrainQuery("test", {
      model: "claude-sonnet-4-6",
      tools: ["Bash", "Read", "Write"],
    });
    expect(capturedOptions.allowedTools).toEqual(["Bash", "Read", "Write"]);
  });

  it("passes persistSession to SDK options", () => {
    createBrainQuery("test", {
      model: "claude-sonnet-4-6",
      persistSession: false,
    });
    expect(capturedOptions.persistSession).toBe(false);
  });

  it("uses default tools when not specified", () => {
    createBrainQuery("test", { model: "claude-sonnet-4-6" });
    expect(capturedOptions.allowedTools).toContain("Bash");
    expect(capturedOptions.allowedTools).toContain("Read");
    expect(capturedOptions.allowedTools).toContain("Write");
    expect(capturedOptions.allowedTools).toContain("Edit");
    expect(capturedOptions.allowedTools).toContain("Glob");
    expect(capturedOptions.allowedTools).toContain("Grep");
  });

  it("adds Task tool when agents are provided with custom tools", () => {
    createBrainQuery("test", {
      model: "claude-sonnet-4-6",
      tools: ["Bash", "Read"],
      agents: { researcher: {} as any },
    });
    expect(capturedOptions.allowedTools).toContain("Task");
    expect(capturedOptions.allowedTools).toContain("Bash");
    expect(capturedOptions.allowedTools).toContain("Read");
  });
});
