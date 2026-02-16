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

  /** Communication channel */
  channel: "web" | "whatsapp" | "email";

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
}

/**
 * Conversation metadata header (first line of JSONL)
 */
export interface TranscriptMeta {
  /** Line type identifier */
  type: "meta";

  /** Conversation ID */
  id: string;

  /** Channel */
  channel: string;

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
 * Any line in a JSONL transcript
 */
export type TranscriptLine =
  | TranscriptMeta
  | TranscriptTurn
  | TranscriptEvent
  | TranscriptMetaUpdate;

/**
 * Options for listing conversations
 */
export interface ListConversationsOptions {
  /** Filter by channel */
  channel?: string;

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
