/**
 * Tests for reverifyAudioToText via dispatchReverify (M9.6-S18).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { dispatchReverify } from "../../src/capabilities/reverify.js";
import type { CapabilityRegistry } from "../../src/capabilities/registry.js";
import type { CapabilityWatcher } from "../../src/capabilities/watcher.js";
import type { CapabilityInvoker } from "../../src/capabilities/invoker.js";
import type { CapabilityFailure } from "../../src/capabilities/cfr-types.js";

function makeCapDir(): string {
  const capDir = join(tmpdir(), `stt-test-${randomUUID()}`);
  mkdirSync(join(capDir, "scripts"), { recursive: true });
  return capDir;
}

function makeRegistry(type: string, capDir: string): CapabilityRegistry {
  return {
    get: (t: string) =>
      t === type
        ? { status: "available", name: "stt-test", provides: type, path: capDir, interface: "script" }
        : undefined,
  } as unknown as CapabilityRegistry;
}

function makeWatcher(): CapabilityWatcher {
  return {
    rescanNow: vi.fn().mockResolvedValue(undefined),
    testAll: vi.fn().mockResolvedValue(undefined),
  } as unknown as CapabilityWatcher;
}

function makeFailure(rawMediaPath: string): CapabilityFailure {
  return {
    id: "f-stt",
    capabilityType: "audio-to-text",
    symptom: "execution-error",
    triggeringInput: {
      origin: { kind: "conversation", conversationId: "c1" },
      artifact: { rawMediaPath },
    },
    attemptNumber: 1,
    previousAttempts: [],
    detectedAt: new Date().toISOString(),
  };
}

function makeInvoker(result: { kind: "success"; parsed: unknown } | { kind: "failure"; detail: string }): CapabilityInvoker {
  return {
    run: vi.fn().mockResolvedValue(result),
  } as unknown as CapabilityInvoker;
}

describe("reverifyAudioToText (via dispatchReverify)", () => {
  const audioPath = join(tmpdir(), `test-audio-${randomUUID()}.ogg`);

  beforeEach(() => {
    writeFileSync(audioPath, Buffer.from("fake-audio-data"));
  });

  it("returns pass:true when invoker returns transcription", async () => {
    const capDir = makeCapDir();
    const registry = makeRegistry("audio-to-text", capDir);
    const watcher = makeWatcher();
    const invoker = makeInvoker({ kind: "success", parsed: { text: "hello world", confidence: 0.95 } });
    const failure = makeFailure(audioPath);

    const result = await dispatchReverify(failure, registry, watcher, invoker);

    expect(result.pass).toBe(true);
    expect(result.recoveredContent).toBe("hello world");
    expect((invoker.run as ReturnType<typeof vi.fn>)).toHaveBeenCalledOnce();
  });

  it("returns pass:false with clear message when invoker is absent", async () => {
    const capDir = makeCapDir();
    const registry = makeRegistry("audio-to-text", capDir);
    const watcher = makeWatcher();
    const failure = makeFailure(audioPath);

    const result = await dispatchReverify(failure, registry, watcher, undefined);

    expect(result.pass).toBe(false);
    expect(result.failureMode).toMatch(/invoker required/i);
  });

  it("returns pass:false when invoker returns failure", async () => {
    const capDir = makeCapDir();
    const registry = makeRegistry("audio-to-text", capDir);
    const watcher = makeWatcher();
    const invoker = makeInvoker({ kind: "failure", detail: "timeout" });
    const failure = makeFailure(audioPath);

    const result = await dispatchReverify(failure, registry, watcher, invoker);

    expect(result.pass).toBe(false);
    expect(result.failureMode).toMatch(/invoker: timeout/);
  });

  it("returns pass:false when invoker returns empty text", async () => {
    const capDir = makeCapDir();
    const registry = makeRegistry("audio-to-text", capDir);
    const watcher = makeWatcher();
    const invoker = makeInvoker({ kind: "success", parsed: { text: "" } });
    const failure = makeFailure(audioPath);

    const result = await dispatchReverify(failure, registry, watcher, invoker);

    expect(result.pass).toBe(false);
    expect(result.failureMode).toMatch(/non-empty.*text/i);
  });

  it("returns pass:false when rawMediaPath is absent from triggeringInput", async () => {
    const capDir = makeCapDir();
    const registry = makeRegistry("audio-to-text", capDir);
    const watcher = makeWatcher();
    const invoker = makeInvoker({ kind: "success", parsed: { text: "hello" } });
    const failure: CapabilityFailure = {
      id: "f-stt-no-path",
      capabilityType: "audio-to-text",
      symptom: "execution-error",
      triggeringInput: { origin: { kind: "system", component: "test" } },
      attemptNumber: 1,
      previousAttempts: [],
      detectedAt: new Date().toISOString(),
    };

    const result = await dispatchReverify(failure, registry, watcher, invoker);

    expect(result.pass).toBe(false);
    expect(result.failureMode).toMatch(/rawMediaPath/i);
  });
});
