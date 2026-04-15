/**
 * Conversation-layer framework primitives (no persistence — those live in the
 * dashboard package). Module created in M9.6-S5 for the orphan watchdog.
 */

export {
  OrphanWatchdog,
  findOrphanedUserTurn,
  hasWatchdogEventFor,
  hasSurrenderEventFor,
} from "./orphan-watchdog.js";
export type {
  OrphanWatchdogConfig,
  OrphanSweepReport,
  RawMediaStoreLike,
  ConversationManagerLike,
  TranscriptLineLike,
  TranscriptTurnLike,
  TurnCorrectedLike,
  WatchdogRescuedLike,
  WatchdogRescueCompletedLike,
  WatchdogResolvedStaleLike,
  CapabilitySurrenderLike,
} from "./orphan-watchdog.js";
