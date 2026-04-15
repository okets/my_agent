/**
 * Tests for the 20s status-timer in RecoveryOrchestrator (M9.6-S6 D2).
 *
 * - The "attempt" ack fires immediately.
 * - If the fix loop is still grinding after 20s, a "status" ack fires.
 * - If the fix loop completes (DONE or SURRENDER) before 20s, no status
 *   ack fires.
 *
 * Uses vitest fake timers to advance virtual time; real timers remain
 * untouched so awaited promises resolve normally.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { RecoveryOrchestrator } from "../../../src/capabilities/recovery-orchestrator.js";
import type {
  OrchestratorDeps,
  AutomationResult,
} from "../../../src/capabilities/recovery-orchestrator.js";
import type { CapabilityFailure } from "../../../src/capabilities/cfr-types.js";
import type { CapabilityRegistry } from "../../../src/capabilities/registry.js";
import type { CapabilityWatcher } from "../../../src/capabilities/watcher.js";

function makeFailure(): CapabilityFailure {
  return {
    id: "f-timing",
    capabilityType: "audio-to-text",
    symptom: "execution-error",
    triggeringInput: {
      channel: { transportId: "whatsapp", channelId: "whatsapp", sender: "+1" },
      conversationId: "conv-A",
      turnNumber: 1,
      artifact: {
        type: "audio",
        rawMediaPath: "/tmp/x.ogg",
        mimeType: "audio/ogg",
      },
    },
    attemptNumber: 1,
    previousAttempts: [],
    detectedAt: new Date().toISOString(),
  };
}

function makeDeps(overrides: Partial<OrchestratorDeps> = {}): OrchestratorDeps {
  const mockRegistry = {
    get: vi.fn().mockReturnValue(undefined),
  } as unknown as CapabilityRegistry;
  const mockWatcher = {
    rescanNow: vi.fn().mockResolvedValue([]),
  } as unknown as CapabilityWatcher;
  return {
    spawnAutomation: vi.fn().mockRejectedValue(new Error("no spawn")),
    awaitAutomation: vi
      .fn()
      .mockResolvedValue({ status: "failed" } as AutomationResult),
    getJobRunDir: vi.fn().mockReturnValue(null),
    capabilityRegistry: mockRegistry,
    watcher: mockWatcher,
    emitAck: vi.fn().mockResolvedValue(undefined),
    reprocessTurn: vi.fn().mockResolvedValue(undefined),
    now: () => new Date().toISOString(),
    ...overrides,
  };
}

describe("RecoveryOrchestrator — 20s status timer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("emits an initial 'attempt' ack immediately on CFR receipt", async () => {
    // spawnAutomation rejects synchronously — the whole run_fix_loop completes
    // in microtask time; we only care that 'attempt' was emitted.
    const emitAck = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps({ emitAck });
    const orchestrator = new RecoveryOrchestrator(deps);

    await orchestrator.handle(makeFailure());

    const attemptCalls = emitAck.mock.calls.filter((c) => c[1] === "attempt");
    expect(attemptCalls.length).toBe(1);
  });

  it("fires a 'status' ack when the fix session is still running after 20s", async () => {
    // spawnAutomation never resolves — session sits in EXECUTING long enough
    // for the 20s timer to fire.
    let resolveSpawn!: (v: { jobId: string; automationId: string }) => void;
    const spawnPromise = new Promise<{ jobId: string; automationId: string }>(
      (r) => {
        resolveSpawn = r;
      },
    );
    const spawnAutomation = vi
      .fn()
      .mockImplementation(async () => await spawnPromise);

    const emitAck = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps({ spawnAutomation, emitAck });
    const orchestrator = new RecoveryOrchestrator(deps);

    const handlePromise = orchestrator.handle(makeFailure());

    // Let the microtask queue drain so the initial 'attempt' ack + state
    // transitions run before we advance the clock.
    await Promise.resolve();
    await Promise.resolve();

    // Advance virtual time past 20s; the status timer should fire.
    await vi.advanceTimersByTimeAsync(20_000);

    const statusCalls = emitAck.mock.calls.filter((c) => c[1] === "status");
    expect(statusCalls.length).toBe(1);

    // Let the session unwind so test shutdown is clean.
    resolveSpawn({ jobId: "j-1", automationId: "a-1" });
    await handlePromise;
  });

  it("does not fire 'status' when the session completes within 20s (budget-hit path)", async () => {
    // spawnAutomation throws → runOneAttempt returns recovered:false
    // immediately → session surrenders before the 20s timer can fire.
    const emitAck = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps({
      spawnAutomation: vi.fn().mockRejectedValue(new Error("boom")),
      emitAck,
    });
    const orchestrator = new RecoveryOrchestrator(deps);

    await orchestrator.handle(makeFailure());

    // Drain any pending tasks.
    await vi.advanceTimersByTimeAsync(25_000);

    const statusCalls = emitAck.mock.calls.filter((c) => c[1] === "status");
    expect(statusCalls.length).toBe(0);

    // Should have emitted attempt + surrender (or surrender-budget), not status.
    const kinds = emitAck.mock.calls.map((c) => c[1]);
    expect(kinds).toContain("attempt");
    expect(kinds.some((k) => k === "surrender" || k === "surrender-budget")).toBe(
      true,
    );
  });
});
