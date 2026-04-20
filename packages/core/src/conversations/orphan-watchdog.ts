/**
 * orphan-watchdog.ts — Detect and rescue user turns that never received an
 * assistant reply (M9.6-S5).
 *
 * Runs once at App boot. Scans the last N conversations for a user turn with
 * no following assistant turn. Depending on age and content, either:
 *
 *   - appends a `watchdog_resolved_stale` event (too old to rescue naturally),
 *   - or (for fresh orphans) appends a `watchdog_rescued` event and injects a
 *     mediator-framed system prompt so the brain answers the original question.
 *
 * If the orphan is a voice-note placeholder and raw media exists on disk, the
 * watchdog calls the provided `reverify` hook to re-run STT. A successful
 * reverify writes a `turn_corrected` event before the `watchdog_rescued` event
 * and the rescue prompt uses the recovered transcription.
 *
 * Idempotence: if a `watchdog_rescued` or `watchdog_resolved_stale` event
 * already exists for a given `turnNumber`, the sweep skips that orphan. The
 * event is written before injection so a crash mid-rescue still looks rescued
 * to the next boot — the red-team flagged "rescue loop on crash" as a risk,
 * and this trade-off favours at-most-once over at-least-once.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { CapabilityFailure } from "../capabilities/cfr-types.js";
import { conversationOrigin } from "../capabilities/cfr-helpers.js";
import type { ReverifyResult } from "../capabilities/reverify.js";

// ─── Structural types (no cross-package imports) ─────────────────────────────

/**
 * Minimal RawMediaStore shape — matches
 * `packages/dashboard/src/media/raw-media-store.ts`.
 */
export interface RawMediaStoreLike {
  pathFor(
    conversationId: string,
    attachmentId: string,
    mimeType: string,
  ): string;
  exists(absolutePath: string): boolean;
}

/**
 * A single transcript line — discriminated by `type`. Intentionally loose
 * (only the `type` tag is required on non-turn lines) so the dashboard's
 * richer `TranscriptLine` union is structurally assignable without this
 * module importing from `@my-agent/dashboard`.
 */
export type TranscriptLineLike =
  | { type: "meta" }
  | TranscriptTurnLike
  | { type: "event"; event: string }
  | { type: "meta_update" }
  | TurnCorrectedLike
  | WatchdogRescuedLike
  | WatchdogRescueCompletedLike
  | WatchdogResolvedStaleLike
  | CapabilitySurrenderLike;

export interface TranscriptTurnLike {
  type: "turn";
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  turnNumber: number;
  channel?: string;
  attachments?: Array<{
    id: string;
    filename: string;
    localPath: string;
    mimeType: string;
    size: number;
  }>;
  /** Set when a capability failed during this assistant turn (S19). */
  failure_type?: string;
}

export interface TurnCorrectedLike {
  type: "turn_corrected";
  turnNumber: number;
  correctedContent: string;
  correctedBy: "cfr-orchestrator";
  cfrFailureId: string;
  timestamp: string;
}

export interface WatchdogRescuedLike {
  type: "watchdog_rescued";
  turnNumber: number;
  initiatedAt: string;
}

export interface WatchdogRescueCompletedLike {
  type: "watchdog_rescue_completed";
  turnNumber: number;
  completedAt: string;
}

export interface WatchdogResolvedStaleLike {
  type: "watchdog_resolved_stale";
  turnNumber: number;
  ageMs: number;
  resolvedAt: string;
}

/**
 * Minimal shape for the surrender marker written by the CFR orchestrator
 * (M9.6-S6). The watchdog checks for this: a surrendered conversation must
 * not be re-driven. Returns false for any turn until S6 starts emitting
 * these events — forward-compatible by design.
 */
export interface CapabilitySurrenderLike {
  type: "capability_surrender";
  turnNumber: number;
}

/**
 * Minimal ConversationManager shape — matches
 * `packages/dashboard/src/conversations/manager.ts`.
 */
export interface ConversationManagerLike {
  list(options?: {
    limit?: number;
  }): Promise<Array<{ id: string; updated: Date }>>;
  getFullTranscript(id: string): Promise<TranscriptLineLike[]>;
  appendEvent(id: string, event: TranscriptLineLike): Promise<void>;
}

// ─── Config + report ────────────────────────────────────────────────────────

