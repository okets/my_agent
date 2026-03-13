import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@my-agent/core", () => ({
  createBrainQuery: vi.fn(),
  loadModels: vi.fn(() => ({
    sonnet: "claude-sonnet-4-5",
    haiku: "claude-haiku-4-5",
    opus: "claude-opus-4-6",
  })),
}));

import { createBrainQuery } from "@my-agent/core";

describe("queryModel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resolves 'haiku' to the correct model ID", async () => {
    const mockQuery = (async function* () {
      yield { type: "result", result: "test response" };
    })();
    vi.mocked(createBrainQuery).mockReturnValue(mockQuery as any);

    const { queryModel } = await import("../src/scheduler/query-model.js");
    await queryModel("test prompt", "system prompt", "haiku");

    expect(createBrainQuery).toHaveBeenCalledWith(
      "test prompt",
      expect.objectContaining({
        model: "claude-haiku-4-5",
      })
    );
  });

  it("resolves 'sonnet' to the correct model ID", async () => {
    const mockQuery = (async function* () {
      yield { type: "result", result: "test response" };
    })();
    vi.mocked(createBrainQuery).mockReturnValue(mockQuery as any);

    const { queryModel } = await import("../src/scheduler/query-model.js");
    await queryModel("test prompt", "system prompt", "sonnet");

    expect(createBrainQuery).toHaveBeenCalledWith(
      "test prompt",
      expect.objectContaining({
        model: "claude-sonnet-4-5",
      })
    );
  });

  it("defaults to haiku when no model specified", async () => {
    const mockQuery = (async function* () {
      yield { type: "result", result: "test response" };
    })();
    vi.mocked(createBrainQuery).mockReturnValue(mockQuery as any);

    const { queryModel } = await import("../src/scheduler/query-model.js");
    await queryModel("test prompt", "system prompt");

    expect(createBrainQuery).toHaveBeenCalledWith(
      "test prompt",
      expect.objectContaining({
        model: "claude-haiku-4-5",
      })
    );
  });

  it("throws on empty response", async () => {
    const mockQuery = (async function* () {
      yield { type: "result", result: "" };
    })();
    vi.mocked(createBrainQuery).mockReturnValue(mockQuery as any);

    const { queryModel } = await import("../src/scheduler/query-model.js");
    await expect(
      queryModel("test prompt", "system prompt")
    ).rejects.toThrow("empty response");
  });
});

describe("resolveModelId", () => {
  it("resolves aliases to configured model IDs", async () => {
    const { resolveModelId } = await import("../src/scheduler/query-model.js");
    expect(resolveModelId("haiku")).toBe("claude-haiku-4-5");
    expect(resolveModelId("sonnet")).toBe("claude-sonnet-4-5");
    expect(resolveModelId("opus")).toBe("claude-opus-4-6");
  });
});
