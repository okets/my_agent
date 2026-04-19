/**
 * CFR single-emit test (M9.6-S18).
 *
 * Before S18: two synthesis paths could both fire per voice turn.
 * After S18: wireAudioCallbacks deleted — only chat-service.synthesizeAudio fires.
 *
 * Verifies that capabilityInvoker.run is called EXACTLY ONCE for text-to-audio
 * per voice turn. [ARCHITECT S2] === 1 not <= 1: zero emits means TTS detection
 * broken, two emits means dual-path regression.
 *
 * Approach: inject a spy capabilityInvoker into chat's app object, send a
 * voice message with audioAttachment so isAudioInput=true, count TTS calls.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { AppHarness } from "./app-harness.js";
import { ChannelMessageHandler } from "../../src/channels/message-handler.js";
import { installMockSession } from "./mock-session.js";
import type { ChannelBinding, IncomingMessage } from "@my-agent/core";

const TRANSPORT_ID = "wa";
const OWNER_PHONE = "15550006666";

const BINDINGS: ChannelBinding[] = [
  {
    id: "wa-cfr-binding",
    transport: TRANSPORT_ID,
    ownerIdentity: OWNER_PHONE,
    ownerJid: `${OWNER_PHONE}@s.whatsapp.net`,
  },
];

describe("TTS failure — capabilityInvoker called exactly once per voice turn (S18)", () => {
  let harness: AppHarness;

  beforeEach(async () => {
    harness = await AppHarness.create();
    fs.writeFileSync(
      path.join(harness.agentDir, "config.yaml"),
      "channels: {}\ntransports: {}\n",
    );
    // Create audio dir so synthesizeAudio doesn't fail on mkdirSync
    fs.mkdirSync(path.join(harness.agentDir, "audio"), { recursive: true });
  });

  afterEach(async () => {
    await harness.shutdown();
  });

  it("text-to-audio invoker.run called === 1 time after single voice turn", async () => {
    // Spy invoker: always fails TTS (returns failure kind), but counts calls
    const ttsRunCalls: unknown[] = [];
    const spyInvoker = {
      run: vi.fn().mockImplementation(async (opts: { capabilityType: string }) => {
        if (opts.capabilityType === "text-to-audio") {
          ttsRunCalls.push(opts);
          return { kind: "failure", detail: "tts-test-failure-s18" };
        }
        // STT: succeed so transcription works and isAudioInput is set
        return { kind: "success", parsed: { text: "transcribed voice input" } };
      }),
    };

    // Inject spy invoker into chat's app object (chat stores app reference internally)
    const chatApp = (harness.chat as any).app;
    chatApp.capabilityInvoker = spyInvoker;

    // Mock rawMediaStore.save so voice attachment handling doesn't fail
    chatApp.rawMediaStore = {
      save: vi.fn().mockResolvedValue("/tmp/fake-raw-media.ogg"),
    };

    // Install mock session so brain responds without real LLM call
    installMockSession(harness, { response: "Here is your reply." });

    const handler = new ChannelMessageHandler(
      {
        conversationManager: harness.conversationManager,
        connectionRegistry: harness.connectionRegistry,
        sendViaTransport: vi.fn().mockResolvedValue(undefined),
        sendTypingIndicator: vi.fn().mockResolvedValue(undefined),
        sendAudioUrlViaTransport: vi.fn().mockResolvedValue(true),
        sendTextViaTransport: vi.fn().mockResolvedValue(true),
        agentDir: harness.agentDir,
        app: {
          conversations: harness.conversations,
          chat: harness.chat,
          emit: harness.emitter.emit.bind(harness.emitter),
          rawMediaStore: chatApp.rawMediaStore,
        } as any,
      },
      BINDINGS,
    );

    // Voice message with audioAttachment so inputMedium="audio" and synthesizeAudio runs
    const voiceMsg: IncomingMessage[] = [{
      id: "cfr-voice-1",
      from: OWNER_PHONE,
      content: "",
      timestamp: new Date(),
      channelId: TRANSPORT_ID,
      isVoiceNote: true,
      audioAttachment: {
        buffer: Buffer.from("fake-audio-bytes"),
        mimeType: "audio/ogg",
      },
    }];

    await handler.handleMessages(TRANSPORT_ID, voiceMsg);

    // [ARCHITECT S2]: EXACTLY ONE synthesis attempt — not 0 (broken detection),
    // not 2 (dual-path regression from wireAudioCallbacks resurrection)
    expect(ttsRunCalls.length).toBe(1);
  });
});
