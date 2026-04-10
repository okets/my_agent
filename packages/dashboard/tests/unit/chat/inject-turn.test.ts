import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { AppHarness } from "../../integration/app-harness.js";
import { installMockSession } from "../../integration/mock-session.js";

describe("injectTurn()", () => {
  let harness: AppHarness;

  beforeEach(async () => {
    harness = await AppHarness.create();
    installMockSession(harness);
  });

  afterEach(async () => {
    await harness.shutdown();
  });

  it("writes turn to transcript without brain invocation", async () => {
    const conv = await harness.conversations.create();
    await harness.chat.injectTurn(conv.id, {
      role: "user", content: "Admin injected", turnNumber: 1,
    });
    const turns = await harness.conversationManager.getTurns(conv.id);
    expect(turns).toHaveLength(1);
    expect(turns[0].content).toBe("Admin injected");
  });

  it("emits conversation:updated event", async () => {
    const conv = await harness.conversations.create();
    const events: string[] = [];
    harness.emitter.on("conversation:updated", (id: string) => events.push(id));

    await harness.chat.injectTurn(conv.id, {
      role: "assistant", content: "Event logged.", turnNumber: 1,
    });
    expect(events).toContain(conv.id);
  });

  it("stamps channel field when provided", async () => {
    const conv = await harness.conversations.create();
    await harness.chat.injectTurn(conv.id, {
      role: "user", content: "Calendar event", turnNumber: 1, channel: "system",
    });
    const turns = await harness.conversationManager.getTurns(conv.id);
    expect(turns[0].channel).toBe("system");
  });
});
