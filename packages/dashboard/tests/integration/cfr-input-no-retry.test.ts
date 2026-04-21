/**
 * cfr-input-no-retry.test.ts — M9.6-S22 dispatch test: input capability shape.
 *
 * Verifies that after a conversation-origin input capability (audio-to-text)
 * is fixed with recovered content, the orchestrator's terminalDrain:
 *   1. Calls reprocessTurn with the recovered text.
 *   2. Does NOT call retryTurn.
 *   3. Does NOT emit a "terminal-fixed" ack (reprocessTurn handles delivery).
 *
 * Uses fully-stubbed automation (instant "done") and a stub invoker that
 * returns a canned transcription for the reverify step.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  CapabilityRegistry,
  RecoveryOrchestrator,
  conversationOrigin,
  type Capability,
  type CapabilityWatcher,
  type CapabilityInvoker,
  type AckKind,
  type CapabilityFailure,
} from "@my-agent/core";

const CONV_ID = "cfr-s22-input-no-retry";
const CHANNEL = { transportId: "whatsapp", channelId: "+15550011", sender: "+15550011" };
const RAW_AUDIO_PATH = join(tmpdir(), "cfr-s22-input-no-retry.ogg");

describe("M9.6-S22: input capability — reprocessTurn called, retryTurn not called", () => {
  let emittedAcks: AckKind[];
  let reprocessCalledWith: string | null;
  let retryCalledWith: CapabilityFailure | null;

  beforeAll(async () => {
    emittedAcks = [];
    reprocessCalledWith = null;
    retryCalledWith = null;

    // Create a placeholder audio file so reverifyAudioToText's existsSync passes
    writeFileSync(RAW_AUDIO_PATH, "fake ogg data");

    const registry = new CapabilityRegistry();
    const cap: Capability = {
      name: "stt-deepgram",
      provides: "audio-to-text",
      interface: "script",
      path: "/tmp/cfr-s22-test-input-cap",
      status: "available",
      health: "healthy",
      enabled: true,
      canDelete: false,
      interaction: "input",
    };
    registry.register(cap);

    const stubWatcher: CapabilityWatcher = {
      rescanNow: async () => {},
      testAll: async () => {},
      on: () => {},
      off: () => {},
    } as unknown as CapabilityWatcher;

    // Stub invoker: returns a canned transcription for the reverify step
    const stubInvoker: CapabilityInvoker = {
      run: async () => ({
        kind: "success" as const,
        stdout: JSON.stringify({ text: "recovered transcription text", confidence: 0.95 }),
        stderr: "",
        parsed: { text: "recovered transcription text", confidence: 0.95 },
      }),
    } as unknown as CapabilityInvoker;

    const orchestrator = new RecoveryOrchestrator({
      spawnAutomation: async () => ({ jobId: "j-input-1", automationId: "a-input-1" }),
      awaitAutomation: async () => ({ status: "done" }),
      getJobRunDir: () => null,
      capabilityRegistry: registry,
      watcher: stubWatcher,
      invoker: stubInvoker,
      emitAck: async (_failure, kind) => {
        emittedAcks.push(kind);
      },
      reprocessTurn: async (_failure, content) => {
        reprocessCalledWith = content;
      },
      retryTurn: async (failure) => {
        retryCalledWith = failure;
      },
      now: () => new Date().toISOString(),
    });

    await orchestrator.handle({
      id: "fail-input-1",
      capabilityType: "audio-to-text",
      capabilityName: "stt-deepgram",
      symptom: "not-enabled",
      detail: "stt-deepgram .enabled absent",
      triggeringInput: {
        origin: conversationOrigin(CHANNEL, CONV_ID, 1),
        artifact: {
          type: "audio",
          rawMediaPath: RAW_AUDIO_PATH,
          mimeType: "audio/ogg",
        },
      },
      attemptNumber: 1,
      previousAttempts: [],
      detectedAt: new Date().toISOString(),
    });
  }, 30_000);

  afterAll(() => {
    try { unlinkSync(RAW_AUDIO_PATH); } catch { /* best-effort */ }
  });

  it("emits attempt ack", () => {
    expect(emittedAcks).toContain("attempt");
  });

  it("calls reprocessTurn with the recovered transcription", () => {
    expect(reprocessCalledWith).toBe("recovered transcription text");
  });

  it("does NOT call retryTurn", () => {
    expect(retryCalledWith).toBeNull();
  });

  it("does NOT emit terminal-fixed ack (reprocessTurn handles delivery)", () => {
    expect(emittedAcks).not.toContain("terminal-fixed");
  });
});
