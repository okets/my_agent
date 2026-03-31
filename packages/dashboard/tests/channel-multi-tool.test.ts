/**
 * Unit Tests — Channel Multi-Tool Text Extraction
 *
 * Verifies that when the brain makes multiple tool calls in a single turn,
 * only the final text segment (after the last tool_use boundary) is sent
 * to the channel (WhatsApp). Intermediate thinking text should be discarded.
 */

import { describe, it, expect } from "vitest";

/**
 * Simulate the assistantContent accumulation logic from message-handler.ts.
 * This mirrors the stream loop: on first tool_use_start with text, it splits;
 * on subsequent tool_use_start events, it resets assistantContent.
 */
function simulateChannelAccumulation(
  events: Array<
    | { type: "text_delta"; text: string }
    | { type: "tool_use_start" }
    | { type: "done" }
  >,
): { ackContent: string | null; finalContent: string } {
  let assistantContent = "";
  let hasSplit = false;
  let ackContent: string | null = null;

  for (const event of events) {
    if (event.type === "text_delta") {
      assistantContent += event.text;
    }

    // Split on first tool use (same logic as message-handler.ts)
    if (
      event.type === "tool_use_start" &&
      !hasSplit &&
      assistantContent.trim().length > 0
    ) {
      hasSplit = true;
      ackContent = assistantContent;
      assistantContent = "";
    }

    // On subsequent tool uses after the split, discard intermediate text
    if (event.type === "tool_use_start" && hasSplit) {
      assistantContent = "";
    }
  }

  return { ackContent, finalContent: assistantContent };
}

describe("Channel Multi-Tool Text Extraction", () => {
  it("single tool call: sends ack + final text", () => {
    const events = [
      { type: "text_delta" as const, text: "Let me check." },
      { type: "tool_use_start" as const },
      { type: "text_delta" as const, text: "Here's what I found!" },
      { type: "done" as const },
    ];

    const result = simulateChannelAccumulation(events);
    expect(result.ackContent).toBe("Let me check.");
    expect(result.finalContent).toBe("Here's what I found!");
  });

  it("multiple tool calls: only sends final text segment to channel", () => {
    const events = [
      { type: "text_delta" as const, text: "Let me find one" },
      { type: "tool_use_start" as const },
      { type: "text_delta" as const, text: "Hmm, wrong one" },
      { type: "tool_use_start" as const },
      { type: "text_delta" as const, text: "Got one!" },
      { type: "done" as const },
    ];

    const result = simulateChannelAccumulation(events);
    expect(result.ackContent).toBe("Let me find one");
    expect(result.finalContent).toBe("Got one!");
  });

  it("three tool calls: discards all intermediate thinking", () => {
    const events = [
      { type: "text_delta" as const, text: "On it!" },
      { type: "tool_use_start" as const },
      { type: "text_delta" as const, text: "Searching..." },
      { type: "tool_use_start" as const },
      { type: "text_delta" as const, text: "Almost there..." },
      { type: "tool_use_start" as const },
      { type: "text_delta" as const, text: "Done! Here are the results." },
      { type: "done" as const },
    ];

    const result = simulateChannelAccumulation(events);
    expect(result.ackContent).toBe("On it!");
    expect(result.finalContent).toBe("Done! Here are the results.");
  });

  it("no tool calls: sends all text as final content", () => {
    const events = [
      { type: "text_delta" as const, text: "Simple response." },
      { type: "done" as const },
    ];

    const result = simulateChannelAccumulation(events);
    expect(result.ackContent).toBeNull();
    expect(result.finalContent).toBe("Simple response.");
  });

  it("tool call with no preceding text: no split, final text sent", () => {
    const events = [
      { type: "tool_use_start" as const },
      { type: "text_delta" as const, text: "Here's the answer." },
      { type: "done" as const },
    ];

    const result = simulateChannelAccumulation(events);
    expect(result.ackContent).toBeNull();
    expect(result.finalContent).toBe("Here's the answer.");
  });

  it("multiple tool calls with no text between: final text preserved", () => {
    const events = [
      { type: "text_delta" as const, text: "Let me look." },
      { type: "tool_use_start" as const },
      { type: "tool_use_start" as const },
      { type: "text_delta" as const, text: "Found it!" },
      { type: "done" as const },
    ];

    const result = simulateChannelAccumulation(events);
    expect(result.ackContent).toBe("Let me look.");
    expect(result.finalContent).toBe("Found it!");
  });
});
