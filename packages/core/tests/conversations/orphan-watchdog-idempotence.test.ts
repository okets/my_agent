/**
 * M9.6-S5 — Orphan watchdog idempotence.
 *
 * Plan §7, acceptance test 2: sweep twice on the same conversation; second run
 * finds the `watchdog_rescued` event from the first run and skips — the
 * injector is NOT called a second time.
 *
 * This is the crash-during-rescue safety net: the marker is written BEFORE
 * the system-message injection, so a re-boot mid-rescue never double-rescues.
 */

import { describe, it, expect } from "vitest";
import {
  OrphanWatchdog,
  type ConversationManagerLike,
  type RawMediaStoreLike,
  type TranscriptLineLike,
  type TranscriptTurnLike,
} from "../../src/conversations/orphan-watchdog.js";

const noopRawMediaStore: RawMediaStoreLike = {
  pathFor: () => "/dev/null",
  exists: () => false,
};

describe("OrphanWatchdog — idempotence (M9.6-S5)", () => {
  it("skips a turn that already has a watchdog_rescued event", async () => {
    const userTurn: TranscriptTurnLike = {
      type: "turn",
      role: "user",
      content: "anyone there?",
      timestamp: new Date(Date.now() - 2 * 60_000).toISOString(),
      turnNumber: 1,
    };
    const lines: TranscriptLineLike[] = [
      { type: "meta", id: "conv-rerun", created: "", participants: [] },
      userTurn,
    ];

    const appended: TranscriptLineLike[] = [];
    const manager: ConversationManagerLike = {
      async list() {
        return [{ id: "conv-rerun", updated: new Date() }];
      },
      async getFullTranscript() {
        return [...lines];
      },
      async appendEvent(_id, event) {
        appended.push(event);
        lines.push(event);
      },
    };

    let injectCount = 0;
    const watchdog = new OrphanWatchdog({
      conversationLimit: 5,
      staleThresholdMs: 30 * 60_000,
      rawMediaStore: noopRawMediaStore,
      conversationManager: manager,
      systemMessageInjector: async () => {
        injectCount += 1;
      },
    });

    // First sweep → rescue.
    const first = await watchdog.sweep();
    expect(first.rescued).toHaveLength(1);
    expect(injectCount).toBe(1);
    expect(
      appended.some((e) => e.type === "watchdog_rescued"),
    ).toBe(true);

    // Second sweep → skip (idempotent).
    const second = await watchdog.sweep();
    expect(second.rescued).toEqual([]);
    expect(second.staleSkipped).toEqual([]);
    expect(second.corruptSkipped).toEqual([]);
    expect(injectCount).toBe(1); // not called again

    // No additional watchdog_rescued events appended on rerun.
    const rescuedCount = appended.filter(
      (e) => e.type === "watchdog_rescued",
    ).length;
    expect(rescuedCount).toBe(1);
  });

  it("skips a turn that already has a watchdog_resolved_stale event", async () => {
    // Pre-seed the transcript with a stale-resolution from a prior boot.
    const userTurn: TranscriptTurnLike = {
      type: "turn",
      role: "user",
      content: "too late",
      timestamp: new Date(Date.now() - 60 * 60_000).toISOString(),
      turnNumber: 1,
    };
    const lines: TranscriptLineLike[] = [
      { type: "meta", id: "conv-prev-stale", created: "", participants: [] },
      userTurn,
      {
        type: "watchdog_resolved_stale",
        turnNumber: 1,
        ageMs: 60 * 60_000,
        resolvedAt: new Date().toISOString(),
      },
    ];

    const appended: TranscriptLineLike[] = [];
    const manager: ConversationManagerLike = {
      async list() {
        return [{ id: "conv-prev-stale", updated: new Date() }];
      },
      async getFullTranscript() {
        return [...lines];
      },
      async appendEvent(_id, event) {
        appended.push(event);
      },
    };

    let injectCount = 0;
    const watchdog = new OrphanWatchdog({
      conversationLimit: 5,
      staleThresholdMs: 30 * 60_000,
      rawMediaStore: noopRawMediaStore,
      conversationManager: manager,
      systemMessageInjector: async () => {
        injectCount += 1;
      },
    });

    const report = await watchdog.sweep();

    expect(report.rescued).toEqual([]);
    expect(report.staleSkipped).toEqual([]);
    expect(injectCount).toBe(0);
    expect(appended).toHaveLength(0);
  });
});
