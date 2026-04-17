/**
 * Tests for cross-conversation surrender scope behavior.
 *
 * - Surrender on (cap=X, conv=A, turn=5)
 * - New CFR on (cap=X, conv=B, turn=1) within 10 min → surrender (cross-conv cooldown)
 * - onCapabilityNowAvailable clears all scopes for that type
 */

import { describe, it, expect, vi } from "vitest";
import { RecoveryOrchestrator } from "../../../src/capabilities/recovery-orchestrator.js";
import type { OrchestratorDeps, AutomationResult } from "../../../src/capabilities/recovery-orchestrator.js";
import type { CapabilityFailure } from "../../../src/capabilities/cfr-types.js";
import { conversationOrigin } from "../../../src/capabilities/cfr-helpers.js";
import type { CapabilityRegistry } from "../../../src/capabilities/registry.js";
import type { CapabilityWatcher } from "../../../src/capabilities/watcher.js";

function makeFailure(
  conversationId: string,
  turnNumber: number,
  capabilityType = "audio-to-text",
  failureId?: string,
): CapabilityFailure {
  return {
    id: failureId ?? "f-" + Math.random().toString(36).slice(2, 8),
    capabilityType,
    capabilityName: "stt-deepgram",
    symptom: "execution-error",
    detail: "exit 1",
    triggeringInput: {
      origin: conversationOrigin(
        { transportId: "whatsapp", channelId: "ch-1", sender: "+10000000001" },
        conversationId,
        turnNumber,
      ),
      artifact: {
        type: "audio",
        rawMediaPath: "/tmp/test-audio.ogg",
        mimeType: "audio/ogg",
      },
    },
    attemptNumber: 1,
    previousAttempts: [],
    detectedAt: new Date().toISOString(),
  };
}

function makeDeps(overrides: Partial<OrchestratorDeps> = {}): OrchestratorDeps {
  return {
    spawnAutomation: vi.fn().mockResolvedValue({ jobId: "j-1", automationId: "a-1" }),
    awaitAutomation: vi.fn().mockResolvedValue({ status: "failed" } as AutomationResult),
    getJobRunDir: vi.fn().mockReturnValue(null),
    capabilityRegistry: {
      get: vi.fn().mockReturnValue(undefined),
    } as unknown as CapabilityRegistry,
    watcher: {
      rescanNow: vi.fn().mockResolvedValue([]),
    } as unknown as CapabilityWatcher,
    emitAck: vi.fn().mockResolvedValue(undefined),
    reprocessTurn: vi.fn().mockResolvedValue(undefined),
    now: () => new Date().toISOString(),
    ...overrides,
  };
}

