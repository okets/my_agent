import { describe, it, expect, vi, beforeEach } from "vitest";
import { ConversationAckCoalescer, AckDelivery } from "../../src/capabilities/ack-delivery.js";
import type { CapabilityFailure } from "../../src/capabilities/cfr-types.js";

const CONV = "conv-1";
const NOW = Date.now();

describe("ConversationAckCoalescer", () => {
  let coalescer: ConversationAckCoalescer;

  beforeEach(() => {
    coalescer = new ConversationAckCoalescer();
  });

  it("returns null for the first CFR in a conversation", () => {
    const result = coalescer.onAck(CONV, "audio-to-text", "attempt", NOW);
    expect(result).toBeNull();
  });

  it("returns a follow-up message when second CFR arrives within 30s", () => {
    coalescer.onAck(CONV, "audio-to-text", "attempt", NOW);
    const msg = coalescer.onAck(CONV, "text-to-audio", "attempt", NOW + 5000);
    expect(msg).toContain("voice reply");
    expect(msg).toMatch(/still fixing/i);
  });

  it("N-way merge: three types produce Oxford comma copy", () => {
    coalescer.onAck(CONV, "audio-to-text", "attempt", NOW);
    coalescer.onAck(CONV, "text-to-audio", "attempt", NOW + 1000);
    const msg = coalescer.onAck(CONV, "browser-control", "attempt", NOW + 2000);
    expect(msg).toMatch(/voice transcription.*voice reply.*browser/);
  });

  it("returns null when same type arrives again (idempotent re-attempt)", () => {
    coalescer.onAck(CONV, "audio-to-text", "attempt", NOW);
    const msg = coalescer.onAck(CONV, "audio-to-text", "attempt", NOW + 1000);
    expect(msg).toBeNull();
  });

  it("terminal: first type fixed while second still fixing — partial restoration message", () => {
    coalescer.onAck(CONV, "audio-to-text", "attempt", NOW);
    coalescer.onAck(CONV, "text-to-audio", "attempt", NOW + 1000);
    const msg = coalescer.onTerminal(CONV, "audio-to-text", "fixed", NOW + 10000);
    expect(msg).toContain("voice transcription");
    expect(msg).toMatch(/back|restored/i);
    expect(msg).toMatch(/still|in progress/i);
  });

  it("terminal: both types surrender — combined surrender message", () => {
    coalescer.onAck(CONV, "audio-to-text", "attempt", NOW);
    coalescer.onAck(CONV, "text-to-audio", "attempt", NOW + 1000);
    coalescer.onTerminal(CONV, "audio-to-text", "surrendered", NOW + 10000);
    const msg = coalescer.onTerminal(CONV, "text-to-audio", "surrendered", NOW + 11000);
    expect(msg).not.toBeNull();
  });

  it("terminal: both fixed — combined restoration message", () => {
    coalescer.onAck(CONV, "audio-to-text", "attempt", NOW);
    coalescer.onAck(CONV, "text-to-audio", "attempt", NOW + 1000);
    coalescer.onTerminal(CONV, "audio-to-text", "fixed", NOW + 10000);
    const msg = coalescer.onTerminal(CONV, "text-to-audio", "fixed", NOW + 11000);
    expect(msg).toContain("voice transcription");
    expect(msg).toContain("voice reply");
    expect(msg).toMatch(/back|restored/i);
  });

  it("cross-origin: different conversation opens separate window", () => {
    coalescer.onAck(CONV, "audio-to-text", "attempt", NOW);
    const otherMsg = coalescer.onAck("conv-2", "audio-to-text", "attempt", NOW);
    expect(otherMsg).toBeNull();
  });

  it("window expires after 30s — next CFR opens a fresh window", () => {
    coalescer.onAck(CONV, "audio-to-text", "attempt", NOW);
    const msg = coalescer.onAck(CONV, "text-to-audio", "attempt", NOW + 31_000);
    expect(msg).toBeNull();
  });
});

function makeConversationFailure(capabilityType: string, conversationId: string): CapabilityFailure {
  return {
    id: `cfr-${capabilityType}-${conversationId}`,
    capabilityType,
    symptom: "execution-error",
    detail: "test",
    detectedAt: new Date().toISOString(),
    triggeringInput: {
      origin: {
        kind: "conversation",
        channel: { transportId: "dashboard", sender: "user", replyTo: undefined },
        conversationId,
      },
    },
  } as unknown as CapabilityFailure;
}

describe("AckDelivery — coalescer integration", () => {
  it("two CFRs in same conversation within 30s: first passes through, second becomes follow-up", async () => {
    const sentMessages: string[] = [];
    const transportManager = {
      send: vi.fn(async (_transportId: string, _to: string, payload: { content: string }) => {
        sentMessages.push(payload.content);
      }),
    } as any;
    const broadcastMessages: string[] = [];
    const connectionRegistry = {
      broadcastToConversation: vi.fn((_convId: string, msg: any) => {
        broadcastMessages.push(msg.content);
      }),
    } as any;

    const delivery = new AckDelivery(transportManager, connectionRegistry);

    const failure1 = makeConversationFailure("audio-to-text", "conv-X");
    const failure2 = makeConversationFailure("text-to-audio", "conv-X");

    await delivery.deliver(failure1, "hold on — voice transcription isn't working, fixing now", { kind: "attempt" });
    await delivery.deliver(failure2, "hold on — voice reply isn't working, fixing now", { kind: "attempt" });

    // Both go to dashboard broadcast (transportId: "dashboard")
    expect(broadcastMessages).toHaveLength(2);
    expect(broadcastMessages[0]).toContain("voice transcription");
    expect(broadcastMessages[1]).toMatch(/still fixing.*voice transcription.*voice reply/i);
  });
});
