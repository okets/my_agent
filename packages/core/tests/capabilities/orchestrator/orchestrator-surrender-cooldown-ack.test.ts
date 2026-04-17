/**
 * Tests for S6-FU3: cooldown-hit surrender emits "surrender-cooldown" kind,
 * not "surrender". Verifies that a second CFR within the 10-min window:
 *   - emits emitAck with "surrender-cooldown"
 *   - does NOT spawn any new jobs (no recovery attempt)
 *
 * The "event-appender not called a second time" invariant lives in app.ts
 * (which branches on "surrender-cooldown" to skip appendEvent). That branch
 * is covered by code inspection + the TypeScript exhaustive check — the
 * orchestrator's contract is to emit the right kind, which this test verifies.
 *
 * Created in M9.6-S8 (S6-FU3 fix).
 */

import { describe, it, expect, vi } from "vitest";
import { RecoveryOrchestrator } from "../../../src/capabilities/recovery-orchestrator.js";
import type { OrchestratorDeps, AutomationResult } from "../../../src/capabilities/recovery-orchestrator.js";
import type { CapabilityFailure } from "../../../src/capabilities/cfr-types.js";
import { conversationOrigin } from "../../../src/capabilities/cfr-helpers.js";
import type { CapabilityRegistry } from "../../../src/capabilities/registry.js";
import type { CapabilityWatcher } from "../../../src/capabilities/watcher.js";

function makeFailure(conversationId: string, turnNumber: number): CapabilityFailure {
  return {
    id: "f-" + Math.random().toString(36).slice(2, 8),
    capabilityType: "audio-to-text",
    capabilityName: "stt-deepgram",
    symptom: "execution-error",
    triggeringInput: {
      origin: conversationOrigin(
        { transportId: "whatsapp", channelId: "ch-1", sender: "+10000000001" },
        conversationId,
        turnNumber,
      ),
      artifact: { type: "audio", rawMediaPath: "/tmp/test.ogg", mimeType: "audio/ogg" },
    },
    attemptNumber: 1,
    previousAttempts: [],
    detectedAt: new Date().toISOString(),
  };
}

function makeDeps(): OrchestratorDeps {
  return {
    spawnAutomation: vi.fn().mockResolvedValue({ jobId: "j-1", automationId: "a-1" }),
    awaitAutomation: vi.fn().mockResolvedValue({ status: "failed" } as AutomationResult),
    getJobRunDir: vi.fn().mockReturnValue(null),
    capabilityRegistry: { get: vi.fn().mockReturnValue(undefined) } as unknown as CapabilityRegistry,
    watcher: { rescanNow: vi.fn().mockResolvedValue([]) } as unknown as CapabilityWatcher,
    emitAck: vi.fn().mockResolvedValue(undefined),
    reprocessTurn: vi.fn().mockResolvedValue(undefined),
    now: () => new Date().toISOString(),
  };
}

describe("S6-FU3 — cooldown-hit surrender emits surrender-cooldown kind", () => {
  it("second CFR within cooldown window emits surrender-cooldown, not surrender", async () => {
    const deps = makeDeps();
    const orchestrator = new RecoveryOrchestrator(deps);
    const emitAck = deps.emitAck as ReturnType<typeof vi.fn>;

    // First CFR on conv-A exhausts attempts → records surrender scope
    await orchestrator.handle(makeFailure("conv-A", 1));
    expect(orchestrator.listSurrendered()).toHaveLength(1);
    const acksAfterFirst = emitAck.mock.calls.length;

    // Second CFR on conv-B within cooldown — should NOT spawn, should emit surrender-cooldown
    const spawnsBefore = (deps.spawnAutomation as ReturnType<typeof vi.fn>).mock.calls.length;
    await orchestrator.handle(makeFailure("conv-B", 1));

    expect((deps.spawnAutomation as ReturnType<typeof vi.fn>).mock.calls.length).toBe(spawnsBefore);

    const newAcks = emitAck.mock.calls.slice(acksAfterFirst);
    expect(newAcks).toHaveLength(1);
    expect(newAcks[0][1]).toBe("surrender-cooldown");
  });
});
