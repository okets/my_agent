/**
 * Voice reply regression test (M9.6-S18).
 *
 * Confirms the healthy path after TTS path collapse:
 * voice input → chat-service synthesizes audio → message-handler sends audio URL.
 * Fails if message-handler falls back to re-synthesis or sends text instead.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { AppHarness } from "./app-harness.js";
import { ChannelMessageHandler } from "../../src/channels/message-handler.js";
import type { ChannelBinding, IncomingMessage } from "@my-agent/core";

type ChatEvent = { type: string; [key: string]: unknown };

const TRANSPORT_ID = "wa";
const OWNER_PHONE = "15550007777";
const AUDIO_URL = "/api/assets/audio/tts-voice-regression.ogg";

const BINDINGS: ChannelBinding[] = [
  {
    id: "wa-regression-binding",
    transport: TRANSPORT_ID,
    ownerIdentity: OWNER_PHONE,
    ownerJid: `${OWNER_PHONE}@s.whatsapp.net`,
  },
];

describe("voice reply — healthy path regression (S18)", () => {
  let harness: AppHarness;
  let sendAudioUrl: ReturnType<typeof vi.fn>;
  let sendText: ReturnType<typeof vi.fn>;
  let sendVia: ReturnType<typeof vi.fn>;

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

  it("message-handler sends audioUrl from done event — no re-synthesis via Baileys", async () => {
    vi.spyOn(harness.chat, "sendMessage").mockReturnValue(
      (async function* (): AsyncGenerator<ChatEvent> {
        yield { type: "text_delta", text: "Your voice reply" };
        yield { type: "done", audioUrl: AUDIO_URL };
      })() as any,
    );

    const handler = new ChannelMessageHandler(
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
      BINDINGS,
    );

    const voiceMsg: IncomingMessage[] = [{
      id: "regression-voice-1",
      from: OWNER_PHONE,
      content: "",
      timestamp: new Date(),
      channelId: TRANSPORT_ID,
      isVoiceNote: true,
    }];

    await handler.handleMessages(TRANSPORT_ID, voiceMsg);

    // Healthy path: audio URL sent via sendAudioUrlViaTransport — not text, not re-synthesis
    expect(sendAudioUrl).toHaveBeenCalledWith(TRANSPORT_ID, OWNER_PHONE, AUDIO_URL);
    expect(sendText).not.toHaveBeenCalled();
    expect(sendVia).not.toHaveBeenCalled();
  });
});