export interface OrphanWatchdogConfig {
  /** Number of most-recent conversations to scan. Default 5. */
  conversationLimit: number;
  /** Orphans older than this are marked stale instead of rescued. Default 30 min. */
  staleThresholdMs: number;
  rawMediaStore: RawMediaStoreLike;
  conversationManager: ConversationManagerLike;
  /** Injects a system prompt into the given conversation (mediator-framed). */
  systemMessageInjector: (
    conversationId: string,
    prompt: string,
  ) => Promise<void>;
  /**
   * Optional: attempt to rerun STT against a raw media artifact. Only wired
   * in when the capability registry + watcher are available (see app.ts).
   */
  reverify?: (failure: CapabilityFailure) => Promise<ReverifyResult>;
}

export interface OrphanSweepReport {
  scanned: number;
  rescued: Array<{ conversationId: string; turnNumber: number }>;
  staleSkipped: Array<{
    conversationId: string;
    turnNumber: number;
    ageMs: number;
  }>;
  corruptSkipped: Array<{
    conversationId: string;
    turnNumber: number;
    reason: string;
  }>;
  assistantFailuresScheduled: Array<{
    conversationId: string;
    turnNumber: number;
    failureType: string;
  }>;
}

// ─── Placeholder detection ──────────────────────────────────────────────────

/**
 * Placeholder strings keyed by capability type. Written by CFR-capable paths
 * when a capability fails before populating the turn content. Exported for
 * the universal-coverage test (spec §2.4).
 */
export const FAILURE_PLACEHOLDERS: Record<string, readonly string[]> = {
  "audio-to-text": [
    "[Voice note — audio attached, pending transcription]",
    "[Voice message — transcription failed",
  ],
};

function isUserTurnPlaceholder(content: string): boolean {
  return Object.values(FAILURE_PLACEHOLDERS)
    .flat()
    .some((needle) => content.includes(needle));
}

// ─── Prompt template ────────────────────────────────────────────────────────

const RESCUE_PROMPT_INLINE = `[SYSTEM: A user turn went unanswered (turn #{n} in this conversation, from {minutes}m ago).
The user's original content was transcribed as:

{correctedContent}

You are the conversation layer. Answer the user's original question directly —
don't acknowledge this system message, don't apologize for the gap, just respond
to what they actually asked.]`;

/**
 * Load the rescue prompt template. Prefers `../prompts/orphan-rescue.md`
 * relative to this source file (dev mode) or its compiled location
 * (production). Falls back to the inline copy if the file is missing, so the
 * watchdog keeps working even if the `.md` isn't shipped alongside the JS.
 */
function loadPromptTemplate(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const candidates = [
      join(here, "..", "prompts", "orphan-rescue.md"),
      join(here, "..", "..", "src", "prompts", "orphan-rescue.md"),
    ];
    for (const p of candidates) {
      if (existsSync(p)) {
        return readFileSync(p, "utf-8").trimEnd();
      }
    }
  } catch {
    // fall through to inline
  }
  return RESCUE_PROMPT_INLINE;
}

function renderPrompt(
  template: string,
  turnNumber: number,
  ageMs: number,
  correctedContent: string,
): string {
  const minutes = Math.max(0, Math.round(ageMs / 60_000));
  return template
    .replace("{n}", String(turnNumber))
    .replace("{minutes}", String(minutes))
    .replace("{correctedContent}", correctedContent);
}

// ─── OrphanWatchdog ─────────────────────────────────────────────────────────

export class OrphanWatchdog {
  private readonly promptTemplate: string;

  constructor(private config: OrphanWatchdogConfig) {
    this.promptTemplate = loadPromptTemplate();
  }

  /**
   * Run one boot-time sweep. Never throws — per-conversation errors are
   * captured into `corruptSkipped` and the sweep continues.
   */
  async sweep(): Promise<OrphanSweepReport> {
    const report: OrphanSweepReport = {
      scanned: 0,
      rescued: [],
      assistantFailuresScheduled: [],
      staleSkipped: [],
      corruptSkipped: [],
    };

    let conversations: Array<{ id: string; updated: Date }>;
    try {
      conversations = await this.config.conversationManager.list({
        limit: this.config.conversationLimit,
      });
    } catch (err) {
      console.warn("[orphan-watchdog] failed to list conversations:", err);
      return report;
    }

    for (const conv of conversations) {
      report.scanned += 1;
      try {
        await this.processConversation(conv.id, report);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(
          `[orphan-watchdog] conversation ${conv.id} scan failed:`,
          message,
        );
        report.corruptSkipped.push({
          conversationId: conv.id,
          turnNumber: -1,
          reason: message,
        });
      }
    }

    return report;
  }

