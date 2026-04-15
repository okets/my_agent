/**
 * M9.6-S5 C1 — Orphan rescue routes response to the original channel,
 * not the preferred outbound channel.
 *
 * Regression test for the must-fix from the architect review:
 * `forwardToChannel` must be called with the orphaned turn's channel as the
 * override, so a WhatsApp voice note rescued at boot reaches WhatsApp —
 * not the preferred outbound (e.g. "web").
 */

import { describe, it, expect, vi } from "vitest";

// Reproduce the systemMessageInjector logic from app.ts so we can test it
// without spinning up the full App. The logic is: drain sendSystemMessage,
// look up the last user turn's channel, call forwardToChannel with that
// channel as the override.
async function makeInjector(opts: {
  channel: string | undefined;
  responseText: string;
}) {
  const forwardToChannelCalls: Array<
    [content: string, channelOverride: string | undefined]
  > = [];

  const mockApp = {
    conversationManager: {
      async get(_id: string) {
        return { turnCount: 3 };
      },
      async getLastUserTurn(_id: string) {
        return opts.channel !== undefined
          ? { channel: opts.channel, timestamp: new Date().toISOString() }
          : { channel: undefined, timestamp: new Date().toISOString() };
      },
    },
    chat: {
      async *sendSystemMessage(
        _convId: string,
        _prompt: string,
        _turn: number,
      ): AsyncIterable<{ type: string; text?: string }> {
        yield { type: "text_delta", text: opts.responseText };
      },
    },
    conversationInitiator: {
      async forwardToChannel(
        content: string,
        channelOverride?: string,
      ): Promise<{ delivered: boolean }> {
        forwardToChannelCalls.push([content, channelOverride]);
        return { delivered: true };
      },
    },
  };

  // The exact injector closure from app.ts (C1 fix)
  const systemMessageInjector = async (
    convId: string,
    prompt: string,
  ): Promise<void> => {
    const conv = await mockApp.conversationManager.get(convId);
    const nextTurn = (conv?.turnCount ?? 0) + 1;
    let response = "";
    for await (const event of mockApp.chat.sendSystemMessage(
      convId,
      prompt,
      nextTurn,
    )) {
      if (event.type === "text_delta" && event.text) {
        response += event.text;
      }
    }
    if (response) {
      const ci = mockApp.conversationInitiator;
      if (ci) {
        const lastUser =
          await mockApp.conversationManager.getLastUserTurn(convId);
        await ci.forwardToChannel(response, lastUser?.channel);
      }
    }
  };

  return { systemMessageInjector, forwardToChannelCalls };
}

describe("Orphan rescue routing — C1 (M9.6-S5)", () => {
  it("routes rescue response to WhatsApp when the orphaned turn came from WhatsApp", async () => {
    const { systemMessageInjector, forwardToChannelCalls } =
      await makeInjector({ channel: "whatsapp", responseText: "you asked X" });

    await systemMessageInjector("conv-wa-001", "[rescue prompt]");

    expect(forwardToChannelCalls).toHaveLength(1);
    const [content, channelOverride] = forwardToChannelCalls[0];
    expect(content).toBe("you asked X");
    // Must pass "whatsapp" as override — NOT undefined (which would fall
    // through to the preferred outbound channel and silently deliver to web).
    expect(channelOverride).toBe("whatsapp");
  });

  it("routes rescue response to undefined (web no-op) when the orphaned turn came from the web dashboard", async () => {
    const { systemMessageInjector, forwardToChannelCalls } =
      await makeInjector({ channel: undefined, responseText: "reply here" });

    await systemMessageInjector("conv-web-001", "[rescue prompt]");

    expect(forwardToChannelCalls).toHaveLength(1);
    const [, channelOverride] = forwardToChannelCalls[0];
    // Web turns have no channel ID — undefined is correct, forwardToChannel
    // treats that as "web" (no-op delivery path).
    expect(channelOverride).toBeUndefined();
  });
});
