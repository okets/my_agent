/**
 * Shared data contracts for Capability Failure Recovery (CFR).
 * Created in M9.6-S1. Treated as immutable after S1 — subsequent sprints import, never modify.
 */

export type CapabilityFailureSymptom =
  | "not-installed"
  | "not-enabled"
  | "deps-missing"
  | "execution-error"
  | "empty-result"
  | "timeout"
  | "validation-failed";

export interface TriggeringInput {
  channel: {
    transportId: string; // e.g. "whatsapp"
    channelId: string;
    sender: string;
    replyTo?: string;
    senderName?: string;
    groupId?: string;
  };
  conversationId: string;
  turnNumber: number;
  artifact?: {
    type: "audio" | "image" | "document";
    rawMediaPath: string; // absolute; written by RawMediaStore in S1
    mimeType: string;
  };
  userUtterance?: string;
}

export interface FixAttempt {
  attempt: 1 | 2 | 3;
  startedAt: string; // ISO8601
  endedAt: string; // ISO8601
  hypothesis: string;
  change: string;
  verificationInputPath: string;
  verificationResult: "pass" | "fail";
  failureMode?: string;
  nextHypothesis?: string;
  jobId: string; // the automation job UUID
  modelUsed: "opus" | "sonnet";
  phase: "execute" | "reflect";
}

export interface CapabilityFailure {
  id: string; // uuid; stable across iterations
  capabilityType: string; // e.g. "audio-to-text"
  capabilityName?: string; // e.g. "stt-deepgram"
  symptom: CapabilityFailureSymptom;
  detail?: string; // human-readable tail from the origin error
  triggeringInput: TriggeringInput;
  attemptNumber: 1 | 2 | 3;
  previousAttempts: FixAttempt[];
  detectedAt: string; // ISO8601
  parentFailureId?: string; // set if this CFR was spawned by another CFR (nesting cap)
}

export type SurrenderScope = {
  capabilityType: string;
  conversationId: string;
  turnNumber: number;
  expiresAt: string; // ISO8601, +10min cross-conversation cooldown
};
