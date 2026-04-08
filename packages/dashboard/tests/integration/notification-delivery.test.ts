/**
 * E2E: Notification delivery via app.chat.sendSystemMessage()
 *
 * Proves the full pipeline: system prompt → brain response → turn saved →
 * App event emitted → StatePublisher can broadcast.
 *
 * Uses AppHarness with mock sessions (no live LLM).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { AppHarness } from "./app-harness.js";
import { installMockSession } from "./mock-session.js";

describe("E2E: Notification delivery via app.chat", () => {
  let harness: AppHarness;

  beforeEach(async () => {
    harness = await AppHarness.create();
    installMockSession(harness, {
      response: "Here are the results of your task!",
    });
  });

  afterEach(async () => {
    await harness.shutdown();
  });

  it("sendSystemMessage() streams response and saves assistant turn", async () => {
    // 1. Create a conversation (becomes current)
    const conv = await harness.conversations.create();
    expect(conv.status).toBe("current");

    // 2. Send a user message to establish web recency
    for await (const event of harness.chat.sendMessage(
      conv.id,
      "Hello, I'm here",
      1,
    )) {
      // consume
    }

    // 3. Track chat:done events
    const chatDoneConvIds: string[] = [];
    harness.emitter.on("chat:done", (convId: string) => {
      chatDoneConvIds.push(convId);
    });

    // 4. Call sendSystemMessage() directly (simulates what alert() does)
    const events: Array<{ type: string; text?: string }> = [];
    for await (const event of harness.chat.sendSystemMessage(
      conv.id,
      "A working agent completed a task. Results: test passed.",
      3, // turnNumber after user + assistant
    )) {
      events.push(event);
    }

    // 5. Assert: ChatEvents were emitted
    expect(events.some((e) => e.type === "start")).toBe(true);
    expect(events.some((e) => e.type === "text_delta")).toBe(true);
    expect(events.some((e) => e.type === "done")).toBe(true);

    // 6. Assert: chat:done App event was emitted
    expect(chatDoneConvIds).toContain(conv.id);

    // 7. Assert: conversation has the new assistant turn in transcript
    const turns = await harness.conversationManager.getTurns(conv.id);
    // user turn (from sendMessage) + assistant (from sendMessage) + assistant (from sendSystemMessage)
    expect(turns.length).toBeGreaterThanOrEqual(3);
    const lastTurn = turns[turns.length - 1];
    expect(lastTurn.role).toBe("assistant");
    expect(lastTurn.content).toBe("Here are the results of your task!");
  });

  it("sendSystemMessage() skips when session is busy", async () => {
    const conv = await harness.conversations.create();

    // Override mock to simulate busy session
    const origGetOrCreate = harness.sessionRegistry.getOrCreate;
    harness.sessionRegistry.getOrCreate = async (...args: any[]) => {
      const session = await (origGetOrCreate as any).apply(
        harness.sessionRegistry,
        args,
      );
      session.isStreaming = () => true;
      return session;
    };

    const events: Array<{ type: string }> = [];
    for await (const event of harness.chat.sendSystemMessage(
      conv.id,
      "test prompt",
      1,
    )) {
      events.push(event);
    }

    // Should yield no events when session is busy
    expect(events).toHaveLength(0);
  });
});
