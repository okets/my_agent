/**
 * Verifies chat-service writes failure_type="text-to-audio" on the assistant
 * turn when TTS synthesis fails for a voice-reply (isAudioInput=true).
 *
 * This is the producer for the assistant-turn orphan scan (Task 5, S19).
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
    id: "wa-failure-type-binding",
    transport: TRANSPORT_ID,
    ownerIdentity: OWNER_PHONE,
    ownerJid: `${OWNER_PHONE}@s.whatsapp.net`,
  },
];

describe("chat-service — failure_type producer (S19 Task 5.5)", () => {
  let harness: AppHarness;

  beforeEach(async () => {
    harness = await AppHarness.create();
    fs.writeFileSync(
      path.join(harness.agentDir, "config.yaml"),
      "channels: {}\ntransports: {}\n",
    );
    fs.mkdirSync(path.join(harness.agentDir, "audio"), { recursive: true });
  });

  afterEach(async () => {
    await harness.shutdown();
  });

  it("assistant turn has failure_type='text-to-audio' when TTS fails on voice reply", async () => {
    // Spy invoker: fails TTS, succeeds STT
    const spyInvoker = {
      run: vi.fn().mockImplementation(async (opts: { capabilityType: string }) => {
        if (opts.capabilityType === "text-to-audio") {
          return { kind: "failure", detail: "tts-test-failure-s19" };
        }
        // STT succeeds — voice input transcribed
        return { kind: "success", parsed: { text: "what time is it" } };
      }),
    };

    const chatApp = (harness.chat as any).app;
    chatApp.capabilityInvoker = spyInvoker;
    chatApp.rawMediaStore = {
      save: vi.fn().mockResolvedValue("/tmp/fake-raw-media.ogg"),
    };

    installMockSession(harness, { response: "It is 3pm." });

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

    // Voice message (isAudioInput = true)
    const voiceMsg: IncomingMessage[] = [
      {
        id: "msg-failure-type-1",
        from: OWNER_PHONE,
        content: "",
        timestamp: new Date(),
        channelId: TRANSPORT_ID,
        isVoiceNote: true,
        audioAttachment: {
          buffer: Buffer.from("fake-audio-data"),
          mimeType: "audio/ogg",
        },
      },
    ];

    await handler.handleMessages(TRANSPORT_ID, voiceMsg);

    // Find the conversation and check the assistant turn
    const convs = await harness.conversationManager.list();
    expect(convs.length).toBeGreaterThan(0);
    const convId = convs[0].id;
    const transcript = await harness.conversationManager.getFullTranscript(convId);

    const assistantTurns = transcript.filter(
      (t: any) => t.type === "turn" && t.role === "assistant",
    );
    expect(assistantTurns.length).toBeGreaterThan(0);

    const failedTurn = assistantTurns.find((t: any) => t.failure_type === "text-to-audio");
    expect(failedTurn).toBeDefined();
    expect(failedTurn?.failure_type).toBe("text-to-audio");
  });

  it("assistant turn has NO failure_type when TTS succeeds", async () => {
    // Invoker succeeds for both STT and TTS
    const spyInvoker = {
      run: vi.fn().mockImplementation(async (opts: { capabilityType: string }) => {
        if (opts.capabilityType === "text-to-audio") {
          // TTS success — return a fake audio URL
          return { kind: "success", parsed: { audioUrl: "file:///tmp/fake-audio.ogg" } };
        }
        return { kind: "success", parsed: { text: "what time is it" } };
      }),
    };

    const chatApp = (harness.chat as any).app;
    chatApp.capabilityInvoker = spyInvoker;
    chatApp.rawMediaStore = {
      save: vi.fn().mockResolvedValue("/tmp/fake-raw-media.ogg"),
    };

    installMockSession(harness, { response: "It is 3pm." });

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

    const voiceMsg: IncomingMessage[] = [
      {
        id: "msg-failure-type-2",
        from: OWNER_PHONE,
        content: "",
        timestamp: new Date(),
        channelId: TRANSPORT_ID,
        isVoiceNote: true,
        audioAttachment: {
          buffer: Buffer.from("fake-audio-data"),
          mimeType: "audio/ogg",
        },
      },
    ];

    await handler.handleMessages(TRANSPORT_ID, voiceMsg);

    const convs = await harness.conversationManager.list();
    const convId = convs[0].id;
    const transcript = await harness.conversationManager.getFullTranscript(convId);

    const assistantTurns = transcript.filter(
      (t: any) => t.type === "turn" && t.role === "assistant",
    );
    const failedTurn = assistantTurns.find((t: any) => t.failure_type);
    expect(failedTurn).toBeUndefined(); // No failure_type when TTS succeeds
  });

  it("assistant turn has NO failure_type for text-only input", async () => {
    installMockSession(harness, { response: "Hello!" });

    const chatApp = (harness.chat as any).app;

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

    // Text message (isAudioInput = false)
    const textMsg: IncomingMessage[] = [
      {
        id: "msg-failure-type-3",
        from: OWNER_PHONE,
        content: "Hello there",
        timestamp: new Date(),
        channelId: TRANSPORT_ID,
        isVoiceNote: false,
      },
    ];

    await handler.handleMessages(TRANSPORT_ID, textMsg);

    const convs = await harness.conversationManager.list();
    const convId = convs[0].id;
    const transcript = await harness.conversationManager.getFullTranscript(convId);

    const assistantTurns = transcript.filter(
      (t: any) => t.type === "turn" && t.role === "assistant",
    );
    const failedTurn = assistantTurns.find((t: any) => t.failure_type);
    expect(failedTurn).toBeUndefined();
  });
});
