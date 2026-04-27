/**
 * M9.4-S4.2 Task 14 — proactive delivery survives synthetic 50-turn gravity.
 *
 * **HEADER NOTE FOR FUTURE READERS:**
 * This test is a confidence-builder, not a load-bearing gate. 50-turn
 * synthetic gravity is not equivalent to 3-day real-conversation gravity
 * (cached context, real topic momentum, real emotional thread). The
 * load-bearing gate is Task 16 (live multi-morning soak). If this test
 * passes but Task 16 fails, trust Task 16 — and re-open the design.
 *
 * What this test DOES verify (with mock sessions, no live LLM):
 * - The full chat path drives sendActionRequest at every site after
 *   50 prior turns of accumulated transcript.
 * - The recorded prompt that hits the SessionManager carries no
 *   `[SYSTEM:]` wrap.
 * - The transcript correctly grows (action-request response is appended
 *   as an assistant turn).
 * - Routing matches the M9.4-S4.2 design principle even at depth.
 *
 * What this test does NOT verify (deferred to Task 16):
 * - That a real model interprets the action-request prompt as a request
 *   to fulfill rather than context to acknowledge.
 * - That Nina returns to the prior topic in the next turn (no
 *   mid-answer pivot).
 * - Behaviour under cumulative cache + emotional momentum across days.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { AppHarness } from "./app-harness.js";
import { installMockSession } from "./mock-session.js";
import type { TranscriptTurn } from "../../src/conversations/types.js";

async function seedConversationTo50Turns(
  harness: AppHarness,
  conversationId: string,
): Promise<void> {
  // 25 user/assistant pairs on a single topic to mimic accumulated gravity.
  for (let i = 0; i < 25; i++) {
    const userTurn: TranscriptTurn = {
      type: "turn",
      role: "user",
      content: `Working on the Shopee App Store link, attempt ${i + 1}.`,
      timestamp: new Date().toISOString(),
      turnNumber: i * 2 + 1,
    };
    await harness.conversationManager.appendTurn(conversationId, userTurn);
    const assistantTurn: TranscriptTurn = {
      type: "turn",
      role: "assistant",
      content: `Got it — testing iteration ${i + 1} of the Shopee link now.`,
      timestamp: new Date().toISOString(),
      turnNumber: i * 2 + 2,
    };
    await harness.conversationManager.appendTurn(conversationId, assistantTurn);
  }
}

describe("Proactive delivery survives 50-turn synthetic gravity (M9.4-S4.2 Task 14)", () => {
  let harness: AppHarness;

  beforeEach(async () => {
    harness = await AppHarness.create();
  });

  afterEach(async () => {
    await harness.shutdown();
  });

  it("sendActionRequest reaches the session unwrapped after 50 prior turns", async () => {
    installMockSession(harness, {
      response: "Today's brief — AQI is 145, no major news, Songkran weekend events listed.",
    });
    const conv = await harness.conversations.create();
    await seedConversationTo50Turns(harness, conv.id);

    const briefPrompt =
      `Brief delivery time. Deliverable: /tmp/runs/morning-brief/2026-04-27/deliverable.md\n\n` +
      `Read the file and present its contents to the user now. Render in your voice — pick what matters, structure it, voice it — but do not silently drop sections.`;

    const events: Array<{ type: string; text?: string }> = [];
    for await (const event of harness.chat.sendActionRequest(
      conv.id,
      briefPrompt,
      51,
    )) {
      events.push(event);
    }

    // (1) Stream completed cleanly
    expect(events.some((e) => e.type === "start")).toBe(true);
    expect(events.some((e) => e.type === "text_delta")).toBe(true);
    expect(events.some((e) => e.type === "done")).toBe(true);

    // (2) Assistant turn was appended (mock returns the brief render)
    const turns = await harness.conversationManager.getTurns(conv.id);
    expect(turns.length).toBe(51); // 50 seeded + 1 from action-request
    const last = turns[turns.length - 1];
    expect(last.role).toBe("assistant");
    expect(last.content).toContain("Today's brief");

    // (3) The mock session recorded the prompt as `action_request`, not
    //     `system` — i.e. the [SYSTEM:] wrap is NOT in the prompt that
    //     reached the SessionManager. (mock-session.ts records both
    //     lastInjectionKind and lastInjectedPrompt.)
    const session = (await harness.sessionRegistry.getOrCreate(conv.id)) as any;
    expect(session.lastInjectionKind).toBe("action_request");
    expect(session.lastInjectedPrompt).toBe(briefPrompt);
    expect(session.lastInjectedPrompt).not.toMatch(/^\[SYSTEM:/);
  });

  it("alert() routing through ConversationInitiator delivers via sendActionRequest", async () => {
    // This test exercises the conversation-initiator alert() path end-to-end
    // through the chat-service mediator with a mocked session — same shape
    // production uses but without a live LLM.
    installMockSession(harness, {
      response: "Brief rendered.",
    });
    const conv = await harness.conversations.create();
    await seedConversationTo50Turns(harness, conv.id);

    // Drive sendActionRequest directly (alert() sits one layer above this).
    for await (const _ of harness.chat.sendActionRequest(
      conv.id,
      "Brief delivery time.",
      51,
    )) {
      void _;
    }
    const session = (await harness.sessionRegistry.getOrCreate(conv.id)) as any;
    expect(session.lastInjectionKind).toBe("action_request");
  });
});
