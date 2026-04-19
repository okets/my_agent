/**
 * Tests for message-handler fallback table (M9.6-S18).
 * One test per row of the per-path fallback table in plan-phase3-refinements.md §2.3.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { AppHarness } from "./app-harness.js";
import { ChannelMessageHandler } from "../../src/channels/message-handler.js";
import type { ChannelBinding, IncomingMessage } from "@my-agent/core";

type ChatEvent = { type: string; [key: string]: unknown };

function makeStream(events: ChatEvent[]): AsyncGenerator<ChatEvent> {
  return (async function* () {
    for (const e of events) yield e;
  })();
}

function makeThrowingStream(): AsyncGenerator<ChatEvent> {
  return (async function* () {
    throw new Error("stream interrupted");
    yield { type: "text_delta", text: "unreachable" } as ChatEvent;
  })();
}

const TRANSPORT_ID = "wa";
const OWNER_PHONE = "15550009999";

const TEST_BINDINGS: ChannelBinding[] = [
  {
    id: "wa-binding",
    transport: TRANSPORT_ID,
    ownerIdentity: OWNER_PHONE,
    ownerJid: `${OWNER_PHONE}@s.whatsapp.net`,
  },
];

function makeVoiceMessage(): IncomingMessage[] {
  return [{
    id: `msg-${Date.now()}`,
    from: OWNER_PHONE,
    content: "",
    timestamp: new Date(),
    channelId: TRANSPORT_ID,
    isVoiceNote: true,
  }];
}

function makeTextMessage(): IncomingMessage[] {
  return [{
    id: `msg-${Date.now()}`,
    from: OWNER_PHONE,
    content: "hello",
    timestamp: new Date(),
    channelId: TRANSPORT_ID,
    isVoiceNote: false,
  }];
}

describe("tts-paths — fallback table", () => {
  let harness: AppHarness;
  let sendAudioUrl: ReturnType<typeof vi.fn>;
  let sendText: ReturnType<typeof vi.fn>;
  let sendVia: ReturnType<typeof vi.fn>;

  function makeHandler(): ChannelMessageHandler {
    return new ChannelMessageHandler(
      {
        conversationManager: harness.conversationManager,
        connectionRegistry: harness.connectionRegistry,
        sendViaTransport: sendVia,
        sendTypingIndicator: vi.fn().mockResolvedValue(undefined),
        sendAudioUrlViaTransport: sendAudioUrl,
        sendTextViaTransport: sendText,
        agentDir: harness.agentDir,
        app: {
          conversations: harness.conversations,
          chat: harness.chat,
          emit: harness.emitter.emit.bind(harness.emitter),
        } as any,
      },
      TEST_BINDINGS,
    );
  }

  beforeEach(async () => {
    harness = await AppHarness.create();
    fs.writeFileSync(
      path.join(harness.agentDir, "config.yaml"),
      "channels: {}\ntransports: {}\n",
    );
    sendAudioUrl = vi.fn().mockResolvedValue(true);
    sendText = vi.fn().mockResolvedValue(true);
    sendVia = vi.fn().mockResolvedValue(undefined);
  });

  afterEach(async () => {
    await harness.shutdown();
  });

  it("final done with audioUrl: sends audio via sendAudioUrlViaTransport (voice input)", async () => {
    vi.spyOn(harness.chat, "sendMessage").mockReturnValue(makeStream([
      { type: "text_delta", text: "Hello" },
      { type: "done", audioUrl: "/api/assets/audio/tts-abc.ogg" },
    ]) as any);

    const handler = makeHandler();
    await handler.handleMessages(TRANSPORT_ID, makeVoiceMessage());

    expect(sendAudioUrl).toHaveBeenCalledWith(TRANSPORT_ID, OWNER_PHONE, "/api/assets/audio/tts-abc.ogg");
    expect(sendText).not.toHaveBeenCalled();
    expect(sendVia).not.toHaveBeenCalled();
  });

  it("done without audioUrl: falls back to sendTextViaTransport (voice input + TTS failed)", async () => {
    vi.spyOn(harness.chat, "sendMessage").mockReturnValue(makeStream([
      { type: "text_delta", text: "Sorry, voice reply failed" },
      { type: "done" },
    ]) as any);

    const handler = makeHandler();
    await handler.handleMessages(TRANSPORT_ID, makeVoiceMessage());

    expect(sendText).toHaveBeenCalledWith(TRANSPORT_ID, OWNER_PHONE, "Sorry, voice reply failed");
    expect(sendAudioUrl).not.toHaveBeenCalled();
  });

  it("text input: uses sendViaTransport regardless of audioUrl", async () => {
    vi.spyOn(harness.chat, "sendMessage").mockReturnValue(makeStream([
      { type: "text_delta", text: "Text reply" },
      { type: "done", audioUrl: "/api/assets/audio/tts-xyz.ogg" },
    ]) as any);

    const handler = makeHandler();
    await handler.handleMessages(TRANSPORT_ID, makeTextMessage());

    expect(sendVia).toHaveBeenCalledWith(TRANSPORT_ID, OWNER_PHONE, { content: "Text reply" });
    expect(sendAudioUrl).not.toHaveBeenCalled();
  });

  it("split done with audioUrl: turn_advanced sends audio, final done sends audio (voice input)", async () => {
    vi.spyOn(harness.chat, "sendMessage").mockReturnValue(makeStream([
      { type: "text_delta", text: "First half" },
      { type: "done", audioUrl: "/api/assets/audio/tts-split-1.ogg" },
      { type: "turn_advanced", turnNumber: 1 },
      { type: "text_delta", text: "Second half" },
      { type: "done", audioUrl: "/api/assets/audio/tts-final-2.ogg" },
    ]) as any);

    const handler = makeHandler();
    await handler.handleMessages(TRANSPORT_ID, makeVoiceMessage());

    expect(sendAudioUrl).toHaveBeenCalledTimes(2);
    expect(sendAudioUrl).toHaveBeenNthCalledWith(1, TRANSPORT_ID, OWNER_PHONE, "/api/assets/audio/tts-split-1.ogg");
    expect(sendAudioUrl).toHaveBeenNthCalledWith(2, TRANSPORT_ID, OWNER_PHONE, "/api/assets/audio/tts-final-2.ogg");
    expect(sendText).not.toHaveBeenCalled();
  });

  it("error catch path: voice input + stream throws → error text via sendTextViaTransport", async () => {
    vi.spyOn(harness.chat, "sendMessage").mockReturnValue(makeThrowingStream() as any);

    const handler = makeHandler();
    await handler.handleMessages(TRANSPORT_ID, makeVoiceMessage());

    // Error path: text fallback, never audio
    expect(sendText).toHaveBeenCalled();
    const callArgs = sendText.mock.calls[0] as [string, string, string];
    expect(callArgs[0]).toBe(TRANSPORT_ID);
    expect(callArgs[1]).toBe(OWNER_PHONE);
    expect(callArgs[2]).toMatch(/error/i);
    expect(sendAudioUrl).not.toHaveBeenCalled();
  });
});
