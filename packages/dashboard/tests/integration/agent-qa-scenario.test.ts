/**
 * Agent QA Scenario — headless chat flow tests.
 *
 * Uses mock SDK sessions to test sendMessage() end-to-end
 * without a real Claude API key or LLM call.
 *
 * M6.10-S4: First headless agent QA tests.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { AppHarness } from "./app-harness.js";
import { installMockSession } from "./mock-session.js";

describe("Agent QA Scenario", () => {
  let harness: AppHarness;

  beforeEach(async () => {
    harness = await AppHarness.create();
    installMockSession(harness, { response: "Hello! I'm the test agent." });
  });

  afterEach(async () => {
    await harness.shutdown();
  });

  it("sends a message and collects streaming response", async () => {
    const { conversation } = await harness.chat.newConversation();
    const events: any[] = [];
    for await (const event of harness.chat.sendMessage(
      conversation.id,
      "Hello agent",
      1,
    )) {
      events.push(event);
    }
    const types = events.map((e) => e.type);
    expect(types).toContain("start");
    expect(types).toContain("done");
  });

  it("streams text_delta events with response content", async () => {
    const { conversation } = await harness.chat.newConversation();
    const textDeltas: string[] = [];
    for await (const event of harness.chat.sendMessage(
      conversation.id,
      "Hello agent",
      1,
    )) {
      if (event.type === "text_delta") {
        textDeltas.push(event.text);
      }
    }
    expect(textDeltas.join("")).toBe("Hello! I'm the test agent.");
  });

  it("persists user message and response in transcript", async () => {
    const { conversation } = await harness.chat.newConversation();
    for await (const _e of harness.chat.sendMessage(
      conversation.id,
      "Hello agent",
      1,
    )) {}
    const loaded = await harness.chat.switchConversation(conversation.id);
    expect(loaded.turns.length).toBeGreaterThanOrEqual(2);
    const userTurn = loaded.turns.find((t) => t.role === "user");
    expect(userTurn?.content).toContain("Hello agent");
    const assistantTurn = loaded.turns.find((t) => t.role === "assistant");
    expect(assistantTurn?.content).toContain("Hello! I'm the test agent.");
  });

  it("auto-creates conversation when conversationId is null", async () => {
    const events: any[] = [];
    for await (const event of harness.chat.sendMessage(null, "Hi there", 1)) {
      events.push(event);
    }
    const startEvent = events.find((e) => e._effects?.conversationCreated);
    expect(startEvent).toBeDefined();
    expect(startEvent._effects.conversationCreated.id).toBeTruthy();
  });

  it("rejects messages exceeding max length", async () => {
    const { conversation } = await harness.chat.newConversation();
    const longMessage = "x".repeat(10001);
    const events: any[] = [];
    for await (const event of harness.chat.sendMessage(
      conversation.id,
      longMessage,
      1,
    )) {
      events.push(event);
    }
    expect(events.some((e) => e.type === "error")).toBe(true);
  });

  it("emits chat:done event on completion", async () => {
    const { conversation } = await harness.chat.newConversation();
    let chatDoneEmitted = false;
    harness.emitter.on("chat:done", () => {
      chatDoneEmitted = true;
    });
    for await (const _e of harness.chat.sendMessage(
      conversation.id,
      "Hello",
      1,
    )) {}
    expect(chatDoneEmitted).toBe(true);
  });

  it("handles mock error responses", async () => {
    // Re-install with error mode
    installMockSession(harness, { error: "Service unavailable" });
    const { conversation } = await harness.chat.newConversation();
    const events: any[] = [];
    for await (const event of harness.chat.sendMessage(
      conversation.id,
      "Hello",
      1,
    )) {
      events.push(event);
    }
    const errorEvent = events.find((e) => e.type === "error");
    expect(errorEvent).toBeDefined();
    expect(errorEvent.message).toBe("Service unavailable");
  });

  it("supports multi-turn conversation headlessly", async () => {
    const { conversation } = await harness.chat.newConversation();

    // Turn 1
    for await (const _e of harness.chat.sendMessage(
      conversation.id,
      "First message",
      1,
    )) {}

    // Turn 2
    for await (const _e of harness.chat.sendMessage(
      conversation.id,
      "Second message",
      2,
    )) {}

    // Verify both turns persisted
    const loaded = await harness.chat.switchConversation(conversation.id);
    const userTurns = loaded.turns.filter((t) => t.role === "user");
    expect(userTurns).toHaveLength(2);
  });

  it("chat:done event includes conversation ID", async () => {
    const { conversation } = await harness.chat.newConversation();
    const doneEvents: any[] = [];
    harness.emitter.on("chat:done", (convId: string) => {
      doneEvents.push({ convId });
    });
    for await (const _e of harness.chat.sendMessage(
      conversation.id,
      "Hello",
      1,
    )) {}
    expect(doneEvents).toHaveLength(1);
    expect(doneEvents[0].convId).toBe(conversation.id);
  });
});
