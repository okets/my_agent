/**
 * M9.6-S5 — Orphan watchdog basic rescue/stale paths.
 *
 * Plan §7, acceptance test 1:
 *   - user turn + no assistant turn, age 2 min → rescued, system message injected
 *   - user turn + no assistant turn, age 45 min → resolved-stale, no injection
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  OrphanWatchdog,
  type ConversationManagerLike,
  type RawMediaStoreLike,
  type TranscriptLineLike,
  type TranscriptTurnLike,
} from "../../src/conversations/orphan-watchdog.js";

function userTurn(turnNumber: number, ageMinutes: number): TranscriptTurnLike {
  return {
    type: "turn",
    role: "user",
    content: `what's up (turn ${turnNumber})`,
    timestamp: new Date(Date.now() - ageMinutes * 60_000).toISOString(),
    turnNumber,
  };
}

function makeManager(
  transcripts: Record<string, TranscriptLineLike[]>,
): {
  manager: ConversationManagerLike;
  appended: Array<{ id: string; event: TranscriptLineLike }>;
} {
  const appended: Array<{ id: string; event: TranscriptLineLike }> = [];
  const manager: ConversationManagerLike = {
    async list() {
      return Object.keys(transcripts).map((id) => ({
        id,
        updated: new Date(),
      }));
    },
    async getFullTranscript(id: string) {
      return transcripts[id] ?? [];
    },
    async appendEvent(id: string, event: TranscriptLineLike) {
      appended.push({ id, event });
      transcripts[id] = [...(transcripts[id] ?? []), event];
    },
  };
  return { manager, appended };
}

const noopRawMediaStore: RawMediaStoreLike = {
  pathFor: () => "/dev/null",
  exists: () => false,
};

describe("OrphanWatchdog — basic (M9.6-S5)", () => {
  let injections: Array<{ id: string; prompt: string }>;

  beforeEach(() => {
    injections = [];
  });

  it("rescues a fresh orphan (age 2m) — injects system message and writes watchdog_rescued", async () => {
    const { manager, appended } = makeManager({
      "conv-fresh": [
        { type: "meta", id: "conv-fresh", created: "", participants: [] },
        userTurn(1, /* ageMinutes */ 2),
      ],
    });

    const watchdog = new OrphanWatchdog({
      conversationLimit: 5,
      staleThresholdMs: 30 * 60_000,
      rawMediaStore: noopRawMediaStore,
      conversationManager: manager,
      systemMessageInjector: async (id, prompt) => {
        injections.push({ id, prompt });
      },
    });

    const report = await watchdog.sweep();

    expect(report.scanned).toBe(1);
    expect(report.rescued).toEqual([
      { conversationId: "conv-fresh", turnNumber: 1 },
    ]);
    expect(report.staleSkipped).toEqual([]);
    expect(report.corruptSkipped).toEqual([]);

    // Injector was called exactly once with a rescue-framed prompt.
    expect(injections).toHaveLength(1);
    expect(injections[0].id).toBe("conv-fresh");
    expect(injections[0].prompt).toContain("[SYSTEM:");
    expect(injections[0].prompt).toContain("turn #1");

    // watchdog_rescued event was appended (not resolved_stale).
    const rescuedEvents = appended.filter(
      (a) => a.event.type === "watchdog_rescued",
    );
    expect(rescuedEvents).toHaveLength(1);
    expect(
      (rescuedEvents[0].event as { turnNumber: number }).turnNumber,
    ).toBe(1);
  });

  it("marks a stale orphan (age 45m) as resolved-stale — no injection", async () => {
    const { manager, appended } = makeManager({
      "conv-stale": [
        { type: "meta", id: "conv-stale", created: "", participants: [] },
        userTurn(1, /* ageMinutes */ 45),
      ],
    });

    const watchdog = new OrphanWatchdog({
      conversationLimit: 5,
      staleThresholdMs: 30 * 60_000,
      rawMediaStore: noopRawMediaStore,
      conversationManager: manager,
      systemMessageInjector: async (id, prompt) => {
        injections.push({ id, prompt });
      },
    });

    const report = await watchdog.sweep();

    expect(report.scanned).toBe(1);
    expect(report.rescued).toEqual([]);
    expect(report.staleSkipped).toHaveLength(1);
    expect(report.staleSkipped[0].conversationId).toBe("conv-stale");
    expect(report.staleSkipped[0].turnNumber).toBe(1);
    expect(report.staleSkipped[0].ageMs).toBeGreaterThan(30 * 60_000);

    // No system prompt injection for stale orphans.
    expect(injections).toHaveLength(0);

    // watchdog_resolved_stale event appended.
    const staleEvents = appended.filter(
      (a) => a.event.type === "watchdog_resolved_stale",
    );
    expect(staleEvents).toHaveLength(1);
    expect(
      (staleEvents[0].event as { turnNumber: number }).turnNumber,
    ).toBe(1);
  });

  it("ignores conversations whose last user turn already has an assistant reply", async () => {
    const { manager, appended } = makeManager({
      "conv-answered": [
        { type: "meta", id: "conv-answered", created: "", participants: [] },
        userTurn(1, 2),
        {
          type: "turn",
          role: "assistant",
          content: "here you go",
          timestamp: new Date(Date.now() - 60_000).toISOString(),
          turnNumber: 1,
        },
      ],
    });

    const watchdog = new OrphanWatchdog({
      conversationLimit: 5,
      staleThresholdMs: 30 * 60_000,
      rawMediaStore: noopRawMediaStore,
      conversationManager: manager,
      systemMessageInjector: async () => {
        injections.push({ id: "should-not-happen", prompt: "" });
      },
    });

    const report = await watchdog.sweep();

    expect(report.rescued).toEqual([]);
    expect(report.staleSkipped).toEqual([]);
    expect(injections).toHaveLength(0);
    expect(appended).toHaveLength(0);
  });
});