  private async processConversation(
    conversationId: string,
    report: OrphanSweepReport,
  ): Promise<void> {
    const transcript =
      await this.config.conversationManager.getFullTranscript(conversationId);

    // Assistant-turn failure_type scan (S19): detect assistant turns where a
    // capability failed and schedule a re-drive via systemMessageInjector.
    for (const line of transcript) {
      if (line.type !== "turn") continue;
      const turn = line as TranscriptTurnLike;
      if (turn.role !== "assistant" || !turn.failure_type) continue;

      const failureType = turn.failure_type;

      // Idempotency: skip if a later non-failed assistant turn exists for
      // the same or later turnNumber — the capability already recovered.
      const laterNonEmpty = transcript.some(
        (l) =>
          l.type === "turn" &&
          (l as TranscriptTurnLike).role === "assistant" &&
          (l as TranscriptTurnLike).turnNumber > turn.turnNumber &&
          (l as TranscriptTurnLike).content.trim().length > 0 &&
          !(l as TranscriptTurnLike).failure_type,
      );
      if (laterNonEmpty) continue;

      report.assistantFailuresScheduled.push({
        conversationId,
        turnNumber: turn.turnNumber,
        failureType,
      });
      await this.config.systemMessageInjector(
        conversationId,
        `[SYSTEM: The voice reply for turn ${turn.turnNumber} failed (${failureType}). ` +
          `Please resend the response as text now.]`,
      );
    }

    const orphan = findOrphanedUserTurn(transcript);
    if (!orphan) return;

    // Idempotence: a prior sweep already handled this turn.
    if (hasWatchdogEventFor(transcript, orphan.turnNumber)) {
      return;
    }

    // Surrender check: if the CFR orchestrator already surrendered on this
    // turn's capability failure, do not re-drive — the user already received
    // a graceful "tried 3 fixes, please resend as text" message (M9.6-S6).
    // This check is forward-compatible: no surrender events exist until S6
    // ships, so it is vacuously false until then.
    if (hasSurrenderEventFor(transcript, orphan.turnNumber)) {
      return;
    }

    const now = Date.now();
    const turnTime = Date.parse(orphan.timestamp);
    if (Number.isNaN(turnTime)) {
      report.corruptSkipped.push({
        conversationId,
        turnNumber: orphan.turnNumber,
        reason: `invalid turn timestamp ${orphan.timestamp}`,
      });
      return;
    }
    const ageMs = Math.max(0, now - turnTime);

    if (ageMs > this.config.staleThresholdMs) {
      await this.config.conversationManager.appendEvent(conversationId, {
        type: "watchdog_resolved_stale",
        turnNumber: orphan.turnNumber,
        ageMs,
        resolvedAt: new Date(now).toISOString(),
      } satisfies WatchdogResolvedStaleLike);
      report.staleSkipped.push({
        conversationId,
        turnNumber: orphan.turnNumber,
        ageMs,
      });
      return;
    }

    // Resolve the content to use in the rescue prompt. If the turn is a voice
    // placeholder and we can rerun STT, prefer the recovered transcription.
    let rescueContent = orphan.content;
    const correctedFromReverify = await this.maybeRescueAudio(
      conversationId,
      orphan,
    );
    if (correctedFromReverify) {
      rescueContent = correctedFromReverify.correctedContent;
      await this.config.conversationManager.appendEvent(
        conversationId,
        correctedFromReverify.event,
      );
    }

    // Append the rescue marker BEFORE invoking the injector. If the injector
    // throws (or the process crashes mid-inject), the next boot sees the
    // marker and skips — at-most-once, not at-least-once.
    await this.config.conversationManager.appendEvent(conversationId, {
      type: "watchdog_rescued",
      turnNumber: orphan.turnNumber,
      initiatedAt: new Date(now).toISOString(),
    } satisfies WatchdogRescuedLike);

    const prompt = renderPrompt(
      this.promptTemplate,
      orphan.turnNumber,
      ageMs,
      rescueContent,
    );

    try {
      await this.config.systemMessageInjector(conversationId, prompt);
      // Write the completion marker AFTER successful injection. This paired
      // event confirms the brain actually received the rescue prompt — distinct
      // from `watchdog_rescued` (written before inject for idempotence).
      // Observability: a turn with `watchdog_rescued` but no `watchdog_rescue_completed`
      // means the process died between marker-write and inject.
      await this.config.conversationManager.appendEvent(conversationId, {
        type: "watchdog_rescue_completed",
        turnNumber: orphan.turnNumber,
        completedAt: new Date(now).toISOString(),
      } satisfies WatchdogRescueCompletedLike);
      report.rescued.push({
        conversationId,
        turnNumber: orphan.turnNumber,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(
        `[orphan-watchdog] injector failed for ${conversationId} turn ${orphan.turnNumber}:`,
        message,
      );
      // Still count as rescued from the watchdog's perspective — the marker
      // is written and we will not retry this turn on the next boot.
      report.corruptSkipped.push({
        conversationId,
        turnNumber: orphan.turnNumber,
        reason: `injector failed: ${message}`,
      });
    }
  }

  /**
   * If the orphaned turn is a voice placeholder and raw media is on disk and
   * reverify is wired, run STT again. On success returns the corrected
   * content plus a `turn_corrected` event to append. Otherwise returns null.
   */
  private async maybeRescueAudio(
    conversationId: string,
    orphan: TranscriptTurnLike,
  ): Promise<{ correctedContent: string; event: TurnCorrectedLike } | null> {
    if (!this.config.reverify) return null;
    if (!isUserTurnPlaceholder(orphan.content)) return null;

    const audioAttachment = (orphan.attachments ?? []).find((a) =>
      a.mimeType.startsWith("audio/"),
    );
    if (!audioAttachment) return null;

    const rawPath = this.config.rawMediaStore.pathFor(
      conversationId,
      audioAttachment.id,
      audioAttachment.mimeType,
    );
    if (!this.config.rawMediaStore.exists(rawPath)) return null;

    // Synthesize a minimal CapabilityFailure so the existing reverify plumbing
    // can run STT against the on-disk artifact.
    const synthetic: CapabilityFailure = {
      id: `orphan-watchdog:${conversationId}:${orphan.turnNumber}`,
      capabilityType: "audio-to-text",
      symptom: "empty-result",
      detail: "orphan-watchdog reverify",
      triggeringInput: {
        origin: conversationOrigin(
          {
            transportId: orphan.channel ?? "unknown",
            channelId: conversationId,
            sender: "unknown",
          },
          conversationId,
          orphan.turnNumber,
        ),
        artifact: {
          type: "audio",
          rawMediaPath: rawPath,
          mimeType: audioAttachment.mimeType,
        },
      },
      attemptNumber: 1,
      previousAttempts: [],
      detectedAt: new Date().toISOString(),
    };

    try {
      const result = await this.config.reverify(synthetic);
      if (result.pass && result.recoveredContent) {
        return {
          correctedContent: result.recoveredContent,
          event: {
            type: "turn_corrected",
            turnNumber: orphan.turnNumber,
            correctedContent: result.recoveredContent,
            correctedBy: "cfr-orchestrator",
            cfrFailureId: synthetic.id,
            timestamp: new Date().toISOString(),
          },
        };
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(
        `[orphan-watchdog] audio reverify failed for ${conversationId} turn ${orphan.turnNumber}:`,
        message,
      );
    }
    return null;
  }
}

// ─── Helpers (pure, exported for testing) ────────────────────────────────────

/**
 * Find the most recent user turn that has no following assistant turn.
 * Returns null if the transcript has no such turn.
 */
export function findOrphanedUserTurn(
  transcript: TranscriptLineLike[],
): TranscriptTurnLike | null {
  let lastUserTurn: TranscriptTurnLike | null = null;
  let sawAssistantAfter = false;

  for (const line of transcript) {
    if (line.type !== "turn") continue;
    const turn = line as TranscriptTurnLike;
    if (turn.role === "user") {
      lastUserTurn = turn;
      sawAssistantAfter = false;
    } else if (turn.role === "assistant" && lastUserTurn) {
      // Assistant turn with same or higher turnNumber counts as answered.
      if (turn.turnNumber >= lastUserTurn.turnNumber) {
        sawAssistantAfter = true;
      }
    }
  }

  if (lastUserTurn && !sawAssistantAfter) return lastUserTurn;
  return null;
}

/**
 * Return true if a watchdog event (rescued or resolved-stale) is already
 * present for the given turn number — the sweep's idempotence marker.
 */
export function hasWatchdogEventFor(
  transcript: TranscriptLineLike[],
  turnNumber: number,
): boolean {
  for (const line of transcript) {
    if (
      (line.type === "watchdog_rescued" ||
        line.type === "watchdog_resolved_stale") &&
      (line as { turnNumber: number }).turnNumber === turnNumber
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Return true if the CFR recovery orchestrator has already surrendered on the
 * given turn number's capability failure. A surrendered turn must not be
 * re-driven — the user already received a graceful fallback message.
 *
 * Currently always returns false: no `capability_surrender` events exist
 * until M9.6-S6 ships. The check is wired now so S6 just needs to start
 * emitting the event and the watchdog will automatically respect it.
 */
export function hasSurrenderEventFor(
  transcript: TranscriptLineLike[],
  turnNumber: number,
): boolean {
  for (const line of transcript) {
    if (
      line.type === "capability_surrender" &&
      (line as { turnNumber: number }).turnNumber === turnNumber
    ) {
      return true;
    }
  }
  return false;
}
