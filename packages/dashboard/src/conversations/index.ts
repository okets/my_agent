/**
 * Conversation System — Public API
 *
 * Exports all conversation-related types and classes.
 */

export { ConversationManager } from "./manager.js";
export { TranscriptManager } from "./transcript.js";
export { ConversationDatabase } from "./db.js";
export { AbbreviationQueue } from "./abbreviation.js";
export { IdleTimerManager } from "./idle-timer.js";
export { NamingService } from "./naming.js";

export type {
  Conversation,
  TranscriptTurn,
  TranscriptMeta,
  TranscriptEvent,
  TranscriptMetaUpdate,
  TranscriptLine,
  ListConversationsOptions,
  GetTurnsOptions,
} from "./types.js";
export type { NamingResult } from "./naming.js";
