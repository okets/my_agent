import { describe, it, expect, vi } from "vitest";
import { OrphanWatchdog, FAILURE_PLACEHOLDERS } from "../../src/conversations/orphan-watchdog.js";

function makeAssistantTurn(opts: {
  turnNumber: number;
  content: string;
  failure_type?: string;
}): Record<string, unknown> {
  return {
    type: "turn",
    role: "assistant",
    content: opts.content,
    timestamp: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
    turnNumber: opts.turnNumber,
    failure_type: opts.failure_type,
  };
}

function makeUserTurn(turnNumber: number, content: string): Record<string, unknown> {
  return {
    type: "turn",
    role: "user",
    content,
    timestamp: new Date(Date.now() - 6 * 60 * 1000).toISOString(),
    turnNumber,
  };
}

describe("OrphanWatchdog — assistant-turn failure_type scan", () => {
  it("assistant turn with failure_type detected and scheduled for recovery re-drive", async () => {
    const systemMessageInjector = vi.fn().mockResolvedValue(undefined);
    const rawMediaStore = { get: vi.fn().mockResolvedValue(undefined) } as any;
    const conversationManager = {
      list: vi.fn().mockResolvedValue([{ id: "conv-1", updated: new Date() }]),
      getFullTranscript: vi.fn().mockResolvedValue([
        makeUserTurn(1, "Can you read this voice note?"),
        makeAssistantTurn({ turnNumber: 1, content: "", failure_type: "text-to-audio" }),
      ]),
      appendEvent: vi.fn().mockResolvedValue(undefined),
    } as any;

    const watchdog = new OrphanWatchdog({
      conversationLimit: 5,
      staleThresholdMs: 30 * 60 * 1000,
      rawMediaStore,
      conversationManager,
      systemMessageInjector,
    });

    const report = await watchdog.sweep();
    expect(report.assistantFailuresScheduled.length).toBeGreaterThan(0);
    expect(report.assistantFailuresScheduled[0].failureType).toBe("text-to-audio");
  });

  it("FAILURE_PLACEHOLDERS table covers audio-to-text type", () => {
    expect(FAILURE_PLACEHOLDERS["audio-to-text"]).toBeDefined();
    expect(FAILURE_PLACEHOLDERS["audio-to-text"].length).toBeGreaterThan(0);
  });

  it("assistant turn WITHOUT failure_type is not scheduled", async () => {
    const systemMessageInjector = vi.fn().mockResolvedValue(undefined);
    const conversationManager = {
      list: vi.fn().mockResolvedValue([{ id: "conv-1", updated: new Date() }]),
      getFullTranscript: vi.fn().mockResolvedValue([
        makeUserTurn(1, "Hello"),
        makeAssistantTurn({ turnNumber: 1, content: "Hi there!" }),
      ]),
      appendEvent: vi.fn().mockResolvedValue(undefined),
    } as any;

    const watchdog = new OrphanWatchdog({
      conversationLimit: 5,
      staleThresholdMs: 30 * 60 * 1000,
      rawMediaStore: { get: vi.fn() } as any,
      conversationManager,
      systemMessageInjector,
    });

    const report = await watchdog.sweep();
    expect(report.assistantFailuresScheduled).toHaveLength(0);
    expect(systemMessageInjector).not.toHaveBeenCalled();
  });
});
