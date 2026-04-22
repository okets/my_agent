/**
 * Unit tests for orchestrator-state-machine.ts
 * Table-driven — covers all transitions including budget exhaustion.
 */

import { describe, it, expect, vi } from "vitest";
import {
  nextAction,
  type FixSession,
  type OrchestratorEvent,
  type Action,
} from "../../../src/capabilities/orchestrator-state-machine.js";
import {
  RecoveryOrchestrator,
  type OrchestratorDeps,
  type AutomationResult,
} from "../../../src/capabilities/recovery-orchestrator.js";
import type {
  CapabilityFailure,
  TriggeringOrigin,
} from "../../../src/capabilities/cfr-types.js";
import { conversationOrigin } from "../../../src/capabilities/cfr-helpers.js";
import type { CapabilityRegistry } from "../../../src/capabilities/registry.js";
import type { CapabilityWatcher } from "../../../src/capabilities/watcher.js";

function makeSession(overrides: Partial<FixSession> = {}): FixSession {
  return {
    failureId: "f-001",
    capabilityType: "audio-to-text",
    attemptNumber: 1,
    state: "IDLE",
    attempts: [],
    totalJobsSpawned: 0,
    attachedOrigins: [],
    ...overrides,
  };
}

type TransitionCase = {
  label: string;
  session: Partial<FixSession>;
  event: OrchestratorEvent;
  expected: Action;
};

const transitions: TransitionCase[] = [
  // ── Happy path ────────────────────────────────────────────────────────────
  {
    label: "IDLE + CFR_RECEIVED → SEND_ACK(attempt)",
    session: { state: "IDLE", attemptNumber: 1 },
    event: { type: "CFR_RECEIVED" },
    expected: { action: "SEND_ACK", kind: "attempt" },
  },
  {
    label: "ACKED + ACK_SENT → SPAWN_EXECUTE_JOB",
    session: { state: "ACKED", attemptNumber: 1 },
    event: { type: "ACK_SENT" },
    expected: { action: "SPAWN_EXECUTE_JOB" },
  },
  {
    label: "EXECUTING + EXECUTE_JOB_DONE(success=true) → REVERIFY",
    session: { state: "EXECUTING", attemptNumber: 1 },
    event: { type: "EXECUTE_JOB_DONE", success: true },
    expected: { action: "REVERIFY" },
  },
  {
    label: "REVERIFYING + REVERIFY_PASS_RECOVERED → REPROCESS_TURN",
    session: { state: "REVERIFYING", attemptNumber: 1 },
    event: { type: "REVERIFY_PASS_RECOVERED", recoveredContent: "hello world" },
    expected: { action: "REPROCESS_TURN", recoveredContent: "hello world" },
  },
  {
    label: "RESTORED_WITH_REPROCESS + REPROCESS_SENT → NOOP",
    session: { state: "RESTORED_WITH_REPROCESS", attemptNumber: 1 },
    event: { type: "REPROCESS_SENT" },
    expected: { action: "NOOP" },
  },

  // ── Execute failure + iterate ──────────────────────────────────────────
  {
    label: "EXECUTING + EXECUTE_JOB_DONE(fail) attempt=1 → ITERATE(2)",
    session: { state: "EXECUTING", attemptNumber: 1 },
    event: { type: "EXECUTE_JOB_DONE", success: false },
    expected: { action: "ITERATE", nextAttemptNumber: 2 },
  },
  {
    label: "EXECUTING + EXECUTE_JOB_DONE(fail) attempt=2 → ITERATE(3)",
    session: { state: "EXECUTING", attemptNumber: 2 },
    event: { type: "EXECUTE_JOB_DONE", success: false },
    expected: { action: "ITERATE", nextAttemptNumber: 3 },
  },
  {
    label: "EXECUTING + EXECUTE_JOB_DONE(fail) attempt=3 → SURRENDER",
    session: { state: "EXECUTING", attemptNumber: 3 },
    event: { type: "EXECUTE_JOB_DONE", success: false },
    expected: { action: "SURRENDER" },
  },

  // ── Reverify failure + iterate ─────────────────────────────────────────
  {
    label: "REVERIFYING + REVERIFY_FAIL attempt=1 → ITERATE(2)",
    session: { state: "REVERIFYING", attemptNumber: 1 },
    event: { type: "REVERIFY_FAIL" },
    expected: { action: "ITERATE", nextAttemptNumber: 2 },
  },
  {
    label: "REVERIFYING + REVERIFY_FAIL attempt=2 → ITERATE(3)",
    session: { state: "REVERIFYING", attemptNumber: 2 },
    event: { type: "REVERIFY_FAIL" },
    expected: { action: "ITERATE", nextAttemptNumber: 3 },
  },
  {
    label: "REVERIFYING + REVERIFY_FAIL attempt=3 → SURRENDER",
    session: { state: "REVERIFYING", attemptNumber: 3 },
    event: { type: "REVERIFY_FAIL" },
    expected: { action: "SURRENDER" },
  },

  // ── Budget exhaustion ──────────────────────────────────────────────────
  {
    label: "ACKED + ACK_SENT with 4 jobs already spawned → SURRENDER",
    session: { state: "ACKED", attemptNumber: 1, totalJobsSpawned: 4 },
    event: { type: "ACK_SENT" },
    expected: { action: "SURRENDER" },
  },
  {
    label: "EXECUTING + EXECUTE_JOB_DONE(success) with 4 jobs → SURRENDER",
    session: { state: "EXECUTING", attemptNumber: 1, totalJobsSpawned: 4 },
    event: { type: "EXECUTE_JOB_DONE", success: true },
    expected: { action: "SURRENDER" },
  },
  {
    label: "budget: totalJobsSpawned=5 (over) → SURRENDER regardless",
    session: { state: "IDLE", attemptNumber: 1, totalJobsSpawned: 5 },
    event: { type: "CFR_RECEIVED" },
    expected: { action: "SURRENDER" },
  },

  // ── No-op for unexpected events ────────────────────────────────────────
  {
    label: "IDLE + irrelevant event → NOOP",
    session: { state: "IDLE", attemptNumber: 1 },
    event: { type: "ACK_SENT" },
    expected: { action: "NOOP" },
  },
  {
    label: "SURRENDER is terminal → NOOP",
    session: { state: "SURRENDER", attemptNumber: 3 },
    event: { type: "CFR_RECEIVED" },
    expected: { action: "NOOP" },
  },
  {
    label: "EXECUTING + unrelated event → NOOP",
    session: { state: "EXECUTING", attemptNumber: 1 },
    event: { type: "CFR_RECEIVED" },
    expected: { action: "NOOP" },
  },

  // ── Terminal-fix path (RESTORED_TERMINAL) ─────────────────────────────────
  {
    label: "REVERIFYING + REVERIFY_PASS_TERMINAL → TERMINAL_ACK",
    session: { state: "REVERIFYING", attemptNumber: 1 },
    event: { type: "REVERIFY_PASS_TERMINAL" },
    expected: { action: "TERMINAL_ACK" },
  },
  {
    label: "RESTORED_TERMINAL is terminal → NOOP",
    session: { state: "RESTORED_TERMINAL", attemptNumber: 1 },
    event: { type: "CFR_RECEIVED" },
    expected: { action: "NOOP" },
  },
];

