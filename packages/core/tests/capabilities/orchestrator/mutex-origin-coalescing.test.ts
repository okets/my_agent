/**
 * mutex-origin-coalescing.test.ts — M9.6-S12 Task 6a.
 *
 * Verifies the per-plug mutex coalesces multiple late-arriving CFRs onto a
 * single FixSession via `attachedOrigins: TriggeringOrigin[]` (D7). The
 * contracts under test:
 *
 *   1. A second CFR for the same capability type while a fix is in-flight
 *      does NOT spawn a second automation.
 *   2. It does NOT emit a duplicate "hold on" (attempt) ack.
 *   3. It appends the new origin to `session.attachedOrigins` (N-aware; any
 *      number of late arrivals).
 *   4. The terminal drain (Task 6b) fires per-origin callbacks in the §3.4
 *      order: automations → conversations → system.
 *   5. Per-origin failures are isolated — one origin's callback throwing
 *      does NOT block sibling origins' callbacks from firing.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RecoveryOrchestrator } from "../../../src/capabilities/recovery-orchestrator.js";
import type {
  OrchestratorDeps,
  AutomationResult,
} from "../../../src/capabilities/recovery-orchestrator.js";
import type {
  CapabilityFailure,
  TriggeringOrigin,
} from "../../../src/capabilities/cfr-types.js";
import { conversationOrigin } from "../../../src/capabilities/cfr-helpers.js";
import type { CapabilityRegistry } from "../../../src/capabilities/registry.js";
import type { CapabilityWatcher } from "../../../src/capabilities/watcher.js";

// ─── test fixtures ───────────────────────────────────────────────────────────

function convOrigin(conversationId: string, turnNumber: number): TriggeringOrigin {
  return conversationOrigin(
    { transportId: "whatsapp", channelId: "ch-1", sender: "+10000000001" },
    conversationId,
    turnNumber,
  );
}

function automationOrigin(
  automationId: string,
  jobId: string,
  runDir = "/tmp/fake-run-dir",
): TriggeringOrigin {
  return {
    kind: "automation",
    automationId,
    jobId,
    runDir,
    notifyMode: "debrief",
  };
}

function systemOrigin(component: string): TriggeringOrigin {
  return { kind: "system", component };
}

function makeFailure(origin: TriggeringOrigin, id: string): CapabilityFailure {
  return {
    id,
    capabilityType: "audio-to-text",
    capabilityName: "stt-deepgram",
    symptom: "execution-error",
    detail: "exit 1",
    triggeringInput: {
      origin,
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
    awaitAutomation: vi
      .fn()
      .mockResolvedValue({ status: "failed" } as AutomationResult),
    getJobRunDir: vi.fn().mockReturnValue(null),
    capabilityRegistry: {
      get: vi.fn().mockReturnValue(undefined),
    } as unknown as CapabilityRegistry,
    watcher: {
      rescanNow: vi.fn().mockResolvedValue([]),
    } as unknown as CapabilityWatcher,
    emitAck: vi.fn().mockResolvedValue(undefined),
    reprocessTurn: vi.fn().mockResolvedValue(undefined),
    writeAutomationRecovery: vi.fn(),
    now: () => new Date().toISOString(),
    ...overrides,
  };
}

// Silence expected per-origin error-isolation logs.
let errorSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  errorSpy.mockRestore();
});

// ─── tests ───────────────────────────────────────────────────────────────────

describe("RecoveryOrchestrator — attachedOrigins mutex coalescing (Task 6a)", () => {
  it("late CFR for same plug does NOT spawn a second automation", async () => {
    let releaseSpawn!: () => void;
    const spawnGate = new Promise<void>((r) => {
      releaseSpawn = r;
    });

    const spawnAutomation = vi.fn().mockImplementation(async () => {
      await spawnGate;
      return { jobId: "j-1", automationId: "a-1" };
    });

    const deps = makeDeps({ spawnAutomation });
    const orchestrator = new RecoveryOrchestrator(deps);

    const first = makeFailure(convOrigin("conv-A", 1), "fail-1");
    const second = makeFailure(convOrigin("conv-B", 2), "fail-2");
    const third = makeFailure(convOrigin("conv-C", 3), "fail-3");

    const p1 = orchestrator.handle(first);
    // Yield so handle() reaches the spawn gate.
    await new Promise((r) => setTimeout(r, 0));

    // N-aware: two more late arrivals coalesce onto the same session.
    await orchestrator.handle(second);
    await orchestrator.handle(third);

    // Still only ONE spawn — the second and third calls should have attached.
    expect(spawnAutomation).toHaveBeenCalledTimes(1);

    releaseSpawn();
    await p1;
  });

  it("late CFR does NOT emit a duplicate 'hold on' (attempt) ack", async () => {
    let releaseSpawn!: () => void;
    const spawnGate = new Promise<void>((r) => {
      releaseSpawn = r;
    });
    const spawnAutomation = vi.fn().mockImplementation(async () => {
      await spawnGate;
      return { jobId: "j-1", automationId: "a-1" };
    });

    const deps = makeDeps({ spawnAutomation });
    const orchestrator = new RecoveryOrchestrator(deps);

    const first = makeFailure(convOrigin("conv-A", 1), "fail-1");
    const second = makeFailure(convOrigin("conv-B", 2), "fail-2");

    const p1 = orchestrator.handle(first);
    await new Promise((r) => setTimeout(r, 0));
    await orchestrator.handle(second);

    const emitAck = deps.emitAck as ReturnType<typeof vi.fn>;
    const attemptAcks = emitAck.mock.calls.filter((c) => c[1] === "attempt");

    // First failure gets exactly one "attempt" ack; second must NOT get one.
    expect(attemptAcks).toHaveLength(1);

    releaseSpawn();
    await p1;
  });

  it("terminal drain on surrender processes automations BEFORE conversations BEFORE system", async () => {
    const order: string[] = [];

    const writeAutomationRecovery = vi.fn().mockImplementation((args) => {
      order.push(`automation:${args.runDir}`);
    });
    const emitAck = vi.fn().mockImplementation(async (failure, kind) => {
      const origin = failure.triggeringInput.origin;
      if (origin.kind === "conversation" && kind === "surrender") {
        order.push(`conversation:${origin.conversationId}:${origin.turnNumber}`);
      }
    });

    // Patch console.log to detect the system-origin log call in order.
    const logSpy = vi.spyOn(console, "log").mockImplementation((...args) => {
      const line = args.join(" ");
      // The orchestrator logs a line starting with the prefix for system drain.
      if (line.includes("terminal drain for system origin")) {
        const match = line.match(/component="([^"]+)"/);
        if (match) order.push(`system:${match[1]}`);
      }
    });

    try {
      const deps = makeDeps({
        spawnAutomation: vi
          .fn()
          .mockResolvedValue({ jobId: "j-1", automationId: "a-1" }),
        awaitAutomation: vi
          .fn()
          .mockResolvedValue({ status: "failed" } as AutomationResult),
        emitAck,
        writeAutomationRecovery,
      });
      const orchestrator = new RecoveryOrchestrator(deps);

      // Originating CFR is conversation; late arrivals include automation + system.
      // But ALL three need to be coalesced before the drain fires, so we need
      // the originator to block at spawn while we attach the others.
      let releaseSpawn!: () => void;
      const spawnGate = new Promise<void>((r) => {
        releaseSpawn = r;
      });
      (deps.spawnAutomation as ReturnType<typeof vi.fn>).mockImplementation(
        async () => {
          await spawnGate;
          return { jobId: "j-1", automationId: "a-1" };
        },
      );

      const first = makeFailure(convOrigin("conv-A", 1), "fail-1");
      const autom = makeFailure(
        automationOrigin("aut-1", "job-1", "/tmp/job-1"),
        "fail-2",
      );
      const sys = makeFailure(systemOrigin("watchdog"), "fail-3");

      const p1 = orchestrator.handle(first);
      await new Promise((r) => setTimeout(r, 0));
      await orchestrator.handle(autom);
      await orchestrator.handle(sys);

      releaseSpawn();
      await p1;

      // Confirm the drain fired each bucket and automations came before
      // conversations came before system.
      const automationIdx = order.findIndex((s) => s.startsWith("automation:"));
      const conversationIdx = order.findIndex((s) => s.startsWith("conversation:"));
      const systemIdx = order.findIndex((s) => s.startsWith("system:"));

      expect(automationIdx).toBeGreaterThanOrEqual(0);
      expect(conversationIdx).toBeGreaterThanOrEqual(0);
      expect(systemIdx).toBeGreaterThanOrEqual(0);
      expect(automationIdx).toBeLessThan(conversationIdx);
      expect(conversationIdx).toBeLessThan(systemIdx);
    } finally {
      logSpy.mockRestore();
    }
  });

  it("per-origin failure isolation: one origin throwing does NOT block siblings", async () => {
    // Two conversation origins coalesced; the first reprocessTurn throws, the
    // second must still fire.
    const reprocessCalls: string[] = [];
    const reprocessTurn = vi
      .fn()
      .mockImplementation(async (failure: CapabilityFailure) => {
        const origin = failure.triggeringInput.origin;
        if (origin.kind === "conversation") {
          reprocessCalls.push(`${origin.conversationId}:${origin.turnNumber}`);
          if (origin.conversationId === "conv-A") {
            throw new Error("boom — first origin's reprocess failed");
          }
        }
      });

    // For this test we want the fix loop to reach the "fixed" branch, so
    // reverify must pass. We force that by mocking awaitAutomation+registry
    // such that execute succeeds and reverify returns a recoveredContent.
    // Simpler approach: stub everything so the session goes down the surrender
    // path, which also runs the terminal drain, and use emitAck as the
    // throwing callback instead.
    const emitAckCalls: string[] = [];
    const emitAck = vi
      .fn()
      .mockImplementation(async (failure: CapabilityFailure, kind: string) => {
        const origin = failure.triggeringInput.origin;
        if (origin.kind === "conversation" && kind === "surrender") {
          emitAckCalls.push(`${origin.conversationId}:${origin.turnNumber}`);
          if (origin.conversationId === "conv-A") {
            throw new Error("boom — first origin's emitAck failed");
          }
        }
      });

    let releaseSpawn!: () => void;
    const spawnGate = new Promise<void>((r) => {
      releaseSpawn = r;
    });
    const spawnAutomation = vi.fn().mockImplementation(async () => {
      await spawnGate;
      return { jobId: "j-1", automationId: "a-1" };
    });

    const deps = makeDeps({
      spawnAutomation,
      awaitAutomation: vi
        .fn()
        .mockResolvedValue({ status: "failed" } as AutomationResult),
      emitAck,
      reprocessTurn,
    });
    const orchestrator = new RecoveryOrchestrator(deps);

    const first = makeFailure(convOrigin("conv-A", 1), "fail-1");
    const second = makeFailure(convOrigin("conv-B", 2), "fail-2");

    const p1 = orchestrator.handle(first);
    await new Promise((r) => setTimeout(r, 0));
    await orchestrator.handle(second);

    releaseSpawn();
    await p1;

    // Both conversation origins got their terminal emitAck — the throw on
    // conv-A did NOT prevent conv-B from firing.
    expect(emitAckCalls).toContain("conv-A:1");
    expect(emitAckCalls).toContain("conv-B:2");
  });
});
