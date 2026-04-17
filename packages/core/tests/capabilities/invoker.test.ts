/**
 * S10 acceptance test — CapabilityInvoker 6-symptom matrix.
 *
 * Verifies that the invoker emits the correct CFR symptom and returns
 * {kind: "failure"} for every failure path, and returns {kind: "success"}
 * with parsed output on the happy path.
 *
 * Uses fakes for cfr and registry — no real capabilities required.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { CapabilityInvoker } from "../../src/capabilities/invoker.js";
import type { InvokerDeps, InvokeOptions } from "../../src/capabilities/invoker.js";
import type { CfrEmitter } from "../../src/capabilities/cfr-emitter.js";
import type { CapabilityRegistry } from "../../src/capabilities/registry.js";
import type { Capability } from "../../src/capabilities/types.js";
import type { TriggeringInput } from "../../src/capabilities/cfr-types.js";
import { conversationOrigin } from "../../src/capabilities/cfr-helpers.js";
import { tmpdir } from "node:os";
import { writeFileSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

// ── Fakes ─────────────────────────────────────────────────────────────────────

function makeCfr() {
  const emitted: ReturnType<CfrEmitter["emitFailure"]>[] = [];
  const cfr = {
    emitFailure: vi.fn((f) => {
      const failure = { ...f, id: "test-id", detectedAt: new Date().toISOString(), attemptNumber: 1 as const, previousAttempts: [] };
      emitted.push(failure);
      return failure;
    }),
  } as unknown as CfrEmitter;
  return { cfr, emitted };
}

function makeRegistry(cap?: Partial<Capability>) {
  const capabilities: Capability[] = cap
    ? [{
        name: cap.name ?? "test-cap",
        provides: cap.provides ?? "audio-to-text",
        interface: cap.interface ?? "script",
        path: cap.path ?? "/tmp",
        status: cap.status ?? "available",
        enabled: cap.enabled ?? true,
        health: "healthy",
        canDelete: false,
        ...cap,
      }]
    : [];

  return {
    listByProvides: vi.fn((_type: string) => capabilities),
  } as unknown as CapabilityRegistry;
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

function makeDeps(cap?: Partial<Capability>): InvokerDeps & { cfr: CfrEmitter; emitted: unknown[] } {
  const { cfr, emitted } = makeCfr();
  const registry = makeRegistry(cap);
  return {
    cfr,
    emitted,
    registry,
    originFactory: () => conversationOrigin(
      { transportId: "dashboard", channelId: "ch-1", sender: "system" },
      "",
      0,
    ),
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Write a temp script and return its path + containing dir. */
function writeTempScript(content: string, executable = true): { scriptPath: string; capPath: string } {
  const capPath = join(tmpdir(), `test-cap-${randomUUID()}`);
  const { mkdirSync } = require("node:fs");
  mkdirSync(join(capPath, "scripts"), { recursive: true });
  const scriptPath = join(capPath, "scripts", "transcribe.sh");
  writeFileSync(scriptPath, content);
  if (executable) chmodSync(scriptPath, 0o755);
  return { scriptPath, capPath };
}

