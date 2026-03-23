import { describe, it, expect } from "vitest";
import {
  buildToolCommand,
  classifyToolOutput,
} from "../../src/spaces/tool-invoker.js";
import type { Space, SpaceIO } from "@my-agent/core";

function makeSpace(overrides: Partial<Space> = {}): Space {
  return {
    name: "test-tool",
    manifestDir: "/tmp/spaces/test-tool",
    tags: ["tool"],
    description: "A test tool",
    created: "2026-03-23",
    indexedAt: "2026-03-23",
    runtime: "uv",
    entry: "src/main.py",
    path: "/home/user/.my_agent/spaces/test-tool",
    io: { input: { url: "string" }, output: { results: "stdout" } },
    ...overrides,
  };
}

describe("buildToolCommand", () => {
  it("builds uv command correctly", () => {
    const space = makeSpace({ runtime: "uv", entry: "src/main.py" });
    const cmd = buildToolCommand(space, { url: "https://example.com" });
    expect(cmd).toBe(
      `cd /home/user/.my_agent/spaces/test-tool && uv run src/main.py '{"url":"https://example.com"}'`,
    );
  });

  it("builds node command correctly", () => {
    const space = makeSpace({ runtime: "node", entry: "index.js" });
    const cmd = buildToolCommand(space, { query: "test" });
    expect(cmd).toBe(
      `cd /home/user/.my_agent/spaces/test-tool && node index.js '{"query":"test"}'`,
    );
  });

  it("builds bash command correctly", () => {
    const space = makeSpace({ runtime: "bash", entry: "run.sh" });
    const cmd = buildToolCommand(space, {});
    expect(cmd).toBe(
      `cd /home/user/.my_agent/spaces/test-tool && bash run.sh '{}'`,
    );
  });

  it("throws when runtime is missing", () => {
    const space = makeSpace({ runtime: undefined });
    expect(() => buildToolCommand(space, {})).toThrow(
      "not a tool (missing runtime or entry)",
    );
  });

  it("throws when entry is missing", () => {
    const space = makeSpace({ entry: undefined });
    expect(() => buildToolCommand(space, {})).toThrow(
      "not a tool (missing runtime or entry)",
    );
  });

  it("throws for unsupported runtime", () => {
    const space = makeSpace({ runtime: "deno" });
    expect(() => buildToolCommand(space, {})).toThrow(
      "Unsupported runtime: deno",
    );
  });
});

describe("classifyToolOutput", () => {
  it("returns exit_code error for non-zero exit code", () => {
    const result = classifyToolOutput(1, "Error: file not found");
    expect(result.success).toBe(false);
    expect(result.errorType).toBe("exit_code");
    expect(result.error).toBe("Error: file not found");
  });

  it("returns empty_stdout error for blank output", () => {
    const result = classifyToolOutput(0, "  \n  ");
    expect(result.success).toBe(false);
    expect(result.errorType).toBe("empty_stdout");
  });

  it("returns invalid_json error when stdout output type expects JSON", () => {
    const io: SpaceIO = {
      input: { url: "string" },
      output: { results: "stdout" },
    };
    const result = classifyToolOutput(0, "not json", io);
    expect(result.success).toBe(false);
    expect(result.errorType).toBe("invalid_json");
  });

  it("returns success for valid JSON when stdout output expected", () => {
    const io: SpaceIO = {
      input: { url: "string" },
      output: { results: "stdout" },
    };
    const result = classifyToolOutput(0, '{"data": [1,2,3]}', io);
    expect(result.success).toBe(true);
    expect(result.output).toBe('{"data": [1,2,3]}');
  });

  it("skips JSON validation when output type is file", () => {
    const io: SpaceIO = {
      input: { url: "string" },
      output: { path: "file" },
    };
    const result = classifyToolOutput(0, "not json but thats ok", io);
    expect(result.success).toBe(true);
  });

  it("returns success for non-empty stdout without io contract", () => {
    const result = classifyToolOutput(0, "some output");
    expect(result.success).toBe(true);
    expect(result.output).toBe("some output");
  });
});
