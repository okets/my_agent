/**
 * Tests for RecoveryOrchestrator budget and deduplication logic.
 *
 * - Same capability fails twice → 1 session (dedup)
 * - 5-job cap reached → surrender
 * - Surrender scope prevents retry within 10 min
 * - onCapabilityNowAvailable clears surrender scope
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { RecoveryOrchestrator } from "../../../src/capabilities/recovery-orchestrator.js";
import type { OrchestratorDeps, AutomationSpec, AutomationResult } from "../../../src/capabilities/recovery-orchestrator.js";
import type { CapabilityFailure } from "../../../src/capabilities/cfr-types.js";
import { conversationOrigin } from "../../../src/capabilities/cfr-helpers.js";
import type { CapabilityRegistry } from "../../../src/capabilities/registry.js";
import type { CapabilityWatcher } from "../../../src/capabilities/watcher.js";

function makeFailure(overrides: Partial<CapabilityFailure> = {}): CapabilityFailure {
  return {
    id: "f-" + Math.random().toString(36).slice(2, 8),
    capabilityType: "audio-to-text",
    capabilityName: "stt-deepgram",
    symptom: "execution-error",
    detail: "exit code 1",
    triggeringInput: {
      origin: conversationOrigin(
        { transportId: "whatsapp", channelId: "ch-1", sender: "+10000000001" },
        "conv-A",
        1,
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
    ...overrides,
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
    spawnAutomation: vi.fn().mockRejectedValue(new Error("spawn not expected")),
    awaitAutomation: vi.fn().mockResolvedValue({ status: "failed" } as AutomationResult),
    getJobRunDir: vi.fn().mockReturnValue(null),
    capabilityRegistry: mockRegistry,
    watcher: mockWatcher,
    emitAck: vi.fn().mockResolvedValue(undefined),
    reprocessTurn: vi.fn().mockResolvedValue(undefined),
    now: () => new Date().toISOString(),
    ...overrides,
  };
}

describe("RecoveryOrchestrator — deduplication", () => {
  it("second failure for same type while fix in-flight does not spawn a second session", async () => {
    // spawnAutomation never resolves — simulates long-running job
    let resolveSpawn!: () => void;
    const spawnPromise = new Promise<void>((r) => { resolveSpawn = r; });

    const spawnAutomation = vi.fn().mockImplementation(async () => {
      await spawnPromise;
      return { jobId: "j-1", automationId: "a-1" };
    });

    const deps = makeDeps({ spawnAutomation });
    const orchestrator = new RecoveryOrchestrator(deps);

    const f1 = makeFailure({ id: "fail-1" });
    const f2 = makeFailure({ id: "fail-2" }); // same capabilityType

    // Start first handle (will block at spawnAutomation)
    const p1 = orchestrator.handle(f1);
    // Yield to let handle() reach the spawn point
    await new Promise((r) => setTimeout(r, 0));

    // Second failure — should dedup silently
    await orchestrator.handle(f2);

    // Spawn should only have been attempted for the first failure
    // (second was attached without spawning)
    expect(spawnAutomation).toHaveBeenCalledTimes(1);

    // Unblock
    resolveSpawn();
    await p1;
  });
});

describe("RecoveryOrchestrator — surrender scope", () => {
  it("surrender is emitted when all 3 attempts are exhausted", async () => {
    const deps = makeDeps({
      spawnAutomation: vi.fn().mockResolvedValue({ jobId: "j-1", automationId: "a-1" }),
      awaitAutomation: vi.fn().mockResolvedValue({ status: "failed" } as AutomationResult),
    });
    const orchestrator = new RecoveryOrchestrator(deps);

    await orchestrator.handle(makeFailure());

    const emitAck = deps.emitAck as ReturnType<typeof vi.fn>;
    const surrenderCalls = emitAck.mock.calls.filter((c) => c[1] === "surrender");
    expect(surrenderCalls.length).toBeGreaterThan(0);
    expect(orchestrator.listSurrendered()).toHaveLength(1);
  });

  it("new failure within 10-min cooldown triggers surrender immediately without spawning", async () => {
    const deps = makeDeps({
      spawnAutomation: vi.fn().mockResolvedValue({ jobId: "j-1", automationId: "a-1" }),
      awaitAutomation: vi.fn().mockResolvedValue({ status: "failed" } as AutomationResult),
    });
    const orchestrator = new RecoveryOrchestrator(deps);

    // First failure exhausts all attempts → records surrender scope
    await orchestrator.handle(makeFailure({ id: "fail-1" }));

    const spawnBefore = (deps.spawnAutomation as ReturnType<typeof vi.fn>).mock.calls.length;
    const emitAckBefore = (deps.emitAck as ReturnType<typeof vi.fn>).mock.calls.length;

    // Second failure for same type — should hit cooldown without spawning
    const f2 = makeFailure({
      id: "fail-2",
      triggeringInput: {
        origin: conversationOrigin(
          { transportId: "whatsapp", channelId: "ch-1", sender: "+10000000001" },
          "conv-B",
          5,
        ),
        artifact: {
          type: "audio",
          rawMediaPath: "/tmp/test-audio.ogg",
          mimeType: "audio/ogg",
        },
      },
    });
    await orchestrator.handle(f2);

    // No new spawns
    expect((deps.spawnAutomation as ReturnType<typeof vi.fn>).mock.calls.length).toBe(spawnBefore);

    // But a surrender ack was emitted for the second failure
    const newAcks = (deps.emitAck as ReturnType<typeof vi.fn>).mock.calls.slice(emitAckBefore);
    const newSurrenders = newAcks.filter((c) => c[1] === "surrender-cooldown");
    expect(newSurrenders).toHaveLength(1);
  });

  it("onCapabilityNowAvailable clears surrender scope, allowing new fix attempt", async () => {
    const deps = makeDeps({
      spawnAutomation: vi.fn().mockResolvedValue({ jobId: "j-1", automationId: "a-1" }),
      awaitAutomation: vi.fn().mockResolvedValue({ status: "failed" } as AutomationResult),
    });
    const orchestrator = new RecoveryOrchestrator(deps);

    await orchestrator.handle(makeFailure({ id: "fail-1" }));
    expect(orchestrator.listSurrendered()).toHaveLength(1);

    orchestrator.onCapabilityNowAvailable("audio-to-text");
    expect(orchestrator.listSurrendered()).toHaveLength(0);

    // Now a new failure should NOT immediately surrender (scope was cleared)
    const spawnBefore = (deps.spawnAutomation as ReturnType<typeof vi.fn>).mock.calls.length;
    await orchestrator.handle(makeFailure({ id: "fail-3" }));
    expect((deps.spawnAutomation as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(spawnBefore);
  });
});

describe("RecoveryOrchestrator — job budget", () => {
  it("no more than 4 automation jobs are spawned across 3 attempts (1 execute per attempt)", async () => {
    // S17: reflect removed. Each attempt = 1 execute job. MAX_JOBS=4. In practice: 3 spawns.
    let spawnCount = 0;
    const spawnAutomation = vi.fn().mockImplementation(async (_spec: AutomationSpec) => {
      spawnCount++;
      return { jobId: `j-${spawnCount}`, automationId: `a-${spawnCount}` };
    });

    // All execute jobs succeed (status "done") but reverify always fails (nonexistent cap path).
    const awaitAutomation = vi.fn().mockResolvedValue({ status: "done" } as AutomationResult);

    const mockWatcher = {
      rescanNow: vi.fn().mockResolvedValue([]),
    } as unknown as CapabilityWatcher;

    const deps = makeDeps({
      spawnAutomation,
      awaitAutomation,
      capabilityRegistry: {
        get: vi.fn().mockReturnValue({
          status: "available",
          path: "/nonexistent-cap-path",
          provides: "audio-to-text",
          enabled: true,
        }),
      } as unknown as CapabilityRegistry,
      watcher: mockWatcher,
    });

    const orchestrator = new RecoveryOrchestrator(deps);
    await orchestrator.handle(makeFailure());

    expect(spawnCount).toBeLessThanOrEqual(4);
    expect(spawnCount).toBe(3);
  });
});
