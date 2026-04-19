/**
 * Tests for dispatchReverify routing in reverify.ts (M9.6-S13).
 */

import { describe, it, expect, vi } from "vitest";
import { writeFileSync } from "node:fs";
import { dispatchReverify } from "../../src/capabilities/reverify.js";
import type { CapabilityFailure } from "../../src/capabilities/cfr-types.js";
import { conversationOrigin } from "../../src/capabilities/cfr-helpers.js";
import type { CapabilityRegistry } from "../../src/capabilities/registry.js";
import type { CapabilityWatcher } from "../../src/capabilities/watcher.js";
import type { CapabilityInvoker } from "../../src/capabilities/invoker.js";

function makeWatcher(overrides = {}): CapabilityWatcher {
  return {
    rescanNow: vi.fn().mockResolvedValue([]),
    ...overrides,
  } as unknown as CapabilityWatcher;
}

function makeRegistry(type: string, status: "available" | "unavailable" = "available"): CapabilityRegistry {
  return {
    get: (t: string) =>
      t === type
        ? { status, name: `test-${type}`, provides: type, path: "/fake/cap", interface: "script" }
        : undefined,
  } as unknown as CapabilityRegistry;
}

function makeFailure(capabilityType: string): CapabilityFailure {
  return {
    id: "f-test",
    capabilityType,
    symptom: "execution-error",
    triggeringInput: {
      origin: conversationOrigin(
        { transportId: "whatsapp", channelId: "ch-1", sender: "+1" },
        "conv-A",
        1,
      ),
    },
    attemptNumber: 1,
    previousAttempts: [],
    detectedAt: new Date().toISOString(),
  };
}

describe("dispatchReverify — routing", () => {
  it("routes audio-to-text to reverifyAudioToText (returns pass:true via mock invoker)", async () => {
    const registry = makeRegistry("audio-to-text");
    const watcher = makeWatcher();
    const failure = makeFailure("audio-to-text");
    // Provide a rawMediaPath so reverifyAudioToText doesn't bail early.
    (failure.triggeringInput as { artifact?: { rawMediaPath: string } }).artifact = {
      rawMediaPath: "/tmp/fake-dispatch-audio.ogg",
    };
    writeFileSync("/tmp/fake-dispatch-audio.ogg", Buffer.from("fake"));

    const invoker: CapabilityInvoker = {
      run: vi.fn().mockResolvedValue({ kind: "success", parsed: { text: "hello" } }),
    } as unknown as CapabilityInvoker;

    const result = await dispatchReverify(failure, registry, watcher, invoker);
    expect(result.pass).toBe(true);
    expect(result.recoveredContent).toBe("hello");
  });

  it("routes unknown type to runSmokeFixture (availability fallback when no smoke.sh)", async () => {
    const registry = makeRegistry("custom-type");
    const watcher = makeWatcher();
    const failure = makeFailure("custom-type");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await dispatchReverify(failure, registry, watcher);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("template gap"));
    expect(result.pass).toBe(true);
    warnSpy.mockRestore();
  });

  it("returns pass:false when capability disappears after availability check (cannot resolve capDir)", async () => {
    // Registry returns available on the first call (so waitForAvailability passes),
    // then undefined on the second call (capDir resolution). This simulates a race
    // where the capability is removed between the availability check and dispatch.
    let callCount = 0;
    const registry = {
      get: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return { status: "available", name: "race-type", provides: "race-type", path: "/fake/race", interface: "script" };
        }
        return undefined;
      }),
    } as unknown as CapabilityRegistry;
    const watcher = makeWatcher();
    const failure = makeFailure("race-type");
    const result = await dispatchReverify(failure, registry, watcher);
    expect(result.pass).toBe(false);
    expect(result.failureMode).toMatch(/not found/);
  });
});
