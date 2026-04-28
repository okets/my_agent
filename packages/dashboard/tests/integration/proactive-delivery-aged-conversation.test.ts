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
import { ConversationInitiator } from "../../src/agent/conversation-initiator.js";
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
      content: `Working on the integration link, attempt ${i + 1}.`,
      timestamp: new Date().toISOString(),
      turnNumber: i * 2 + 1,
    };
    await harness.conversationManager.appendTurn(conversationId, userTurn);
    const assistantTurn: TranscriptTurn = {
      type: "turn",
      role: "assistant",
      content: `Got it — testing iteration ${i + 1} of the integration link now.`,
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
      response: "Today's brief — sensor reading is 145, no major news, weekend events listed.",
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

  it("ConversationInitiator.alert() routes end-to-end through sendActionRequest at depth", async () => {
    // True end-to-end: ConversationInitiator → harness.chat (real AppChatService)
    // → harness.sessionRegistry (returns MockSessionManager) → injectActionRequest.
    // This is the same composition production uses for the alert() path; only the
    // SDK boundary is mocked. Exercises:
    //   - ConversationInitiator.alert() → resolveOutboundInfo (web fallback)
    //   - flag-gated sender selection (env default ON → sendActionRequest)
    //   - AppChatService.sendActionRequest → sendActionRequest helper
    //   - MockSessionManager.injectActionRequest → records lastInjectionKind
    installMockSession(harness, { response: "Brief rendered." });
    const conv = await harness.conversations.create();
    await seedConversationTo50Turns(harness, conv.id);

    // Mock channel manager returning no external transports — alert() resolves
    // to the "web delivery: no external transport involved" branch, which is
    // the exact production path for web-channel proactive deliveries.
    const channelManager = {
      send: async () => {},
      getTransportConfig: () => undefined,
      getTransportInfos: () => [],
    };
    const ci = new ConversationInitiator({
      conversationManager: harness.conversationManager,
      chatService: harness.chat,
      channelManager,
      getOutboundChannel: () => "web",
    });

    const briefPrompt =
      "Brief delivery time. Render the deliverable in your voice and present it now.";
    const result = await ci.alert(briefPrompt);

    // (1) alert() observed delivery (never-lie semantics from S4.1 still hold)
    expect(result.status).toBe("delivered");

    // (2) The mock session received the prompt as action_request, not system —
    //     i.e. the full alert() → chat → session chain dropped the [SYSTEM:] wrap.
    const session = (await harness.sessionRegistry.getOrCreate(conv.id)) as any;
    expect(session.lastInjectionKind).toBe("action_request");
    expect(session.lastInjectedPrompt).toBe(briefPrompt);
    expect(session.lastInjectedPrompt).not.toMatch(/^\[SYSTEM:/);

    // (3) The assistant turn from the mock landed on the transcript at depth+1
    const turns = await harness.conversationManager.getTurns(conv.id);
    expect(turns.length).toBe(51);
    expect(turns[turns.length - 1].role).toBe("assistant");
    expect(turns[turns.length - 1].content).toBe("Brief rendered.");
  });
});
