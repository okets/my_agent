/**
 * S12 Task 3 acceptance — McpCapabilityCfrDetector.
 *
 * Covers both entry points:
 *   - `hooks.PostToolUseFailure` / `hooks.PostToolUse` (Modes 1 & 2 + empty)
 *   - `processSystemInit()` (Mode 3 — server-never-started)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  McpCapabilityCfrDetector,
  type McpCapabilityCfrDetectorDeps,
} from "../../src/capabilities/mcp-cfr-detector.js";
import type { CfrEmitter } from "../../src/capabilities/cfr-emitter.js";
import { CapabilityRegistry } from "../../src/capabilities/registry.js";
import type { Capability } from "../../src/capabilities/types.js";
import type {
  CapabilityFailure,
  TriggeringOrigin,
} from "../../src/capabilities/cfr-types.js";
import type {
  PostToolUseFailureHookInput,
  PostToolUseHookInput,
} from "@anthropic-ai/claude-agent-sdk";

// ── Fakes ─────────────────────────────────────────────────────────────────────

function makeCfr() {
  const emitted: CapabilityFailure[] = [];
  const cfr = {
    emitFailure: vi.fn((f) => {
      const failure = {
        ...f,
        id: "test-id",
        detectedAt: new Date().toISOString(),
        attemptNumber: 1 as const,
        previousAttempts: [],
      } as CapabilityFailure;
      emitted.push(failure);
      return failure;
    }),
  } as unknown as CfrEmitter;
  return { cfr, emitted };
}

function makeCap(overrides: Partial<Capability> & { name: string }): Capability {
  return {
    provides: undefined,
    interface: "mcp",
    path: "/tmp/fake",
    status: "available",
    health: "untested",
    enabled: true,
    canDelete: false,
    ...overrides,
  };
}

function makeOrigin(): TriggeringOrigin {
  return {
    kind: "conversation",
    channel: {
      transportId: "dashboard",
      channelId: "ch-1",
      sender: "user-1",
    },
    conversationId: "conv-1",
    turnNumber: 1,
  };
}

function makeDetector(caps: Capability[]): {
  detector: McpCapabilityCfrDetector;
  deps: McpCapabilityCfrDetectorDeps;
  emitted: CapabilityFailure[];
} {
  const { cfr, emitted } = makeCfr();
  const registry = new CapabilityRegistry();
  registry.load(caps);
  const deps: McpCapabilityCfrDetectorDeps = {
    cfr,
    registry,
    originFactory: makeOrigin,
  };
  const detector = new McpCapabilityCfrDetector(deps);
  return { detector, deps, emitted };
}

function makeFailureInput(
  overrides: Partial<PostToolUseFailureHookInput> = {},
): PostToolUseFailureHookInput {
  return {
    hook_event_name: "PostToolUseFailure",
    tool_name: "mcp__browser-chrome__screenshot",
    tool_input: { url: "https://example.com" },
    tool_use_id: "toolu_1",
    error: "MCP error -32000: some failure",
    is_interrupt: false,
    session_id: "sess-1",
    transcript_path: "/tmp/transcript",
    cwd: "/tmp",
    ...overrides,
  };
}

function makePostInput(
  overrides: Partial<PostToolUseHookInput> = {},
): PostToolUseHookInput {
  return {
    hook_event_name: "PostToolUse",
    tool_name: "mcp__browser-chrome__screenshot",
    tool_input: { url: "https://example.com" },
    tool_response: [],
    tool_use_id: "toolu_1",
    session_id: "sess-1",
    transcript_path: "/tmp/transcript",
    cwd: "/tmp",
    ...overrides,
  };
}

async function fireHook(
  detector: McpCapabilityCfrDetector,
  event: "PostToolUseFailure" | "PostToolUse",
  input: unknown,
): Promise<void> {
  const matchers = detector.hooks[event];
  if (!matchers) throw new Error(`No matchers for ${event}`);
  for (const m of matchers) {
    for (const hook of m.hooks) {
      await hook(input as never, undefined, { signal: new AbortController().signal });
    }
  }
}

// ── PostToolUseFailure hook ──────────────────────────────────────────────────

describe("McpCapabilityCfrDetector — PostToolUseFailure hook", () => {
  it("parses tool name, looks up capability, classifies error, emits CFR", async () => {
    const { detector, emitted } = makeDetector([
      makeCap({ name: "browser-chrome", provides: "browser-control" }),
    ]);

    await fireHook(
      detector,
      "PostToolUseFailure",
      makeFailureInput({
        error: "MCP error -32000: request timed out after 5000ms",
      }),
    );

    expect(emitted).toHaveLength(1);
    expect(emitted[0].capabilityType).toBe("browser-control");
    expect(emitted[0].capabilityName).toBe("browser-chrome");
    expect(emitted[0].symptom).toBe("timeout");
    expect(emitted[0].detail).toBe(
      "MCP error -32000: request timed out after 5000ms",
    );
    expect(emitted[0].triggeringInput.origin.kind).toBe("conversation");
    expect(emitted[0].triggeringInput.artifact).toBeUndefined();
  });

  it("emits execution-error for Mode 2 child-crash (Connection closed)", async () => {
    const { detector, emitted } = makeDetector([
      makeCap({ name: "browser-chrome", provides: "browser-control" }),
    ]);

    await fireHook(
      detector,
      "PostToolUseFailure",
      makeFailureInput({ error: "MCP error -32000: Connection closed" }),
    );

    expect(emitted).toHaveLength(1);
    expect(emitted[0].symptom).toBe("execution-error");
  });

  it("does nothing for non-MCP tool names (no mcp__ prefix)", async () => {
    const { detector, emitted } = makeDetector([
      makeCap({ name: "browser-chrome", provides: "browser-control" }),
    ]);

    await fireHook(
      detector,
      "PostToolUseFailure",
      makeFailureInput({ tool_name: "Bash" }),
    );

    expect(emitted).toHaveLength(0);
  });

  it("does nothing when the capability is unknown (findByName undefined)", async () => {
    const { detector, emitted } = makeDetector([
      makeCap({ name: "browser-chrome", provides: "browser-control" }),
    ]);

    await fireHook(
      detector,
      "PostToolUseFailure",
      makeFailureInput({ tool_name: "mcp__todo__add_item" }),
    );

    expect(emitted).toHaveLength(0);
  });

  it("caps userUtterance serialization at 1000 chars", async () => {
    const { detector, emitted } = makeDetector([
      makeCap({ name: "browser-chrome", provides: "browser-control" }),
    ]);

    const big = "x".repeat(5000);
    await fireHook(
      detector,
      "PostToolUseFailure",
      makeFailureInput({ tool_input: { payload: big } }),
    );

    expect(emitted).toHaveLength(1);
    expect(emitted[0].triggeringInput.userUtterance?.length).toBe(1000);
  });

  it("sets capabilityType to 'custom' when the plug has no 'provides'", async () => {
    const { detector, emitted } = makeDetector([
      makeCap({ name: "custom-plug", provides: undefined }),
    ]);

    await fireHook(
      detector,
      "PostToolUseFailure",
      makeFailureInput({ tool_name: "mcp__custom-plug__do_thing" }),
    );

    expect(emitted).toHaveLength(1);
    expect(emitted[0].capabilityType).toBe("custom");
    expect(emitted[0].capabilityName).toBe("custom-plug");
  });
});

// ── Secondary PostToolUse empty-result check ─────────────────────────────────

describe("McpCapabilityCfrDetector — PostToolUse empty-result check", () => {
  it("emits empty-result for a zero-length content-block array", async () => {
    const { detector, emitted } = makeDetector([
      makeCap({ name: "browser-chrome", provides: "browser-control" }),
    ]);

    await fireHook(detector, "PostToolUse", makePostInput({ tool_response: [] }));

    expect(emitted).toHaveLength(1);
    expect(emitted[0].symptom).toBe("empty-result");
    expect(emitted[0].capabilityName).toBe("browser-chrome");
  });

  it("emits empty-result for a wrapped {content: []} shape", async () => {
    const { detector, emitted } = makeDetector([
      makeCap({ name: "browser-chrome", provides: "browser-control" }),
    ]);

    await fireHook(
      detector,
      "PostToolUse",
      makePostInput({ tool_response: { content: [] } }),
    );

    expect(emitted).toHaveLength(1);
    expect(emitted[0].symptom).toBe("empty-result");
  });

  it("does not emit when the result has at least one content block", async () => {
    const { detector, emitted } = makeDetector([
      makeCap({ name: "browser-chrome", provides: "browser-control" }),
    ]);

    await fireHook(
      detector,
      "PostToolUse",
      makePostInput({
        tool_response: [{ type: "text", text: "ok" }],
      }),
    );

    expect(emitted).toHaveLength(0);
  });

  it("does not emit for unrecognized response shapes (null, strings, etc.)", async () => {
    const { detector, emitted } = makeDetector([
      makeCap({ name: "browser-chrome", provides: "browser-control" }),
    ]);

    await fireHook(
      detector,
      "PostToolUse",
      makePostInput({ tool_response: null }),
    );
    await fireHook(
      detector,
      "PostToolUse",
      makePostInput({ tool_response: "plain string" }),
    );

    expect(emitted).toHaveLength(0);
  });

  it("does nothing for non-MCP tool names", async () => {
    const { detector, emitted } = makeDetector([
      makeCap({ name: "browser-chrome", provides: "browser-control" }),
    ]);

    await fireHook(
      detector,
      "PostToolUse",
      makePostInput({ tool_name: "Bash", tool_response: [] }),
    );

    expect(emitted).toHaveLength(0);
  });

  it("does nothing when the capability is unknown", async () => {
    const { detector, emitted } = makeDetector([
      makeCap({ name: "browser-chrome", provides: "browser-control" }),
    ]);

    await fireHook(
      detector,
      "PostToolUse",
      makePostInput({
        tool_name: "mcp__todo__add_item",
        tool_response: [],
      }),
    );

    expect(emitted).toHaveLength(0);
  });
});

// ── processSystemInit (Mode 3 detection) ─────────────────────────────────────

describe("McpCapabilityCfrDetector — processSystemInit", () => {
  function makeInit(mcpServers: { name: string; status: string; error?: string }[]): unknown {
    return {
      type: "system",
      subtype: "init",
      session_id: "sess-1",
      mcp_servers: mcpServers,
    };
  }

  it("emits execution-error for a failed MCP server", () => {
    const { detector, emitted } = makeDetector([
      makeCap({ name: "browser-chrome", provides: "browser-control" }),
    ]);

    detector.processSystemInit(
      makeInit([
        {
          name: "browser-chrome",
          status: "failed",
          error: "MCP error -32000: Connection closed",
        },
      ]),
    );

    expect(emitted).toHaveLength(1);
    expect(emitted[0].capabilityName).toBe("browser-chrome");
    expect(emitted[0].symptom).toBe("execution-error");
    expect(emitted[0].detail).toBe("MCP error -32000: Connection closed");
    expect(emitted[0].triggeringInput.userUtterance).toBe("[mcp init]");
    expect(emitted[0].triggeringInput.artifact).toBeUndefined();
  });

  it("falls back to a default detail when entry.error is absent", () => {
    const { detector, emitted } = makeDetector([
      makeCap({ name: "browser-chrome", provides: "browser-control" }),
    ]);

    detector.processSystemInit(
      makeInit([{ name: "browser-chrome", status: "failed" }]),
    );

    expect(emitted).toHaveLength(1);
    expect(emitted[0].detail).toBe("MCP server failed to start");
  });

  it("emits not-enabled for status=needs-auth", () => {
    const { detector, emitted } = makeDetector([
      makeCap({ name: "browser-chrome", provides: "browser-control" }),
    ]);

    detector.processSystemInit(
      makeInit([{ name: "browser-chrome", status: "needs-auth" }]),
    );

    expect(emitted).toHaveLength(1);
    expect(emitted[0].symptom).toBe("not-enabled");
  });

  it("emits not-enabled for status=disabled", () => {
    const { detector, emitted } = makeDetector([
      makeCap({ name: "browser-chrome", provides: "browser-control" }),
    ]);

    detector.processSystemInit(
      makeInit([{ name: "browser-chrome", status: "disabled" }]),
    );

    expect(emitted).toHaveLength(1);
    expect(emitted[0].symptom).toBe("not-enabled");
  });

  it("silently skips non-capability MCP servers (findByName returns undefined)", () => {
    const { detector, emitted } = makeDetector([
      makeCap({ name: "browser-chrome", provides: "browser-control" }),
    ]);

    detector.processSystemInit(
      makeInit([
        { name: "todo", status: "failed", error: "boom" },
        { name: "chart", status: "failed" },
      ]),
    );

    expect(emitted).toHaveLength(0);
  });

  it("skips connected / pending entries", () => {
    const { detector, emitted } = makeDetector([
      makeCap({ name: "browser-chrome", provides: "browser-control" }),
    ]);

    detector.processSystemInit(
      makeInit([
        { name: "browser-chrome", status: "connected" },
      ]),
    );
    detector.processSystemInit(
      makeInit([
        { name: "browser-chrome", status: "pending" },
      ]),
    );

    expect(emitted).toHaveLength(0);
  });

  it("is a no-op for non-init system messages", () => {
    const { detector, emitted } = makeDetector([
      makeCap({ name: "browser-chrome", provides: "browser-control" }),
    ]);

    detector.processSystemInit({
      type: "system",
      subtype: "task_progress",
      mcp_servers: [{ name: "browser-chrome", status: "failed" }],
    });

    expect(emitted).toHaveLength(0);
  });

  it("is a no-op for non-system messages", () => {
    const { detector, emitted } = makeDetector([
      makeCap({ name: "browser-chrome", provides: "browser-control" }),
    ]);

    detector.processSystemInit({
      type: "assistant",
      message: { content: [] },
    });

    expect(emitted).toHaveLength(0);
  });

  it("is idempotent — calling twice for the same capability does not double-emit", () => {
    const { detector, emitted } = makeDetector([
      makeCap({ name: "browser-chrome", provides: "browser-control" }),
    ]);

    const frame = makeInit([
      { name: "browser-chrome", status: "failed", error: "boom" },
    ]);

    detector.processSystemInit(frame);
    detector.processSystemInit(frame);

    expect(emitted).toHaveLength(1);
  });

  it("emits one CFR per distinct failed capability in a single init frame", () => {
    const { detector, emitted } = makeDetector([
      makeCap({ name: "browser-chrome", provides: "browser-control" }),
      makeCap({ name: "desktop-x11", provides: "desktop-control" }),
    ]);

    detector.processSystemInit(
      makeInit([
        { name: "browser-chrome", status: "failed", error: "e1" },
        { name: "desktop-x11", status: "failed", error: "e2" },
        { name: "todo", status: "failed" },
      ]),
    );

    expect(emitted).toHaveLength(2);
    const names = emitted.map((e) => e.capabilityName).sort();
    expect(names).toEqual(["browser-chrome", "desktop-x11"]);
  });
});
