/**
 * Shared data contracts for Capability Failure Recovery (CFR).
 * Created in M9.6-S1.
 * M9.6-S9: TriggeringInput widened with origin: TriggeringOrigin discriminated union.
 * FixAttempt.phase stays as-is (Phase 3 narrows in S17).
 */

export type CapabilityFailureSymptom =
  | "not-installed"
  | "not-enabled"
  | "deps-missing"
  | "execution-error"
  | "empty-result"
  | "timeout"
  | "validation-failed";

/** Channel context carried by a conversation-origin TriggeringOrigin. */
export interface ChannelContext {
  transportId: string; // e.g. "whatsapp"
  channelId: string;
  sender: string;
  replyTo?: string;
  senderName?: string;
  groupId?: string;
}

/**
 * Discriminated union of the three contexts from which a capability failure can be triggered.
 * S9 wires only "conversation". S12 wires "automation" and "system".
 */
export type TriggeringOrigin =
  | { kind: "conversation"; channel: ChannelContext; conversationId: string; turnNumber: number }
  | { kind: "automation"; automationId: string; jobId: string; runDir: string; notifyMode: "immediate" | "debrief" | "none" }
  | { kind: "system"; component: string };

export interface TriggeringInput {
  origin: TriggeringOrigin;
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
  phase: "execute";
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

/**
 * SessionContext — captured at SDK session-open time; keyed by SDK `session_id`.
 *
 * S12 adds these so `McpCapabilityCfrDetector`'s `originFactory` (called at
 * hook-fire time from the hook `session_id`) can resolve the origin that owns
 * the session. Brain sessions (conversation) live in `SessionManager`; job
 * sessions (automation) live in `AutomationExecutor`. There is no
 * `SystemSessionContext` — `kind: "system"` origins come from background
 * components that pass their own origin inline, not via SDK hooks.
 *
 * `SessionContext` maps 1:1 onto the corresponding `TriggeringOrigin` variants.
 */
export type SessionContext =
  | ConversationSessionContext
  | AutomationSessionContext;

/** Brain/conversation session — one per active `streamMessage()` call. */
export interface ConversationSessionContext {
  kind: "conversation";
  channel: ChannelContext;
  conversationId: string;
  turnNumber: number;
}

/** Automation/job session — one per `AutomationExecutor.run()` call. */
export interface AutomationSessionContext {
  kind: "automation";
  automationId: string;
  jobId: string;
  runDir: string;
  notifyMode: "immediate" | "debrief" | "none";
}
