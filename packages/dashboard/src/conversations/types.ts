/**
 * Conversation System — Type Definitions
 *
 * Defines the core data structures for conversation persistence,
 * transcripts, and metadata.
 */

/**
 * Conversation metadata stored in SQLite
 */
export interface Conversation {
  /** Stable unique ID: conv-{ulid} */
  id: string;

  /** Haiku display name (null before turn 5) */
  title: string | null;

  /** Topic tags (updated at naming and on significant shifts) */
  topics: string[];

  /** When the conversation was created */
  created: Date;

  /** When the conversation was last active (for sorting, idle timer) */
  updated: Date;

  /** Number of turns in the conversation (for naming trigger at turn 5) */
  turnCount: number;

  /** Participants (user IDs, contact names, email addresses) */
  participants: string[];

  /** Abbreviation text (~100-200 tokens, null until idle timeout triggers) */
  abbreviation: string | null;

  /** Whether abbreviation needs to be generated/regenerated */
  needsAbbreviation: boolean;

  /** Whether the user manually set the title (protects from auto-rename) */
  manuallyNamed: boolean;

  /** Turn count at last auto-rename (null if never renamed) */
  lastRenamedAtTurn: number | null;

  /** Turn count at last fact extraction (null if never extracted) */
  lastExtractedAtTurn: number | null;

  /** Model used for this conversation (e.g., claude-sonnet-4-20250514) */
  model: string | null;

  /** External party identifier for channel conversations (phone, email) */
  externalParty: string | null;

  /** Whether this is the pinned conversation for channel message routing.
   *  Unpinned conversations can still be viewed/continued via web. */
  isPinned: boolean;

  /** Conversation lifecycle status: one current, rest inactive */
  status: "current" | "inactive";

  /** When the user last sent a message (for active conversation detection) */
  lastUserMessageAt: Date | null;
}

/**
 * A single message in a conversation transcript
 */
export interface TranscriptTurn {
  /** Turn type identifier */
  type: "turn";

  /** Speaker role */
  role: "user" | "assistant";

  /** Message content */
  content: string;

  /** When this turn occurred */
  timestamp: string;

  /** Turn number (both user and assistant share the same turn number) */
  turnNumber: number;

  /** Agent's thinking text (if extended thinking was used) */
  thinkingText?: string;

  /** Token usage for this turn */
  usage?: { input: number; output: number };

  /** Cost in USD for this turn */
  cost?: number;

  /** Channel the message came from (for cross-channel conversations) */
  channel?: string;

  /** Sender identifier (phone number, email, etc.) */
  sender?: string;

  /** TTS audio URL for voice responses (persisted for reload) */
  audioUrl?: string;

  /** Attached files (images, text files) */
  attachments?: Array<{
    id: string;
    filename: string;
    localPath: string;
    mimeType: string;
    size: number;
  }>;
}

/**
 * Conversation metadata header (first line of JSONL)
 */
export interface TranscriptMeta {
  /** Line type identifier */
  type: "meta";

  /** Conversation ID */
  id: string;

  /** Channel (vestigial — channel is per-turn, not per-conversation) */
  channel?: string;

  /** Creation timestamp */
  created: string;

  /** Participants */
  participants: string[];
}

/**
 * Lifecycle events in transcript
 */
export interface TranscriptEvent {
  /** Line type identifier */
  type: "event";

  /** Event name */
  event: "title_assigned" | "compression" | "abbreviation" | "meta_update";

  /** Event timestamp */
  timestamp: string;

  /** title_assigned: the haiku display name */
  title?: string;

  /** title_assigned, meta_update: topic tags */
  topics?: string[];

  /** compression: last turn number that was compressed */
  compressedThrough?: number;

  /** compression: the summary text */
  summary?: string;

  /** abbreviation: the meeting-notes-style summary (~100-200 tokens) */
  text?: string;
}

/**
 * Update to conversation metadata
 */
export interface TranscriptMetaUpdate {
  /** Line type identifier */
  type: "meta_update";

  /** Updated title */
  title?: string;

  /** Updated topics */
  topics?: string[];

  /** Update timestamp */
  timestamp: string;
}

/**
 * Emitted when a CFR orchestrator retroactively corrects a user turn
 * (e.g. STT failure recovered — corrected transcription replaces the placeholder).
 * Appended via ConversationManager.appendEvent(). Consumed by the abbreviation
 * queue in S5 to prefer correctedContent over the original user turn.
 * Defined in M9.6-S1 as a shared contract; consumer wiring is part of S5.
 */
export interface TurnCorrectedEvent {
  type: "turn_corrected";
  turnNumber: number;
  correctedContent: string;
  correctedBy: "cfr-orchestrator";
  cfrFailureId: string;
  timestamp: string; // ISO8601
}

/**
 * Emitted by the orphan watchdog (M9.6-S5) when it rescues an orphaned user
 * turn that never received an assistant reply. Presence of this event for a
 * given turnNumber makes the sweep idempotent — re-runs skip already-rescued
 * turns.
 */
export interface WatchdogRescuedEvent {
  type: "watchdog_rescued";
  turnNumber: number;
  initiatedAt: string; // ISO8601
}

/**
 * Emitted by the orphan watchdog (M9.6-S5) after the systemMessageInjector
 * returns successfully — confirms the rescue prompt actually reached the brain.
 * Paired with `watchdog_rescued` (which is written before injection for
 * at-most-once idempotence). A conversation that has `watchdog_rescued` but
 * not `watchdog_rescue_completed` was mid-rescue when the process died; the
 * next boot treats it as already-rescued and does not re-drive.
 */
export interface WatchdogRescueCompletedEvent {
  type: "watchdog_rescue_completed";
  turnNumber: number;
  completedAt: string; // ISO8601
}

/**
 * Emitted by the CFR recovery orchestrator (M9.6-S6) when all 3 fix
 * iterations are exhausted and the brain has sent the user a graceful
 * surrender message. The orphan watchdog checks for this marker: a
 * surrendered conversation must NOT be re-driven on next boot.
 *
 * Shape matches what S6's resilience-messages layer will write. Forward-
 * compatible — the watchdog checks for it even before S6 lands (returns
 * false while no events of this type exist).
 */
export interface CapabilitySurrenderEvent {
  type: "capability_surrender";
  capabilityType: string;
  conversationId: string;
  turnNumber: number;
  reason: "budget-exhausted" | "max-attempts" | "redesign-needed" | "insufficient-context";
  surrenderedAt: string; // ISO8601
}

/**
 * Emitted by the orphan watchdog (M9.6-S5) when it observes an orphan that is
 * older than the stale threshold and chooses to skip rescue rather than prompt
 * the brain to reply long after the fact. Idempotent marker for the sweep.
 */
export interface WatchdogResolvedStaleEvent {
  type: "watchdog_resolved_stale";
  turnNumber: number;
  ageMs: number;
  resolvedAt: string; // ISO8601
}

/**
 * Any line in a JSONL transcript
 */
export type TranscriptLine =
  | TranscriptMeta
  | TranscriptTurn
  | TranscriptEvent
  | TranscriptMetaUpdate
  | TurnCorrectedEvent
  | WatchdogRescuedEvent
  | WatchdogResolvedStaleEvent
  | WatchdogRescueCompletedEvent
  | CapabilitySurrenderEvent;

/**
 * Options for listing conversations
 */
export interface ListConversationsOptions {
  /** Maximum number of results */
  limit?: number;
}

/**
 * Options for reading turns from a transcript
 */
export interface GetTurnsOptions {
  /** Maximum number of turns to return */
  limit?: number;

  /** Number of turns to skip from the start */
  offset?: number;
}
