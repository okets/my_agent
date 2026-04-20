/**
 * Tests for ackBriefingOnFirstOutput() — the briefing delivery timing guard
 * extracted from session-manager.ts (M9.4-S4.1 Task 6).
 *
 * These tests exercise the REAL exported function, not a local simulation.
 * Reverting the guard in session-manager.ts will cause these tests to fail.
 */

import { describe, it, expect, vi } from "vitest";
import { ackBriefingOnFirstOutput } from "../../../src/agent/session-manager.js";
import type { BriefingResult } from "../../../src/agent/session-manager.js";
import type { StreamEvent } from "../../../src/agent/stream-processor.js";

function makeBriefing(): { result: BriefingResult; markDelivered: ReturnType<typeof vi.fn> } {
  const markDelivered = vi.fn();
  return { result: { lines: ["briefing line"], markDelivered }, markDelivered };
}

async function* makeStream(events: StreamEvent[]): AsyncGenerator<StreamEvent> {
  for (const event of events) {
    yield event;
  }
}

async function* throwingStream(
  events: StreamEvent[],
  throwAfterCount: number,
): AsyncGenerator<StreamEvent> {
  for (let i = 0; i < events.length; i++) {
    if (i >= throwAfterCount) throw new Error("simulated stream error");
    yield events[i];
  }
}

async function drain(gen: AsyncGenerator<StreamEvent>): Promise<StreamEvent[]> {
  const events: StreamEvent[] = [];
  for await (const e of gen) events.push(e);
  return events;
}

describe("ackBriefingOnFirstOutput()", () => {
  it("calls markDelivered exactly once on first text_delta", async () => {
    const { result, markDelivered } = makeBriefing();
    const stream = makeStream([
      { type: "session_init", sessionId: "s1" },
      { type: "text_delta", text: "Hello" },
      { type: "text_delta", text: " world" },
      { type: "done" },
    ]);

    await drain(ackBriefingOnFirstOutput(stream, result));

    expect(markDelivered).toHaveBeenCalledTimes(1);
  });

  it("does NOT call markDelivered when stream yields no text_delta (session busy)", async () => {
    const { result, markDelivered } = makeBriefing();
    const stream = makeStream([]);

    await drain(ackBriefingOnFirstOutput(stream, result));

    expect(markDelivered).toHaveBeenCalledTimes(0);
  });

  it("does NOT call markDelivered when stream throws before first text_delta", async () => {
    const { result, markDelivered } = makeBriefing();
    const stream = throwingStream(
      [{ type: "session_init", sessionId: "s1" }, { type: "text_delta", text: "Hi" }],
      1, // throw after session_init, before text_delta
    );

    await expect(drain(ackBriefingOnFirstOutput(stream, result))).rejects.toThrow(
      "simulated stream error",
    );

    expect(markDelivered).toHaveBeenCalledTimes(0);
  });

  it("is idempotent — markDelivered called exactly once even with multiple text_delta events", async () => {
    const { result, markDelivered } = makeBriefing();
    const stream = makeStream([
      { type: "text_delta", text: "a" },
      { type: "text_delta", text: "b" },
      { type: "text_delta", text: "c" },
      { type: "done" },
    ]);

    await drain(ackBriefingOnFirstOutput(stream, result));

    expect(markDelivered).toHaveBeenCalledTimes(1);
  });

  it("passes null briefingResult through without error (no pending briefing)", async () => {
    const stream = makeStream([
      { type: "text_delta", text: "Hi" },
      { type: "done" },
    ]);

    const events = await drain(ackBriefingOnFirstOutput(stream, null));
    expect(events).toHaveLength(2);
  });

  it("yields all events unchanged", async () => {
    const { result } = makeBriefing();
    const input: StreamEvent[] = [
      { type: "session_init", sessionId: "s1" },
      { type: "text_delta", text: "Hi" },
      { type: "done" },
    ];
    const stream = makeStream(input);

    const output = await drain(ackBriefingOnFirstOutput(stream, result));
    expect(output).toEqual(input);
  });
});