describe("orchestrator state machine — transitions", () => {
  for (const tc of transitions) {
    it(tc.label, () => {
      const session = makeSession(tc.session);
      const result = nextAction(session, tc.event);
      expect(result).toEqual(tc.expected);
    });
  }
});

// ─── RecoveryOrchestrator.isInFlight() ───────────────────────────────────────

function makeConvFailure(id: string): CapabilityFailure {
  const origin: TriggeringOrigin = conversationOrigin(
    { transportId: "whatsapp", channelId: "ch-1", sender: "+10000000001" },
    "conv-A",
    1,
  );
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

function makeIsInFlightDeps(
  spawnGate: Promise<void>,
): OrchestratorDeps {
  return {
    spawnAutomation: vi.fn().mockImplementation(async () => {
      await spawnGate;
      return { jobId: "j-1", automationId: "a-1" };
    }),
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
  };
}

describe("RecoveryOrchestrator.isInFlight()", () => {
  it("returns true while a recovery is mid-flight, false after it completes", async () => {
    let releaseSpawn!: () => void;
    const spawnGate = new Promise<void>((r) => {
      releaseSpawn = r;
    });

    const deps = makeIsInFlightDeps(spawnGate);
    const orchestrator = new RecoveryOrchestrator(deps);

    // Before any failure, not in-flight.
    expect(orchestrator.isInFlight("audio-to-text")).toBe(false);

    const p = orchestrator.handle(makeConvFailure("fail-1"));
    // Yield so handle() reaches the spawn gate and sets the inFlight entry.
    await new Promise((r) => setTimeout(r, 0));

    // While the gated spawnAutomation is awaiting, the session is in-flight.
    expect(orchestrator.isInFlight("audio-to-text")).toBe(true);

    // Release the gate and let the fix session drain to terminal.
    releaseSpawn();
    await p;

    // After the terminal drain deletes the entry, no longer in-flight.
    expect(orchestrator.isInFlight("audio-to-text")).toBe(false);
  });
});
