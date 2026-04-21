/**
 * cfr-output-no-retry.test.ts — M9.6-S22 dispatch test: output capability shape.
 *
 * Verifies that after a conversation-origin output capability is fixed,
 * the orchestrator's terminalDrain:
 *   1. Emits a "terminal-fixed" ack.
 *   2. Does NOT call retryTurn (no user request to replay for output capabilities).
 *   3. Does NOT call reprocessTurn.
 *
 * Uses a custom capability type ("custom-synth") with explicit interaction: "output"
 * to avoid the text-to-audio reverifier (which requires a real synthesize.sh script).
 * The smoke-fixture fallback handles reverify via registry availability check.
 */

import { describe, it, expect, beforeAll } from "vitest";
import {
  CapabilityRegistry,
  RecoveryOrchestrator,
  conversationOrigin,
  type Capability,
  type CapabilityWatcher,
  type AckKind,
  type CapabilityFailure,
} from "@my-agent/core";

const CONV_ID = "cfr-s22-output-no-retry";
const CHANNEL = { transportId: "whatsapp", channelId: "+15550012", sender: "+15550012" };

describe("M9.6-S22: output capability — terminal-fixed ack only, no retry", () => {
  let emittedAcks: AckKind[];
  let reprocessCalledWith: string | null;
  let retryCalledWith: CapabilityFailure | null;

  beforeAll(async () => {
    emittedAcks = [];
    reprocessCalledWith = null;
    retryCalledWith = null;

    const registry = new CapabilityRegistry();
    // Custom output type — not in REVERIFIERS table, falls through to runSmokeFixture.
    // interaction: "output" declared explicitly → getInteraction("custom-synth") === "output"
    // → terminalDrain sends terminal-fixed ack only, no retryTurn.
    const cap: Capability = {
      name: "custom-synth",
      provides: "custom-synth",
      interface: "script",
      // Non-existent path — smoke fixture falls back to availability check
      path: "/tmp/cfr-s22-test-output-cap",
      status: "available",
      health: "healthy",
      enabled: true,
      canDelete: false,
      interaction: "output",
    };
    registry.register(cap);

    const stubWatcher: CapabilityWatcher = {
      rescanNow: async () => {},
      testAll: async () => {},
      on: () => {},
      off: () => {},
    } as unknown as CapabilityWatcher;

    const orchestrator = new RecoveryOrchestrator({
      spawnAutomation: async () => ({ jobId: "j-out-1", automationId: "a-out-1" }),
      awaitAutomation: async () => ({ status: "done" }),
      getJobRunDir: () => null,
      capabilityRegistry: registry,
      watcher: stubWatcher,
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
      id: "fail-out-1",
      capabilityType: "custom-synth",
      capabilityName: "custom-synth",
      symptom: "not-enabled",
      detail: "custom-synth .enabled absent",
      triggeringInput: {
        origin: conversationOrigin(CHANNEL, CONV_ID, 1),
      },
      attemptNumber: 1,
      previousAttempts: [],
      detectedAt: new Date().toISOString(),
    });
  }, 30_000);

  it("emits attempt ack", () => {
    expect(emittedAcks).toContain("attempt");
  });

  it("emits terminal-fixed ack", () => {
    expect(emittedAcks).toContain("terminal-fixed");
  });

  it("does NOT call retryTurn", () => {
    expect(retryCalledWith).toBeNull();
  });

  it("does NOT call reprocessTurn", () => {
    expect(reprocessCalledWith).toBeNull();
  });
});
