/**
 * CFR deps-missing emission — acceptance tests (M9.6-S1)
 *
 * Verifies: when chat-service receives attachments but AttachmentService is
 * unavailable, it emits a CFR failure event with symptom "deps-missing" and
 * triggeringInput.artifact.rawMediaPath pointing to an existing file.
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
import { CfrEmitter } from "@my-agent/core";
import type { CapabilityFailure } from "@my-agent/core";
import { ConversationManager } from "../../src/conversations/index.js";
import { AppConversationService } from "../../src/app.js";
import { AppChatService } from "../../src/chat/chat-service.js";
import { SessionRegistry } from "../../src/agent/session-registry.js";
import { RawMediaStore } from "../../src/media/raw-media-store.js";

/** Create a minimal App-like object for CFR unit tests. */
function makeTestApp(agentDir: string) {
  const emitter = new EventEmitter();
  const conversationManager = new ConversationManager(agentDir);
  const conversations = new AppConversationService(
    conversationManager,
    emitter as any,
  );
  const cfr = new CfrEmitter();
  const sessionRegistry = new SessionRegistry(5);

  return Object.assign(emitter, {
    agentDir,
    conversationManager,
    conversations,
    sessionRegistry,
    cfr,
    capabilityRegistry: null,
    rawMediaStore: new RawMediaStore(agentDir),
  });
}

/** Drain an async generator, collecting all yielded values. */
async function drain<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const results: T[] = [];
  for await (const item of gen) {
    results.push(item);
  }
  return results;
}

describe("cfr-emit-deps-missing", () => {
  let agentDir: string;
  let app: ReturnType<typeof makeTestApp>;
  let chatService: AppChatService;

  beforeEach(() => {
    agentDir = mkdtempSync(join(tmpdir(), "cfr-deps-test-"));
    // Set up minimal agent dir structure
    mkdirSync(join(agentDir, "brain"), { recursive: true });
    writeFileSync(join(agentDir, "brain", "AGENTS.md"), "# Test\n");

    app = makeTestApp(agentDir);
    chatService = new AppChatService(app as any);
    // Intentionally do NOT call chatService.setDeps() — deps remains null
  });

  afterEach(() => {
    rmSync(agentDir, { recursive: true, force: true });
  });

  it("emits deps-missing CFR when attachments present but no AttachmentService", async () => {
    // Create a real raw media file (simulating what message-handler would write)
    const rawAudioDir = join(agentDir, "conversations", "staging", "raw");
    mkdirSync(rawAudioDir, { recursive: true });
    const rawFilePath = join(rawAudioDir, "test-audio.ogg");
    writeFileSync(rawFilePath, Buffer.from("fake ogg audio bytes"));

    const failures: CapabilityFailure[] = [];
    app.cfr.on("failure", (f) => failures.push(f));

    // Call sendMessage with an audio attachment and rawMediaPath
    // No deps set → attachmentService is null → should emit CFR
    const gen = chatService.sendMessage(
      null,
      "[Voice note — audio attached, pending transcription]",
      1,
      {
        source: "channel",
        channel: {
          transportId: "whatsapp",
          channelId: "whatsapp-main",
          sender: "+1555000001",
        },
        inputMedium: "audio",
        attachments: [
          {
            filename: "voice-note.ogg",
            mimeType: "audio/ogg",
            base64Data: Buffer.from("fake audio").toString("base64"),
          },
        ],
        rawMediaPath: rawFilePath,
      },
    );

    // Drain — we just need the CFR emission to fire, then the rest may yield errors
    try {
      await drain(gen);
    } catch {
      // It's OK if the brain session fails — we only care about the CFR event
    }

    expect(failures).toHaveLength(1);
    const f = failures[0];
    expect(f.symptom).toBe("deps-missing");
    expect(f.capabilityType).toBe("audio-to-text");
    expect(f.detail).toBe("AttachmentService unavailable at chat-service entry");
    expect(f.triggeringInput.artifact).toBeDefined();
    expect(f.triggeringInput.artifact!.rawMediaPath).toBe(rawFilePath);
    expect(f.triggeringInput.artifact!.type).toBe("audio");
    // The raw file must exist on disk
    const { existsSync } = await import("node:fs");
    expect(existsSync(rawFilePath)).toBe(true);
  });

  it("emits one CFR event, not multiple", async () => {
    const failures: CapabilityFailure[] = [];
    app.cfr.on("failure", (f) => failures.push(f));

    const gen = chatService.sendMessage(null, "doc attached", 1, {
      source: "dashboard",
      attachments: [
        {
          filename: "doc.pdf",
          mimeType: "application/pdf",
          base64Data: Buffer.from("pdf").toString("base64"),
        },
      ],
    });

    try {
      await drain(gen);
    } catch {
      // expected
    }

    // Should emit exactly one failure
    const depsMissing = failures.filter((f) => f.symptom === "deps-missing");
    expect(depsMissing).toHaveLength(1);
    expect(depsMissing[0].capabilityType).toBe("attachment-handler");
  });
});
