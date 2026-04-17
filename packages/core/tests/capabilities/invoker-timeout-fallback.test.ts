/**
 * Isolated test for the message-string-only timeout detection path in CapabilityInvoker.
 *
 * The main invoker.test.ts exercises timeout via a real `sleep 9999` script, which
 * exercises the `err.killed` / `err.code === "ETIMEDOUT"` detection branches.
 * This file uses vi.mock to inject an error with only a message string containing
 * "timeout" (no killed flag, no ETIMEDOUT code), verifying the string-fallback branch.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
}));

import { execFile } from "node:child_process";
import { CapabilityInvoker } from "../../src/capabilities/invoker.js";
import type { InvokerDeps } from "../../src/capabilities/invoker.js";
import type { CfrEmitter } from "../../src/capabilities/cfr-emitter.js";
import type { CapabilityRegistry } from "../../src/capabilities/registry.js";
import type { Capability } from "../../src/capabilities/types.js";
import type { TriggeringInput } from "../../src/capabilities/cfr-types.js";
import { conversationOrigin } from "../../src/capabilities/cfr-helpers.js";

function makeFakeRegistry(capPath = "/fake/cap"): CapabilityRegistry {
  const cap: Capability = {
    name: "test-cap",
    provides: "audio-to-text",
    interface: "script",
    path: capPath,
    status: "available",
    enabled: true,
    health: "healthy",
    canDelete: false,
  };
  return {
    listByProvides: vi.fn(() => [cap]),
  } as unknown as CapabilityRegistry;
}

function makeFakeCfr() {
  const emitted: unknown[] = [];
  const cfr = {
    emitFailure: vi.fn((f) => {
      const failure = { ...f, id: "test-id", detectedAt: new Date().toISOString(), attemptNumber: 1, previousAttempts: [] };
      emitted.push(failure);
      return failure;
    }),
  } as unknown as CfrEmitter;
  return { cfr, emitted };
}

function makeTriggeringInput(): TriggeringInput {
  return {
    origin: conversationOrigin(
      { transportId: "dashboard", channelId: "ch-1", sender: "user" },
      "conv-1",
      1,
    ),
  };
}

describe("CapabilityInvoker — timeout string-fallback detection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns timeout when execFile throws an error whose message contains 'timeout' (no killed/ETIMEDOUT)", async () => {
    // Simulate an error with only a message string — no killed flag, no ETIMEDOUT code
    const timeoutErr = new Error("Request timeout after 30s");
    // Explicitly no 'killed' or 'code' field
    (execFile as ReturnType<typeof vi.fn>).mockImplementation(
      (_path: string, _args: string[], _opts: unknown, callback: (err: Error | null) => void) => {
        callback(timeoutErr);
        return {} as ReturnType<typeof execFile>;
      },
    );

    const { cfr } = makeFakeCfr();
    const deps: InvokerDeps = {
      cfr,
      registry: makeFakeRegistry(),
      originFactory: () => conversationOrigin(
        { transportId: "dashboard", channelId: "ch-1", sender: "system" },
        "",
        0,
      ),
    };

    const invoker = new CapabilityInvoker(deps);
    const result = await invoker.run({
      capabilityType: "audio-to-text",
      scriptName: "transcribe.sh",
      args: ["/tmp/test.wav"],
      triggeringInput: makeTriggeringInput(),
    });

    expect(result.kind).toBe("failure");
    if (result.kind === "failure") {
      expect(result.symptom).toBe("timeout");
    }
    expect((cfr.emitFailure as ReturnType<typeof vi.fn>).mock.calls[0][0].symptom).toBe("timeout");
  });
});
