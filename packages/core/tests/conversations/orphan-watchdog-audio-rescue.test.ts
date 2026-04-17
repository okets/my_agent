/**
 * M9.6-S5 — Orphan watchdog audio-rescue path.
 *
 * Plan §7, acceptance test 3: voice-note placeholder content + raw media
 * artifact exists on disk + reverify succeeds → watchdog appends a
 * `turn_corrected` event BEFORE `watchdog_rescued`, and the system-message
 * injection uses the recovered transcription (not the placeholder).
 *
 * Mocks: rawMediaStore (pathFor/exists), reverify path, systemMessageInjector.
 */

import { describe, it, expect, vi } from "vitest";
import {
  OrphanWatchdog,
  type ConversationManagerLike,
  type RawMediaStoreLike,
  type TranscriptLineLike,
  type TranscriptTurnLike,
  type TurnCorrectedLike,
} from "../../src/conversations/orphan-watchdog.js";
import type { ReverifyResult } from "../../src/capabilities/reverify.js";

const PLACEHOLDER = "[Voice note — audio attached, pending transcription]";
const REAL_TRANSCRIPT = "can you understand voice messages now";

describe("OrphanWatchdog — audio rescue (M9.6-S5)", () => {
  it("runs reverify, writes turn_corrected, and injects real transcript", async () => {
    const orphan: TranscriptTurnLike = {
      type: "turn",
      role: "user",
      content: PLACEHOLDER,
      timestamp: new Date(Date.now() - 2 * 60_000).toISOString(),
      turnNumber: 3,
      channel: "whatsapp",
      attachments: [
        {
          id: "attach-voice-3",
          filename: "voice-3.ogg",
          localPath: "/ignored-localPath",
          mimeType: "audio/ogg",
          size: 48_000,
        },
      ],
    };
    const lines: TranscriptLineLike[] = [
      { type: "meta", id: "conv-voice", created: "", participants: [] },
      orphan,
    ];

    const appended: TranscriptLineLike[] = [];
    const manager: ConversationManagerLike = {
      async list() {
        return [{ id: "conv-voice", updated: new Date() }];
      },
      async getFullTranscript() {
        return [...lines];
      },
      async appendEvent(_id, event) {
        appended.push(event);
        lines.push(event);
      },
    };

    const expectedRawPath = "/fake/conversations/conv-voice/raw/attach-voice-3.ogg";
    const rawMediaStore: RawMediaStoreLike = {
      pathFor: vi.fn((convId, attachId, _mime) => {
        expect(convId).toBe("conv-voice");
        expect(attachId).toBe("attach-voice-3");
        return expectedRawPath;
      }),
      exists: vi.fn((p) => p === expectedRawPath),
    };

    const reverify = vi.fn(
      async (): Promise<ReverifyResult> => ({
        pass: true,
        recoveredContent: REAL_TRANSCRIPT,
      }),
    );

    const injections: Array<{ id: string; prompt: string }> = [];
    const watchdog = new OrphanWatchdog({
      conversationLimit: 5,
      staleThresholdMs: 30 * 60_000,
      rawMediaStore,
      conversationManager: manager,
      systemMessageInjector: async (id, prompt) => {
        injections.push({ id, prompt });
      },
      reverify,
    });

    const report = await watchdog.sweep();

    expect(report.rescued).toEqual([
      { conversationId: "conv-voice", turnNumber: 3 },
    ]);
    expect(report.staleSkipped).toEqual([]);
    expect(report.corruptSkipped).toEqual([]);

    // Reverify was called exactly once with a synthetic CapabilityFailure
    // describing the orphan turn.
    expect(reverify).toHaveBeenCalledTimes(1);
    const failureArg = reverify.mock.calls[0][0];
    expect(failureArg.capabilityType).toBe("audio-to-text");
    const failureOrigin = failureArg.triggeringInput.origin;
    expect(failureOrigin.kind).toBe("conversation");
    expect(failureOrigin.conversationId).toBe("conv-voice");
    expect(failureOrigin.turnNumber).toBe(3);
    expect(failureArg.triggeringInput.artifact?.type).toBe("audio");
    expect(failureArg.triggeringInput.artifact?.rawMediaPath).toBe(
      expectedRawPath,
    );

    // Events appended IN ORDER: turn_corrected BEFORE watchdog_rescued.
    const correctedIdx = appended.findIndex(
      (e) => e.type === "turn_corrected",
    );
    const rescuedIdx = appended.findIndex(
      (e) => e.type === "watchdog_rescued",
    );
    expect(correctedIdx).toBeGreaterThanOrEqual(0);
    expect(rescuedIdx).toBeGreaterThanOrEqual(0);
    expect(correctedIdx).toBeLessThan(rescuedIdx);

    const corrected = appended[correctedIdx] as TurnCorrectedLike;
    expect(corrected.turnNumber).toBe(3);
    expect(corrected.correctedContent).toBe(REAL_TRANSCRIPT);
    expect(corrected.correctedBy).toBe("cfr-orchestrator");

    // The system prompt contains the real transcript, not the placeholder.
    expect(injections).toHaveLength(1);
    expect(injections[0].prompt).toContain(REAL_TRANSCRIPT);
    expect(injections[0].prompt).not.toContain(PLACEHOLDER);
    expect(injections[0].prompt).toContain("turn #3");
  });

  it("skips audio rescue when the raw media artifact is missing on disk", async () => {
    const orphan: TranscriptTurnLike = {
      type: "turn",
      role: "user",
      content: PLACEHOLDER,
      timestamp: new Date(Date.now() - 2 * 60_000).toISOString(),
      turnNumber: 1,
      attachments: [
        {
          id: "lost-audio",
          filename: "lost.ogg",
          localPath: "",
          mimeType: "audio/ogg",
          size: 0,
        },
      ],
    };
    const lines: TranscriptLineLike[] = [
      { type: "meta", id: "conv-no-raw", created: "", participants: [] },
      orphan,
    ];

    const appended: TranscriptLineLike[] = [];
    const manager: ConversationManagerLike = {
      async list() {
        return [{ id: "conv-no-raw", updated: new Date() }];
      },
      async getFullTranscript() {
        return [...lines];
      },
      async appendEvent(_id, event) {
        appended.push(event);
        lines.push(event);
      },
    };

    const rawMediaStore: RawMediaStoreLike = {
      pathFor: () => "/missing/path.ogg",
      exists: () => false, // artifact is GONE
    };

    const reverify = vi.fn();
    const watchdog = new OrphanWatchdog({
      conversationLimit: 5,
      staleThresholdMs: 30 * 60_000,
      rawMediaStore,
      conversationManager: manager,
      systemMessageInjector: async () => {},
      reverify,
    });

    await watchdog.sweep();

    // Reverify was never called because the artifact isn't on disk.
    expect(reverify).not.toHaveBeenCalled();

    // Still a rescue — but with the original placeholder content.
    const correctedEvents = appended.filter(
      (e) => e.type === "turn_corrected",
    );
    expect(correctedEvents).toHaveLength(0);

    const rescuedEvents = appended.filter(
      (e) => e.type === "watchdog_rescued",
    );
    expect(rescuedEvents).toHaveLength(1);
  });
});