describe("cross-conversation surrender cooldown", () => {
  it("surrender on conv-A triggers immediate surrender for conv-B within 10 min", async () => {
    const deps = makeDeps();
    const orchestrator = new RecoveryOrchestrator(deps);

    // conv-A exhausts all attempts
    await orchestrator.handle(makeFailure("conv-A", 5));
    expect(orchestrator.listSurrendered()).toHaveLength(1);

    // conv-B, different turn — same capability type, still within cooldown
    const spawnCallsBefore = (deps.spawnAutomation as ReturnType<typeof vi.fn>).mock.calls.length;
    await orchestrator.handle(makeFailure("conv-B", 1));

    // Should NOT have spawned any new jobs
    expect((deps.spawnAutomation as ReturnType<typeof vi.fn>).mock.calls.length).toBe(spawnCallsBefore);

    // Should have emitted a surrender ack for conv-B
    const emitAck = deps.emitAck as ReturnType<typeof vi.fn>;
    const convBSurrenders = emitAck.mock.calls.filter((c) => {
      const origin = c[0].triggeringInput.origin;
      return c[1] === "surrender-cooldown" && origin.kind === "conversation" && origin.conversationId === "conv-B";
    });
    expect(convBSurrenders).toHaveLength(1);
  });

  it("different capability type is NOT blocked by another type's surrender", async () => {
    const deps = makeDeps();
    const orchestrator = new RecoveryOrchestrator(deps);

    // Exhaust audio-to-text
    await orchestrator.handle(makeFailure("conv-A", 1, "audio-to-text"));

    const spawnBefore = (deps.spawnAutomation as ReturnType<typeof vi.fn>).mock.calls.length;

    // text-to-image failure — should attempt recovery, not surrender immediately
    await orchestrator.handle(makeFailure("conv-A", 2, "text-to-image"));

    // Should have attempted at least one spawn for the different type
    expect((deps.spawnAutomation as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(spawnBefore);
  });

  it("onCapabilityNowAvailable clears ALL scopes for that type", async () => {
    const deps = makeDeps();
    const orchestrator = new RecoveryOrchestrator(deps);

    // Two separate failures for same type
    await orchestrator.handle(makeFailure("conv-A", 1));
    // conv-B immediately surrenders due to cooldown but still adds a scope? No — cooldown prevents new scope.
    // Actually let's verify: the scope is set when we surrender from a full fix run, not from the cooldown path.
    // So we should have 1 scope from the conv-A run.
    expect(orchestrator.listSurrendered()).toHaveLength(1);

    // Clear
    orchestrator.onCapabilityNowAvailable("audio-to-text");
    expect(orchestrator.listSurrendered()).toHaveLength(0);

    // Now conv-B should NOT be blocked
    const spawnBefore = (deps.spawnAutomation as ReturnType<typeof vi.fn>).mock.calls.length;
    await orchestrator.handle(makeFailure("conv-B", 3));
    // Should attempt recovery (spawn was called)
    expect((deps.spawnAutomation as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(spawnBefore);
  });

  it("surrender scope is bypassed when capability registry reports status=available (C1 fix)", async () => {
    // Scenario: user manually fixes the capability after surrender.
    // CapabilityWatcher picks it up → registry now reports status=available.
    // The next CFR should start a new fix session, not surrender immediately.
    const deps = makeDeps({
      capabilityRegistry: {
        // First call during conv-A's run: unavailable (causes surrender)
        // Second call during conv-B's run: available (bypass the scope)
        get: vi
          .fn()
          .mockReturnValueOnce(undefined)    // conv-A: not found → surrender
          .mockReturnValue({ status: "available", provides: "audio-to-text" }),
      } as unknown as CapabilityRegistry,
    });
    const orchestrator = new RecoveryOrchestrator(deps);

    // conv-A exhausts all attempts — surrender scope recorded
    await orchestrator.handle(makeFailure("conv-A", 5));
    expect(orchestrator.listSurrendered()).toHaveLength(1);

    // conv-B arrives while still within 10-min cooldown window,
    // but capability is now healthy in registry
    const spawnCallsBefore = (deps.spawnAutomation as ReturnType<typeof vi.fn>).mock.calls.length;
    await orchestrator.handle(makeFailure("conv-B", 1));

    // Should have attempted a new spawn (recovery started, not immediate surrender)
    expect((deps.spawnAutomation as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(
      spawnCallsBefore,
    );
  });

  it("surrender scope has expiresAt ~10 minutes in the future", async () => {
    const deps = makeDeps();
    const orchestrator = new RecoveryOrchestrator(deps);

    const before = Date.now();
    await orchestrator.handle(makeFailure("conv-A", 1));
    const after = Date.now();

    const scopes = orchestrator.listSurrendered();
    expect(scopes).toHaveLength(1);

    const expiresAt = new Date(scopes[0].expiresAt).getTime();
    const tenMin = 10 * 60 * 1000;

    // expiresAt should be approximately before + 10min
    expect(expiresAt).toBeGreaterThanOrEqual(before + tenMin - 100);
    expect(expiresAt).toBeLessThanOrEqual(after + tenMin + 100);
  });
});