const triggeringInput = makeTriggeringInput();
const baseOpts: Omit<InvokeOptions, "triggeringInput"> = {
  capabilityType: "audio-to-text",
  scriptName: "transcribe.sh",
  args: ["/tmp/test.wav"],
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("CapabilityInvoker — 6-symptom matrix", () => {
  describe("not-installed — no capability registered", () => {
    it("returns failure with not-installed symptom and emits CFR", async () => {
      const deps = makeDeps(); // empty registry
      (deps.registry.listByProvides as ReturnType<typeof vi.fn>).mockReturnValue([]);
      const invoker = new CapabilityInvoker(deps);

      const result = await invoker.run({ ...baseOpts, triggeringInput });

      expect(result.kind).toBe("failure");
      if (result.kind === "failure") {
        expect(result.symptom).toBe("not-installed");
      }
      expect(deps.cfr.emitFailure).toHaveBeenCalledOnce();
      expect((deps.cfr.emitFailure as ReturnType<typeof vi.fn>).mock.calls[0][0].symptom).toBe("not-installed");
    });
  });

  describe("not-enabled — capability exists but disabled", () => {
    it("returns failure with not-enabled symptom and emits CFR", async () => {
      const deps = makeDeps({ enabled: false });
      const invoker = new CapabilityInvoker(deps);

      const result = await invoker.run({ ...baseOpts, triggeringInput });

      expect(result.kind).toBe("failure");
      if (result.kind === "failure") expect(result.symptom).toBe("not-enabled");
      expect((deps.cfr.emitFailure as ReturnType<typeof vi.fn>).mock.calls[0][0].symptom).toBe("not-enabled");
    });
  });

  describe("execution-error — capability enabled but status != available", () => {
    it("returns failure with execution-error symptom and emits CFR", async () => {
      const deps = makeDeps({ enabled: true, status: "unavailable", unavailableReason: "missing DEEPGRAM_API_KEY" });
      const invoker = new CapabilityInvoker(deps);

      const result = await invoker.run({ ...baseOpts, triggeringInput });

      expect(result.kind).toBe("failure");
      if (result.kind === "failure") expect(result.symptom).toBe("execution-error");
      expect((deps.cfr.emitFailure as ReturnType<typeof vi.fn>).mock.calls[0][0].symptom).toBe("execution-error");
    });
  });

  describe("timeout — execFile rejects with timeout error", () => {
    it("returns failure with timeout symptom and emits CFR", async () => {
      const { capPath } = writeTempScript(
        '#!/bin/bash\nsleep 9999',
      );
      const deps = makeDeps({ path: capPath });
      const invoker = new CapabilityInvoker(deps);

      const result = await invoker.run({
        ...baseOpts,
        triggeringInput,
        timeoutMs: 50,
      });

      expect(result.kind).toBe("failure");
      if (result.kind === "failure") expect(result.symptom).toBe("timeout");
      expect((deps.cfr.emitFailure as ReturnType<typeof vi.fn>).mock.calls[0][0].symptom).toBe("timeout");
    }, 5_000);
  });

  describe("validation-failed — script exits 0 but stdout is not JSON", () => {
    it("returns failure with validation-failed symptom and emits CFR", async () => {
      const { capPath } = writeTempScript('#!/bin/bash\necho "not json output"');
      const deps = makeDeps({ path: capPath });
      const invoker = new CapabilityInvoker(deps);

      const result = await invoker.run({ ...baseOpts, triggeringInput, expectJson: true });

      expect(result.kind).toBe("failure");
      if (result.kind === "failure") expect(result.symptom).toBe("validation-failed");
      expect((deps.cfr.emitFailure as ReturnType<typeof vi.fn>).mock.calls[0][0].symptom).toBe("validation-failed");
    });
  });

  describe("success — script exits 0 with valid JSON", () => {
    it("returns success with parsed JSON and does not emit CFR", async () => {
      const { capPath } = writeTempScript('#!/bin/bash\necho \'{"text":"hello","language":"en"}\'');
      const deps = makeDeps({ path: capPath });
      const invoker = new CapabilityInvoker(deps);

      const result = await invoker.run({ ...baseOpts, triggeringInput, expectJson: true });

      expect(result.kind).toBe("success");
      if (result.kind === "success") {
        expect((result.parsed as Record<string, unknown>)?.text).toBe("hello");
      }
      expect(deps.cfr.emitFailure).not.toHaveBeenCalled();
    });
  });

  describe("success — script exits 0 without expectJson", () => {
    it("returns success with raw stdout and does not emit CFR", async () => {
      const { capPath } = writeTempScript('#!/bin/bash\necho "raw output"');
      const deps = makeDeps({ path: capPath });
      const invoker = new CapabilityInvoker(deps);

      const result = await invoker.run({ ...baseOpts, triggeringInput, expectJson: false });

      expect(result.kind).toBe("success");
      if (result.kind === "success") expect(result.stdout.trim()).toBe("raw output");
      expect(deps.cfr.emitFailure).not.toHaveBeenCalled();
    });
  });

  describe("execution-error — script exits non-zero (not timeout)", () => {
    it("returns failure with execution-error symptom and emits CFR", async () => {
      const { capPath } = writeTempScript('#!/bin/bash\nexit 1');
      const deps = makeDeps({ path: capPath });
      const invoker = new CapabilityInvoker(deps);

      const result = await invoker.run({ ...baseOpts, triggeringInput });

      expect(result.kind).toBe("failure");
      if (result.kind === "failure") expect(result.symptom).toBe("execution-error");
      expect((deps.cfr.emitFailure as ReturnType<typeof vi.fn>).mock.calls[0][0].symptom).toBe("execution-error");
    });
  });

  describe("triggeringInput forwarded to cfr.emitFailure", () => {
    it("passes the provided triggeringInput to the emitter", async () => {
      const deps = makeDeps();
      (deps.registry.listByProvides as ReturnType<typeof vi.fn>).mockReturnValue([]);
      const invoker = new CapabilityInvoker(deps);
      const input = makeTriggeringInput();

      await invoker.run({ ...baseOpts, triggeringInput: input });

      const call = (deps.cfr.emitFailure as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(call.triggeringInput).toBe(input);
    });
  });

  describe("multi-instance selection — prefers first enabled+available", () => {
    it("uses the first enabled+available cap when multiple are registered", async () => {
      const { capPath: capPath1 } = writeTempScript('#!/bin/bash\necho \'{"text":"from-cap2","language":"en"}\'');
      const { cfr, emitted } = makeCfr();
      const disabledCap: Capability = {
        name: "cap-disabled",
        provides: "audio-to-text",
        interface: "script",
        path: "/nonexistent-disabled",
        status: "available",
        enabled: false,
        health: "healthy",
        canDelete: false,
      };
      const enabledCap: Capability = {
        name: "cap-enabled",
        provides: "audio-to-text",
        interface: "script",
        path: capPath1,
        status: "available",
        enabled: true,
        health: "healthy",
        canDelete: false,
      };
      const registry = {
        listByProvides: vi.fn(() => [disabledCap, enabledCap]),
      } as unknown as CapabilityRegistry;
      const deps: InvokerDeps & { cfr: CfrEmitter; emitted: unknown[] } = {
        cfr,
        emitted,
        registry,
        originFactory: () => conversationOrigin(
          { transportId: "dashboard", channelId: "ch-1", sender: "system" },
          "",
          0,
        ),
      };

      const invoker = new CapabilityInvoker(deps);
      const result = await invoker.run({ ...baseOpts, triggeringInput, expectJson: true });

      expect(result.kind).toBe("success");
      if (result.kind === "success") {
        expect((result.parsed as Record<string, unknown>)?.text).toBe("from-cap2");
      }
      expect(deps.cfr.emitFailure).not.toHaveBeenCalled();
    });
  });
});
