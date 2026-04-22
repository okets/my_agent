/**
 * test-harness-mcp-coverage.test.ts — M9.6-S24 Task 5.
 *
 * Regression guard: every installed capability type must resolve to a
 * dispatcher in `testCapability()`. A silent `{ status: "untested" }` from a
 * missing dispatch entry would let a degraded MCP plug slip past the daily
 * probe — the symptom we saw live on 2026-04-20, where browser-chrome and
 * desktop-x11 were registered but never tested.
 *
 * Contract under test:
 *
 *   - For an MCP capability (interface: "mcp"), `testCapability()` resolves to
 *     the generic MCP path — NOT the script-interface TEST_CONTRACTS table.
 *   - For a script capability with a known `provides:` type in TEST_CONTRACTS,
 *     `testCapability()` dispatches to the type-specific tester.
 *   - For any other shape (script + unknown type, or mcp + missing entrypoint)
 *     it returns `{ status: "error", message: <meaningful> }`. Never silently
 *     untested.
 */

import { describe, it, expect } from "vitest";
import type { Capability } from "../../src/capabilities/types.js";
import { testCapability } from "../../src/capabilities/test-harness.js";

function makeCap(overrides: Partial<Capability>): Capability {
  return {
    name: "fake",
    interface: "mcp",
    path: "/nonexistent/cap",
    status: "available",
    health: "healthy",
    enabled: true,
    canDelete: false,
    ...overrides,
  };
}

describe("testCapability() dispatch coverage", () => {
  it("MCP capabilities always reach the MCP test path — never silent-untested", async () => {
    // browser-control shape: provides set, interface mcp, no entrypoint → must
    // return a meaningful error ("missing entrypoint"), not silently skip.
    const cap = makeCap({
      name: "browser-chrome",
      provides: "browser-control",
      interface: "mcp",
    });

    const result = await testCapability(cap, "/tmp");
    expect(result.status).toBe("error");
    expect(result.message).toMatch(/entrypoint/i);
  });

  it("desktop-control MCP capability reaches the MCP test path", async () => {
    const cap = makeCap({
      name: "Desktop X11",
      provides: "desktop-control",
      interface: "mcp",
    });

    const result = await testCapability(cap, "/tmp");
    expect(result.status).toBe("error");
    expect(result.message).toMatch(/entrypoint/i);
  });

  it("unavailable capability returns an error describing the status (not untested)", async () => {
    const cap = makeCap({
      name: "broken-cap",
      provides: "browser-control",
      interface: "mcp",
      status: "unavailable",
    });

    const result = await testCapability(cap, "/tmp");
    expect(result.status).toBe("error");
    expect(result.message).toMatch(/unavailable/i);
  });

  it("script capability without well-known type returns explicit error", async () => {
    const cap = makeCap({
      name: "custom",
      interface: "script",
      provides: undefined,
    });

    const result = await testCapability(cap, "/tmp");
    expect(result.status).toBe("error");
    expect(result.message).toMatch(/no well-known type/i);
  });

  it("script capability with unrecognized `provides` returns explicit error", async () => {
    const cap = makeCap({
      name: "custom-typed",
      interface: "script",
      provides: "made-up-type",
    });

    const result = await testCapability(cap, "/tmp");
    expect(result.status).toBe("error");
    expect(result.message).toMatch(/no test contract for type: made-up-type/i);
  });

  it("script + audio-to-text dispatches to the audio tester (not untested)", async () => {
    const cap = makeCap({
      name: "stt-deepgram",
      provides: "audio-to-text",
      interface: "script",
    });

    const result = await testCapability(cap, "/tmp");
    // transcribe.sh is missing at the fake path — must surface that as an
    // error, not a silent untested.
    expect(result.status).toBe("error");
    expect(result.message).toMatch(/transcribe\.sh not found/);
  });

  it("testCapability never returns a status other than 'ok' or 'error'", async () => {
    const shapes: Capability[] = [
      makeCap({ provides: "browser-control", interface: "mcp" }),
      makeCap({ provides: "desktop-control", interface: "mcp" }),
      makeCap({ provides: "audio-to-text", interface: "script" }),
      makeCap({ provides: "text-to-audio", interface: "script" }),
      makeCap({ provides: "text-to-image", interface: "script" }),
      makeCap({ provides: undefined, interface: "script" }),
      makeCap({ provides: "unknown", interface: "script" }),
    ];

    for (const cap of shapes) {
      const result = await testCapability(cap, "/tmp");
      expect(["ok", "error"]).toContain(result.status);
    }
  });
});
