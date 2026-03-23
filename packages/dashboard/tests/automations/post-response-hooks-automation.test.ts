import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the automation extractor
const mockExtract = vi.fn();
vi.mock("../../src/automations/automation-extractor.js", () => ({
  extractTaskFromMessage: (...args: unknown[]) => mockExtract(...args),
}));

import { PostResponseHooks, type PostResponseHooksDeps } from "../../src/conversations/post-response-hooks.js";

function makeDeps(overrides?: Partial<PostResponseHooksDeps>): PostResponseHooksDeps {
  return {
    log: vi.fn(),
    logError: vi.fn(),
    getAutomationHints: vi.fn(() => [
      { id: "invoice-proc", name: "Process Invoice", hints: "invoice,receipt", description: "Process invoices" },
    ]),
    fireAutomation: vi.fn<(id: string, ctx: Record<string, unknown>) => Promise<void>>().mockResolvedValue(undefined),
    getRecentJobsForAutomation: vi.fn(() => 0),
    ...overrides,
  };
}

describe("PostResponseHooks — automation channel triggers", () => {
  let hooks: PostResponseHooks;
  let deps: PostResponseHooksDeps;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fires automation when extraction returns a matchedAutomation", async () => {
    deps = makeDeps();
    hooks = new PostResponseHooks(deps);

    mockExtract.mockResolvedValue({
      shouldCreateTask: false,
      matchedAutomation: {
        automationId: "invoice-proc",
        confidence: 0.92,
        extractedContext: { vendor: "Acme" },
      },
    });

    await hooks.run("conv-1", "Here is my invoice from Acme", "I'll process that for you");

    expect(deps.fireAutomation).toHaveBeenCalledWith("invoice-proc", {
      trigger: "channel",
      conversationId: "conv-1",
      vendor: "Acme",
    });
  });

  it("passes automation hints to extractTaskFromMessage", async () => {
    deps = makeDeps();
    hooks = new PostResponseHooks(deps);

    mockExtract.mockResolvedValue({ shouldCreateTask: false });

    await hooks.run("conv-1", "Hello", "Hi there");

    expect(mockExtract).toHaveBeenCalledWith(
      "Hello",
      "Hi there",
      expect.arrayContaining([
        expect.objectContaining({ id: "invoice-proc" }),
      ]),
    );
  });

  it("skips automation if fired recently (5-min dedup)", async () => {
    deps = makeDeps({
      getRecentJobsForAutomation: vi.fn(() => 1), // already fired
    });
    hooks = new PostResponseHooks(deps);

    mockExtract.mockResolvedValue({
      shouldCreateTask: false,
      matchedAutomation: {
        automationId: "invoice-proc",
        confidence: 0.9,
        extractedContext: {},
      },
    });

    await hooks.run("conv-1", "Another invoice", "Processing...");

    expect(deps.fireAutomation).not.toHaveBeenCalled();
    expect(deps.log).toHaveBeenCalledWith(
      expect.stringContaining("already fired recently"),
    );
  });

  it("works without optional automation deps (backward compat)", async () => {
    deps = makeDeps({
      getAutomationHints: undefined,
      fireAutomation: undefined,
      getRecentJobsForAutomation: undefined,
    });
    hooks = new PostResponseHooks(deps);

    mockExtract.mockResolvedValue({ shouldCreateTask: false });

    // Should not throw
    await hooks.run("conv-1", "Hello", "Hi");

    // Should have called extract without hints
    expect(mockExtract).toHaveBeenCalledWith("Hello", "Hi", undefined);
  });
});
