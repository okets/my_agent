import { describe, it, expect, vi, beforeEach } from "vitest";

let capturedOptions: any = null;

// Mock @my-agent/core — capture options passed to createBrainQuery
vi.mock("@my-agent/core", () => ({
  createBrainQuery: vi.fn((prompt: any, options: any) => {
    capturedOptions = options;
    return (async function* () {})();
  }),
  loadConfig: vi.fn().mockReturnValue({
    model: "claude-sonnet-4-6",
    brainDir: "/tmp/test-agent/brain",
  }),
  createHooks: vi.fn().mockReturnValue({}),
  createMemoryServer: vi.fn().mockReturnValue({}),
  assembleSystemPrompt: vi
    .fn()
    .mockResolvedValue("## Identity\nYou are Nina."),
  loadCalendarConfig: vi.fn().mockReturnValue(null),
  loadCalendarCredentials: vi.fn().mockReturnValue(null),
  loadProperties: vi.fn().mockResolvedValue(null),
}));

import {
  SessionManager,
  initPromptBuilder,
} from "../src/agent/session-manager.js";

describe("SessionManager — SDK skill discovery", () => {
  process.env.ANTHROPIC_API_KEY = "test-key";

  beforeEach(() => {
    capturedOptions = null;
    initPromptBuilder("/tmp/test-agent/brain", "/tmp/test-agent");
  });

  it("passes settingSources to SDK query options", async () => {
    const sm = new SessionManager("conv-TEST");
    const gen = sm.streamMessage("hello");
    for await (const _ of gen) { /* drain */ }
    expect(capturedOptions.settingSources).toEqual(["project"]);
  });

  it("passes cwd as agentDir for skill discovery", async () => {
    const sm = new SessionManager("conv-TEST2");
    const gen = sm.streamMessage("hello");
    for await (const _ of gen) { /* drain */ }
    expect(capturedOptions.cwd).toBe("/tmp/test-agent");
  });

  it("includes Skill in allowedTools", async () => {
    const sm = new SessionManager("conv-TEST3");
    const gen = sm.streamMessage("hello");
    for await (const _ of gen) { /* drain */ }
    expect(capturedOptions.tools).toContain("Skill");
  });
});
