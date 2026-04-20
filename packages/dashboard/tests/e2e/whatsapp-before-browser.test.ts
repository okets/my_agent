/**
 * WhatsApp before browser — E2E acceptance test (M9.6-S2)
 *
 * Verifies: with deps wired at boot, a channel voice note is processed
 * by chat-service (reaches the STT branch) without requiring a WS
 * browser connection first.
 *
 * Pre-S2 behaviour: if a WhatsApp voice note arrived before any browser
 * connected, chat-service had null deps and emitted "deps-missing" CFR.
 *
 * Post-S2 behaviour: deps are wired at App boot → chat-service always
 * has AttachmentService → it gets past the deps gate and reaches
 * transcribeAudio (emitting an STT-level CFR instead of deps-missing).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { EventEmitter } from "node:events";
import { CfrEmitter, CapabilityInvoker } from "@my-agent/core";
import type { CapabilityFailure, CapabilityRegistry } from "@my-agent/core";
import { AppChatService } from "../../src/chat/chat-service.js";
import { AppConversationService } from "../../src/app.js";
import { ConversationManager } from "../../src/conversations/index.js";
import { AttachmentService } from "../../src/conversations/attachments.js";
import { IdleTimerManager } from "../../src/conversations/idle-timer.js";
import { SessionRegistry } from "../../src/agent/session-registry.js";
import { RawMediaStore } from "../../src/media/raw-media-store.js";

function makeTestApp(agentDir: string) {
  const emitter = new EventEmitter();
  const conversationManager = new ConversationManager(agentDir);
  const conversations = new AppConversationService(
    conversationManager,
    emitter as any,
  );
  const cfr = new CfrEmitter();
  // Stub registry that has no capabilities installed → invoker emits "not-installed" CFR
  const stubRegistry = { listByProvides: () => [] } as unknown as CapabilityRegistry;
  const capabilityInvoker = new CapabilityInvoker({ cfr, registry: stubRegistry });
  return Object.assign(emitter, {
    agentDir,
    conversationManager,
    conversations,
    sessionRegistry: new SessionRegistry(5),
    cfr,
    capabilityRegistry: null,
    capabilityInvoker,
    rawMediaStore: new RawMediaStore(agentDir),
  });
}

/** Drain an async generator, collecting values (or stopping after first error). */
async function drain<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const results: T[] = [];
  try {
    for await (const item of gen) {
      results.push(item);
    }
  } catch {
    // expected — chat service throws on no SDK session
  }
  return results;
}

describe("whatsapp-before-browser", () => {
  let agentDir: string;
  let app: ReturnType<typeof makeTestApp>;
  let chat: AppChatService;

  beforeEach(() => {
    agentDir = mkdtempSync(join(tmpdir(), "m9.6-s2-wa-"));
    mkdirSync(join(agentDir, "conversations"), { recursive: true });
    app = makeTestApp(agentDir);
    chat = new AppChatService(app as any);
  });

  afterEach(() => {
    rmSync(agentDir, { recursive: true, force: true });
  });

  it("emits STT-level CFR (not deps-missing) when deps wired at boot", async () => {
    // ── Simulate post-S2 boot: deps wired before any WS connection ──
    const attachmentService = new AttachmentService(agentDir);
    chat.setDeps({
      abbreviationQueue: null,
      idleTimerManager: null,
      attachmentService,
      conversationSearchService: null,
      postResponseHooks: null,
      log: () => {},
      logError: () => {},
    });

    // Capture CFR events
    const failures: CapabilityFailure[] = [];
    app.cfr.on("failure", (f) => failures.push(f));

    // Tiny fake OGG buffer (not a real audio file, will fail transcription)
    const fakeAudioBase64 = Buffer.from("FAKE_OGG_DATA").toString("base64");

    // Write a raw media file (as message-handler would do via RawMediaStore)
    const rawPath = app.rawMediaStore.pathFor(
      "conv-test",
      "att-001",
      "audio/ogg",
    );
    mkdirSync(join(agentDir, "conversations", "conv-test", "raw"), {
      recursive: true,
    });
    writeFileSync(rawPath, "FAKE_OGG_DATA");

    // Send the message — simulates message-handler calling sendMessage
    // after persisting the raw media buffer.
    await drain(
      chat.sendMessage(null, "Hey, voice note here", 1, {
        source: "channel",
        inputMedium: "audio",
        rawMediaPath: rawPath,
        channel: {
          transportId: "whatsapp",
          channelId: "+15550001",
          sender: "+15550001",
        },
        attachments: [
          {
            filename: "voice.ogg",
            base64Data: fakeAudioBase64,
            mimeType: "audio/ogg",
          },
        ],
      }),
    );

    // Key assertion: deps-missing must NOT fire (deps ARE wired at boot)
    const depsMissingCfrs = failures.filter(
      (f) => f.symptom === "deps-missing",
    );
    expect(depsMissingCfrs).toHaveLength(0);

    // At least one CFR must fire — STT fails on fake audio (not-installed or
    // execution-error) because there's no real Deepgram capability in test.
    // This proves the pipeline got PAST the deps gate.
    expect(failures.length).toBeGreaterThan(0);
    const sttCfrs = failures.filter(
      (f) => f.capabilityType === "audio-to-text",
    );
    expect(sttCfrs.length).toBeGreaterThan(0);
  });

  it("pre-S2 behaviour: null deps causes deps-missing CFR", async () => {
    // Deliberately do NOT call setDeps — simulates pre-S2 state
    // where no WS connection has happened yet.

    const failures: CapabilityFailure[] = [];
    app.cfr.on("failure", (f) => failures.push(f));

    const fakeAudioBase64 = Buffer.from("FAKE_OGG_DATA").toString("base64");

    await drain(
      chat.sendMessage(null, "Hey, voice note here", 1, {
        source: "channel",
        inputMedium: "audio",
        channel: {
          transportId: "whatsapp",
          channelId: "+15550001",
          sender: "+15550001",
        },
        attachments: [
          {
            filename: "voice.ogg",
            base64Data: fakeAudioBase64,
            mimeType: "audio/ogg",
          },
        ],
      }),
    );

    // With null deps, chat-service emits deps-missing immediately
    const depsMissingCfrs = failures.filter(
      (f) => f.symptom === "deps-missing",
    );
    expect(depsMissingCfrs.length).toBeGreaterThan(0);
    expect(depsMissingCfrs[0]!.capabilityType).toBe("audio-to-text");
  });
});
