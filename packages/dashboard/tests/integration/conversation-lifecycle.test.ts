/**
 * Conversation Lifecycle — Integration Tests
 *
 * Uses AppHarness to wire up real services (ConversationManager, DB, transcripts)
 * against a temp directory. No mocks — exercises the full persistence stack.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { AppHarness } from "./app-harness.js";
import type { TranscriptTurn } from "../../src/conversations/types.js";

// -------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------

function makeTurn(
  role: "user" | "assistant",
  content: string,
  turnNumber: number,
): TranscriptTurn {
  return {
    type: "turn",
    role,
    content,
    timestamp: new Date().toISOString(),
    turnNumber,
  };
}

// -------------------------------------------------------------------
// Tests
// -------------------------------------------------------------------

describe("Conversation Lifecycle (integration)", () => {
  let harness: AppHarness;

  beforeEach(async () => {
    harness = await AppHarness.create();
  });

  afterEach(async () => {
    await harness.shutdown();
  });

  // 1. Harness initializes and shuts down cleanly
  it("harness initializes and shuts down cleanly", async () => {
    // If we got here, create() succeeded. Verify the manager is usable.
    const list = await harness.conversationManager.list();
    expect(Array.isArray(list)).toBe(true);
    expect(list.length).toBe(0);

    // shutdown() is called in afterEach — if it throws, the test fails.
  });

  // 2. Creates a conversation with 'current' status
  it("creates a conversation with 'current' status", async () => {
    const conv = await harness.conversationManager.create({
      title: "Test conversation",
    });

    expect(conv.id).toMatch(/^conv-/);
    expect(conv.status).toBe("current");
    expect(conv.title).toBe("Test conversation");
    expect(conv.turnCount).toBe(0);

    // Verify via get()
    const fetched = await harness.conversationManager.get(conv.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.status).toBe("current");
  });

  // 3. Persists turns to transcript
  it("persists turns to transcript", async () => {
    const conv = await harness.conversationManager.create();

    const turn1 = makeTurn("user", "Hello there", 1);
    const turn2 = makeTurn("assistant", "Hi! How can I help?", 1);
    const turn3 = makeTurn("user", "Tell me about testing", 2);

    await harness.conversationManager.appendTurn(conv.id, turn1);
    await harness.conversationManager.appendTurn(conv.id, turn2);
    await harness.conversationManager.appendTurn(conv.id, turn3);

    const turns = await harness.conversationManager.getTurns(conv.id);

    expect(turns.length).toBe(3);
    expect(turns[0].role).toBe("user");
    expect(turns[0].content).toBe("Hello there");
    expect(turns[1].role).toBe("assistant");
    expect(turns[1].content).toBe("Hi! How can I help?");
    expect(turns[2].role).toBe("user");
    expect(turns[2].content).toBe("Tell me about testing");
  });

  // 4. Demotes current conversation when creating a new one
  it("demotes current conversation when creating a new one", async () => {
    const conv1 = await harness.conversationManager.create();
    expect(conv1.status).toBe("current");

    const conv2 = await harness.conversationManager.create();
    expect(conv2.status).toBe("current");

    // conv1 should now be inactive
    const reloaded1 = await harness.conversationManager.get(conv1.id);
    expect(reloaded1!.status).toBe("inactive");

    // conv2 is the current one
    const current = await harness.conversationManager.getCurrent();
    expect(current!.id).toBe(conv2.id);
  });

  // 5. Fires onConversationInactive callback when conversation is demoted
  it("fires onConversationInactive callback when conversation is demoted", async () => {
    const demotedIds: string[] = [];
    harness.conversationManager.onConversationInactive = (id: string) => {
      demotedIds.push(id);
    };

    const conv1 = await harness.conversationManager.create();
    // No callback yet — conv1 is the first conversation
    expect(demotedIds.length).toBe(0);

    const conv2 = await harness.conversationManager.create();
    // conv1 was demoted
    expect(demotedIds.length).toBe(1);
    expect(demotedIds[0]).toBe(conv1.id);

    const conv3 = await harness.conversationManager.create();
    // conv2 was demoted
    expect(demotedIds.length).toBe(2);
    expect(demotedIds[1]).toBe(conv2.id);
  });

  // 6. Lists conversations ordered by update time
  it("lists conversations ordered by update time", async () => {
    const conv1 = await harness.conversationManager.create();
    await harness.conversationManager.appendTurn(
      conv1.id,
      makeTurn("user", "first message", 1),
    );
    // Small delay so timestamps differ
    await new Promise((r) => setTimeout(r, 15));

    const conv2 = await harness.conversationManager.create();
    await harness.conversationManager.appendTurn(
      conv2.id,
      makeTurn("user", "second message", 1),
    );
    await new Promise((r) => setTimeout(r, 15));

    const conv3 = await harness.conversationManager.create();
    await harness.conversationManager.appendTurn(
      conv3.id,
      makeTurn("user", "third message", 1),
    );

    const list = await harness.conversationManager.list();

    // list() returns sorted by updated desc
    expect(list.length).toBe(3);
    expect(list[0].id).toBe(conv3.id);
    expect(list[1].id).toBe(conv2.id);
    expect(list[2].id).toBe(conv1.id);
  });

  // 7. Deletes a conversation and its transcript
  it("deletes a conversation and its transcript", async () => {
    const conv = await harness.conversationManager.create();
    await harness.conversationManager.appendTurn(
      conv.id,
      makeTurn("user", "ephemeral message", 1),
    );

    // Verify it exists
    const before = await harness.conversationManager.get(conv.id);
    expect(before).not.toBeNull();

    const turnsBefore = await harness.conversationManager.getTurns(conv.id);
    expect(turnsBefore.length).toBe(1);

    // Delete
    await harness.conversationManager.delete(conv.id);

    // Conversation record is gone
    const after = await harness.conversationManager.get(conv.id);
    expect(after).toBeNull();

    // Transcript is also gone — getTurns should return empty or throw
    const turnsAfter = await harness.conversationManager.getTurns(conv.id);
    expect(turnsAfter.length).toBe(0);
  });
});
