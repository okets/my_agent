import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@my-agent/core", () => ({
  createBrainQuery: vi.fn(),
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
        model: expect.stringContaining("haiku"),
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
        model: expect.stringContaining("sonnet"),
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
        model: expect.stringContaining("haiku"),
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

describe("MODEL_MAP", () => {
  it("exports model map for configuration", async () => {
    const { MODEL_MAP } = await import("../src/scheduler/query-model.js");
    expect(MODEL_MAP.haiku).toBeDefined();
    expect(MODEL_MAP.sonnet).toBeDefined();
    expect(MODEL_MAP.opus).toBeDefined();
  });
});
