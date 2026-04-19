/**
 * orchestrator-state-machine.ts — Pure state machine for the CFR recovery loop.
 *
 * No I/O. All transitions are deterministic given (session, event).
 * Created in M9.6-S4.
 */

import type { FixAttempt, TriggeringOrigin } from "./cfr-types.js";

export type OrchestratorState =
  | "IDLE"
  | "ACKED"
  | "EXECUTING"
  | "REFLECTING"
  | "REVERIFYING"
  | "RESTORED_WITH_REPROCESS"
  | "RESTORED_TERMINAL"
  | "SURRENDER";

export type OrchestratorEvent =
  | { type: "CFR_RECEIVED" }
  | { type: "ACK_SENT" }
  | { type: "EXECUTE_JOB_SPAWNED"; jobId: string }
  | { type: "EXECUTE_JOB_DONE"; success: boolean }
  | { type: "REFLECT_JOB_DONE"; nextHypothesis: string }
  | { type: "REVERIFY_PASS_RECOVERED"; recoveredContent: string }
  | { type: "REVERIFY_PASS_TERMINAL" }
  | { type: "REVERIFY_FAIL" }
  | { type: "REPROCESS_SENT" };

export interface FixSession {
  failureId: string;
  capabilityType: string;
  attemptNumber: 1 | 2 | 3;
  state: OrchestratorState;
  executeJobId?: string;
  reflectJobId?: string;
  attempts: FixAttempt[];
  totalJobsSpawned: number;
  /**
   * When a surrender is about to be emitted, set to "budget" if the 5-job
   * nesting cap forced an early bail, or "iteration-3" if all three attempts
   * ran and reverify still failed. Consumed by RecoveryOrchestrator.surrender()
   * to pick the right user-facing copy (M9.6-S6).
   */
  surrenderReason?: "budget" | "iteration-3" | "redesign-needed" | "insufficient-context";
  /**
   * All triggering origins that have coalesced onto this fix session (M9.6-S12
   * Task 6a — D7). Initialized with the first CFR's origin; late-arriving CFRs
   * for the same capability type append (N-aware, no second spawn, no duplicate
   * ack). The terminal drain (§3.4) iterates this list so every attached origin
   * gets its recovery delivery (automation → CFR_RECOVERY.md, conversation →
   * reprocessTurn/emitAck, system → log) without dropping any.
   */
  attachedOrigins: TriggeringOrigin[];
}

export type Action =
  | { action: "SEND_ACK"; kind: "attempt" | "status" | "surrender" }
  | { action: "SPAWN_EXECUTE_JOB" }
  | { action: "SPAWN_REFLECT_JOB" }
  | { action: "REVERIFY" }
  | { action: "REPROCESS_TURN"; recoveredContent: string }
  | { action: "TERMINAL_ACK" }
  | { action: "SURRENDER" }
  | { action: "ITERATE"; nextAttemptNumber: 2 | 3 }
  | { action: "NOOP" };

const MAX_JOBS = 5;

/**
 * Compute the next action given the current session state and an incoming event.
 *
 * Returns SURRENDER immediately if the 5-job budget is already exhausted
 * (checked before any state-specific logic).
 */
export function nextAction(session: FixSession, event: OrchestratorEvent): Action {
  // Budget exhaustion guard — applies globally, any state.
  if (session.totalJobsSpawned >= MAX_JOBS) {
    return { action: "SURRENDER" };
  }

  const { state, attemptNumber } = session;

  switch (state) {
    case "IDLE": {
      if (event.type === "CFR_RECEIVED") {
        return { action: "SEND_ACK", kind: "attempt" };
      }
      break;
    }

    case "ACKED": {
      if (event.type === "ACK_SENT") {
        return { action: "SPAWN_EXECUTE_JOB" };
      }
      break;
    }

    case "EXECUTING": {
      if (event.type === "EXECUTE_JOB_DONE") {
        if (event.success) {
          return { action: "SPAWN_REFLECT_JOB" };
        } else {
          // Execute job failed — iterate or surrender
          if (attemptNumber < 3) {
            return { action: "ITERATE", nextAttemptNumber: (attemptNumber + 1) as 2 | 3 };
          } else {
            return { action: "SURRENDER" };
          }
        }
      }
      break;
    }

    case "REFLECTING": {
      if (event.type === "REFLECT_JOB_DONE") {
        return { action: "REVERIFY" };
      }
      break;
    }

    case "REVERIFYING": {
      if (event.type === "REVERIFY_PASS_RECOVERED") {
        return { action: "REPROCESS_TURN", recoveredContent: event.recoveredContent };
      }
      if (event.type === "REVERIFY_PASS_TERMINAL") {
        return { action: "TERMINAL_ACK" };
      }
      if (event.type === "REVERIFY_FAIL") {
        if (attemptNumber < 3) {
          return { action: "ITERATE", nextAttemptNumber: (attemptNumber + 1) as 2 | 3 };
        } else {
          return { action: "SURRENDER" };
        }
      }
      break;
    }

    case "RESTORED_WITH_REPROCESS": {
      if (event.type === "REPROCESS_SENT") {
        return { action: "NOOP" };
      }
      break;
    }

    case "RESTORED_TERMINAL": {
      // Terminal — no further transitions
      break;
    }

    case "SURRENDER": {
      // Terminal — no further transitions
      break;
    }
  }

  return { action: "NOOP" };
}
