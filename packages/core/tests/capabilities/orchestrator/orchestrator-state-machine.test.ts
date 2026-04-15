/**
 * Unit tests for orchestrator-state-machine.ts
 * Table-driven — covers all transitions including budget exhaustion.
 */

import { describe, it, expect } from "vitest";
import {
  nextAction,
  type FixSession,
  type OrchestratorEvent,
  type Action,
} from "../../../src/capabilities/orchestrator-state-machine.js";

function makeSession(overrides: Partial<FixSession> = {}): FixSession {
  return {
    failureId: "f-001",
    capabilityType: "audio-to-text",
    attemptNumber: 1,
    state: "IDLE",
    attempts: [],
    totalJobsSpawned: 0,
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
    label: "EXECUTING + EXECUTE_JOB_DONE(success=true) → SPAWN_REFLECT_JOB",
    session: { state: "EXECUTING", attemptNumber: 1 },
    event: { type: "EXECUTE_JOB_DONE", success: true },
    expected: { action: "SPAWN_REFLECT_JOB" },
  },
  {
    label: "REFLECTING + REFLECT_JOB_DONE → REVERIFY",
    session: { state: "REFLECTING", attemptNumber: 1 },
    event: { type: "REFLECT_JOB_DONE", nextHypothesis: "try reinstalling deps" },
    expected: { action: "REVERIFY" },
  },
  {
    label: "REVERIFYING + REVERIFY_PASS → REPROCESS_TURN",
    session: { state: "REVERIFYING", attemptNumber: 1 },
    event: { type: "REVERIFY_PASS", recoveredContent: "hello world" },
    expected: { action: "REPROCESS_TURN", recoveredContent: "hello world" },
  },
  {
    label: "DONE + REPROCESS_SENT → NOOP",
    session: { state: "DONE", attemptNumber: 1 },
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
    label: "ACKED + ACK_SENT with 5 jobs already spawned → SURRENDER",
    session: { state: "ACKED", attemptNumber: 1, totalJobsSpawned: 5 },
    event: { type: "ACK_SENT" },
    expected: { action: "SURRENDER" },
  },
  {
    label: "EXECUTING + EXECUTE_JOB_DONE(success) with 5 jobs → SURRENDER",
    session: { state: "EXECUTING", attemptNumber: 1, totalJobsSpawned: 5 },
    event: { type: "EXECUTE_JOB_DONE", success: true },
    expected: { action: "SURRENDER" },
  },
  {
    label: "REFLECTING + REFLECT_JOB_DONE with 5 jobs → SURRENDER",
    session: { state: "REFLECTING", attemptNumber: 2, totalJobsSpawned: 5 },
    event: { type: "REFLECT_JOB_DONE", nextHypothesis: "anything" },
    expected: { action: "SURRENDER" },
  },
  {
    label: "budget: totalJobsSpawned=6 (over) → SURRENDER regardless",
    session: { state: "IDLE", attemptNumber: 1, totalJobsSpawned: 6 },
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
