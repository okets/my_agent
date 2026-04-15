/**
 * M9.6-S5 C1 — Orphan rescue routes response to the original channel,
 * not the preferred outbound channel.
 *
 * Regression test for the must-fix from the architect review:
 * `forwardToChannel` must be called with the orphaned turn's channel as the
 * override, so a WhatsApp voice note rescued at boot reaches WhatsApp —
 * not the preferred outbound (e.g. "web").
 *
 * Uses the real `makeOrphanRescueInjector` from app.ts so this test cannot
 * drift from the actual implementation.
 */

import { describe, it, expect } from "vitest";
import {
  makeOrphanRescueInjector,
  type OrphanRescueDeps,
} from "../../src/app.js";

function makeDeps(opts: {
  channel: string | undefined;
  responseText: string;
}): {
  deps: OrphanRescueDeps;
  forwardToChannelCalls: Array<[string, string | undefined]>;
} {
  const forwardToChannelCalls: Array<[string, string | undefined]> = [];

  const deps: OrphanRescueDeps = {
    conversationManager: {
      async get(_id) {
        return { turnCount: 3 };
      },
      async getLastUserTurn(_id) {
        return { channel: opts.channel, timestamp: new Date().toISOString() };
      },
    },
    chat: {
      async *sendSystemMessage(_convId, _prompt, _turn) {
        yield { type: "text_delta", text: opts.responseText };
      },
    },
    conversationInitiator: {
      async forwardToChannel(content, channelOverride) {
        forwardToChannelCalls.push([content, channelOverride]);
        return { delivered: true };
      },
    },
  };

  return { deps, forwardToChannelCalls };
}

describe("makeOrphanRescueInjector — channel routing (M9.6-S5 C1)", () => {
  it("routes rescue response to WhatsApp when the orphaned turn came from WhatsApp", async () => {
    const { deps, forwardToChannelCalls } = makeDeps({
      channel: "whatsapp",
      responseText: "you asked X",
    });

    const injector = makeOrphanRescueInjector(deps);
    await injector("conv-wa-001", "[rescue prompt]");

    expect(forwardToChannelCalls).toHaveLength(1);
    const [content, channelOverride] = forwardToChannelCalls[0];
    expect(content).toBe("you asked X");
    // Must pass "whatsapp" as override — NOT undefined (which would fall
    // through to the preferred outbound channel and silently deliver to web).
    expect(channelOverride).toBe("whatsapp");
  });

  it("routes rescue response to undefined (web no-op) when the orphaned turn came from the web dashboard", async () => {
    const { deps, forwardToChannelCalls } = makeDeps({
      channel: undefined,
      responseText: "reply here",
    });

    const injector = makeOrphanRescueInjector(deps);
    await injector("conv-web-001", "[rescue prompt]");

    expect(forwardToChannelCalls).toHaveLength(1);
    const [, channelOverride] = forwardToChannelCalls[0];
    // Web turns have no channel ID — undefined is correct, forwardToChannel
    // treats that as "web" (no-op delivery path).
    expect(channelOverride).toBeUndefined();
  });
});
